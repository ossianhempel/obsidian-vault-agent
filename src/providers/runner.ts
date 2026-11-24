import { spawn, type ChildProcess } from "node:child_process";
import { buildSpawnEnv } from "../env";
import type {
  AgentMode,
  EffortLevel,
  ModelInfo,
  ProviderId,
  StreamEvent,
} from "../types";
import { createParserState, parseProviderLine } from "./parsers";

export interface InvocationRequest {
  provider: ProviderId;
  binaryPath: string;
  cwd: string;
  model: string;
  modelInfo?: ModelInfo;
  effort: EffortLevel;
  mode: AgentMode;
  prompt: string;
  systemInstructions: string;
  resumeSessionId?: string;
}

export interface BuiltInvocation {
  command: string;
  args: string[];
  stdinPayload?: string;
  hasNativeSystemPrompt: boolean;
}

export function providerSupportsNativeSystemPrompt(provider: ProviderId): boolean {
  return provider === "claude";
}

export function buildProviderInvocation(req: InvocationRequest): BuiltInvocation {
  switch (req.provider) {
    case "claude": {
      const args: string[] = [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
      ];
      if (req.model) {
        args.push("--model", req.model);
      }
      if (req.effort && req.effort !== "default") {
        args.push("--effort", req.effort);
      }
      if (req.resumeSessionId) {
        args.push("--resume", req.resumeSessionId);
      }
      if (req.systemInstructions.trim()) {
        args.push("--append-system-prompt", req.systemInstructions);
      }
      if (req.mode === "ask") {
        args.push("--disallowedTools", "Edit,Write,NotebookEdit");
        args.push("--permission-mode", "auto");
      } else {
        args.push("--permission-mode", "acceptEdits");
      }
      return {
        command: req.binaryPath,
        args,
        stdinPayload: req.prompt,
        hasNativeSystemPrompt: true,
      };
    }

    case "codex": {
      const args: string[] = ["exec"];
      if (req.resumeSessionId) {
        args.push("resume", "--json", "--skip-git-repo-check");
        if (req.model) {
          args.push("-m", req.model);
        }
        if (req.effort && req.effort !== "default") {
          args.push("-c", `model_reasoning_effort="${req.effort}"`);
        }
        args.push(req.resumeSessionId, "-");
      } else {
        args.push("--json", "--skip-git-repo-check", "-C", req.cwd);
        if (req.model) {
          args.push("-m", req.model);
        }
        if (req.effort && req.effort !== "default") {
          args.push("-c", `model_reasoning_effort="${req.effort}"`);
        }
        args.push("-");
      }
      return {
        command: req.binaryPath,
        args,
        stdinPayload: req.prompt,
        hasNativeSystemPrompt: false,
      };
    }

    case "antigravity": {
      const resolvedModel =
        req.modelInfo?.effortModelIds?.[req.effort] ||
        req.modelInfo?.effortModelIds?.default ||
        req.model;
      const args: string[] = [
        "-p",
        req.prompt,
        "--output-format",
        "stream-json",
      ];
      if (resolvedModel) {
        args.push("--model", resolvedModel);
      }
      if (req.effort && req.effort !== "default" && !req.modelInfo?.effortModelIds?.[req.effort]) {
        args.push("--effort", req.effort);
      }
      if (req.resumeSessionId) {
        args.push("--resume", req.resumeSessionId);
      }
      args.push("--mode", req.mode === "ask" ? "plan" : "auto");
      return {
        command: req.binaryPath,
        args,
        hasNativeSystemPrompt: false,
      };
    }

    case "copilot": {
      const args: string[] = [
        "-p",
        req.prompt,
        "--output-format",
        "json",
        "--stream",
        "on",
      ];
      if (req.model) {
        args.push("--model", req.model);
      }
      if (
        req.effort &&
        req.effort !== "default" &&
        req.model !== "auto"
      ) {
        args.push("--reasoning-effort", req.effort);
      }
      if (req.resumeSessionId) {
        args.push(`--resume=${req.resumeSessionId}`);
      }
      if (req.mode === "ask") {
        args.push(
          "--allow-tool=view",
          "--allow-tool=rg",
          "--allow-tool=glob",
          "--allow-tool=shell(obsidian:*)",
          "--allow-tool=shell(rg:*)",
          "--allow-tool=shell(ls:*)",
          "--allow-tool=shell(find:*)",
          "--allow-tool=shell(head:*)",
          "--allow-tool=shell(tail:*)",
          "--deny-tool=write",
        );
      } else {
        args.push("--allow-all-tools");
      }
      return {
        command: req.binaryPath,
        args,
        hasNativeSystemPrompt: false,
      };
    }

    case "opencode": {
      const modelSpec =
        req.effort && req.effort !== "default" && !req.model.includes("#")
          ? `${req.model}#${req.effort}`
          : req.model;
      const args: string[] = ["run", "--format", "json"];
      if (modelSpec) {
        args.push("-m", modelSpec);
      }
      if (req.resumeSessionId) {
        args.push("--session", req.resumeSessionId);
      }
      if (req.mode === "agent") {
        args.push("--auto");
      }
      args.push(req.prompt);
      return {
        command: req.binaryPath,
        args,
        hasNativeSystemPrompt: false,
      };
    }
  }
}

export interface RunningTurn {
  cancel: () => void;
  promise: Promise<void>;
}

export function runProviderTurn(
  req: InvocationRequest,
  onEvent: (event: StreamEvent) => void,
): RunningTurn {
  const invocation = buildProviderInvocation(req);
  let child: ChildProcess | null = null;
  let cancelled = false;

  const promise = new Promise<void>((resolve) => {
    const state = createParserState();
    let stdoutBuf = "";
    let stderrBuf = "";
    let finished = false;
    let emittedDoneOrError = false;

    const emit = (ev: StreamEvent) => {
      if (ev.type === "done" || ev.type === "error") {
        emittedDoneOrError = true;
      }
      onEvent(ev);
    };

    try {
      child = spawn(invocation.command, invocation.args, {
        cwd: req.cwd,
        env: buildSpawnEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      emit({
        type: "error",
        message: `Failed to launch ${req.provider}: ${err instanceof Error ? err.message : String(err)}`,
      });
      resolve();
      return;
    }

    if (invocation.stdinPayload !== undefined && child.stdin) {
      child.stdin.write(invocation.stdinPayload);
      child.stdin.end();
    } else if (child.stdin) {
      child.stdin.end();
    }

    const processLine = (line: string) => {
      if (!line.trim()) return;
      const events = parseProviderLine(req.provider, line, state);
      for (const ev of events) {
        emit(ev);
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf8");
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) {
        processLine(line);
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8");
      // Keep stderr bounded
      if (stderrBuf.length > 8192) {
        stderrBuf = stderrBuf.slice(-8192);
      }
    });

    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      emit({
        type: "error",
        message: `Process error (${req.provider}): ${err.message}`,
      });
      resolve();
    });

    child.on("close", (code, signal) => {
      if (finished) return;
      finished = true;

      if (stdoutBuf.trim()) {
        processLine(stdoutBuf);
      }

      if (cancelled) {
        emit({ type: "done", finalText: state.accumulatedText || undefined });
        resolve();
        return;
      }

      if (!emittedDoneOrError) {
        if (code === 0) {
          emit({
            type: "done",
            finalText: state.accumulatedText || undefined,
          });
        } else {
          const stderrSnippet = stderrBuf.trim().split(/\r?\n/).slice(-8).join("\n");
          emit({
            type: "error",
            message:
              stderrSnippet ||
              `${req.provider} exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}.`,
          });
        }
      }
      resolve();
    });
  });

  return {
    cancel: () => {
      cancelled = true;
      if (child && !child.killed) {
        try {
          child.kill("SIGTERM");
          setTimeout(() => {
            if (child && !child.killed) {
              try {
                child.kill("SIGKILL");
              } catch {
                // ignore
              }
            }
          }, 1500);
        } catch {
          // ignore
        }
      }
    },
    promise,
  };
}
