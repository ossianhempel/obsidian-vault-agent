import { describe, expect, it } from "vitest";
import {
  parseAgyModelsOutput,
  parseCodexModelsCache,
  parseOpencodeModelsOutput,
} from "../src/providers/catalog";
import { buildProviderInvocation } from "../src/providers/runner";

describe("model catalog parsers", () => {
  it("parses Codex models_cache.json filtering by visibility=list", () => {
    const models = parseCodexModelsCache(
      JSON.stringify({
        models: [
          {
            slug: "gpt-6.2-sol",
            display_name: "GPT-6.2-Sol",
            visibility: "list",
            default_reasoning_level: "low",
            supported_reasoning_levels: [{ effort: "high" }, { effort: "low" }, { effort: "medium" }],
          },
          {
            slug: "hidden-internal",
            display_name: "Hidden",
            visibility: "hidden",
          },
        ],
      }),
    );

    expect(models).toEqual([
      {
        id: "gpt-6.2-sol",
        label: "GPT-6.2-Sol",
        efforts: ["low", "medium", "high"],
        defaultEffort: "low",
      },
    ]);
  });

  it("groups Antigravity models by effort suffix", () => {
    const out = [
      "Fetching available models...",
      "gemini-4-neon-high\tGemini 4 Neon (High)",
      "gemini-4-neon-xhigh\tGemini 4 Neon (XHigh)",
      "gemini-4-neon-low\tGemini 4 Neon (Low)",
      "gemini-pro-orchestrator\tOrchestrator (Carbon)",
    ].join("\n");

    const models = parseAgyModelsOutput(out);
    expect(models).toHaveLength(2);
    expect(models[0]).toEqual({
      id: "gemini-4-neon",
      label: "Gemini 4 Neon",
      efforts: ["low", "high", "xhigh"],
      defaultEffort: "high",
      effortModelIds: {
        low: "gemini-4-neon-low",
        high: "gemini-4-neon-high",
        xhigh: "gemini-4-neon-xhigh",
      },
    });
    expect(models[1].id).toBe("gemini-pro-orchestrator");
  });

  it("parses OpenCode models output", () => {
    const models = parseOpencodeModelsOutput("opencode-go/claude-haiku-5-5\nopencode/beam-free\n");
    expect(models.map((m) => m.id)).toEqual([
      "opencode-go/claude-haiku-5-5",
      "opencode/beam-free",
    ]);
  });
});

describe("provider invocation builders", () => {
  it("builds Claude ask mode invocation with disallowed write tools and stdin prompt", () => {
    const inv = buildProviderInvocation({
      provider: "claude",
      binaryPath: "/usr/local/bin/claude",
      cwd: "/vault",
      model: "claude-sonnet-5-5",
      effort: "high",
      mode: "ask",
      prompt: "hello",
      systemInstructions: "sys",
      resumeSessionId: "s-1",
    });

    expect(inv.args).toContain("--model");
    expect(inv.args).toContain("claude-sonnet-5-5");
    expect(inv.args).toContain("--effort");
    expect(inv.args).toContain("high");
    expect(inv.args).toContain("--resume");
    expect(inv.args).toContain("s-1");
    expect(inv.args).toContain("--disallowedTools");
    expect(inv.stdinPayload).toBe("hello");
    expect(inv.hasNativeSystemPrompt).toBe(true);
  });

  it("omits --reasoning-effort for Copilot auto model", () => {
    const inv = buildProviderInvocation({
      provider: "copilot",
      binaryPath: "/opt/homebrew/bin/copilot",
      cwd: "/vault",
      model: "auto",
      effort: "high",
      mode: "ask",
      prompt: "find notes",
      systemInstructions: "sys",
    });

    expect(inv.args).not.toContain("--reasoning-effort");
    expect(inv.args).toContain("--deny-tool=write");
  });

  it("resolves Antigravity effort-specific model ID", () => {
    const inv = buildProviderInvocation({
      provider: "antigravity",
      binaryPath: "/Users/me/.local/bin/agy",
      cwd: "/vault",
      model: "gemini-4-neon",
      modelInfo: {
        id: "gemini-4-neon",
        label: "Gemini 4 Neon",
        efforts: ["low", "high", "xhigh"],
        defaultEffort: "high",
        effortModelIds: {
          low: "gemini-4-neon-low",
          high: "gemini-4-neon-high",
          xhigh: "gemini-4-neon-xhigh",
        },
      },
      effort: "xhigh",
      mode: "ask",
      prompt: "hello",
      systemInstructions: "sys",
    });

    expect(inv.args).toContain("--model");
    expect(inv.args).toContain("gemini-4-neon-xhigh");
    expect(inv.args).toContain("--mode");
    expect(inv.args).toContain("plan");
  });

  it("builds Codex resume invocation with reasoning effort", () => {
    const inv = buildProviderInvocation({
      provider: "codex",
      binaryPath: "/Users/me/.local/bin/codex",
      cwd: "/vault",
      model: "gpt-6.2-sol",
      effort: "high",
      mode: "agent",
      prompt: "continue",
      systemInstructions: "sys",
      resumeSessionId: "thread-99",
    });

    expect(inv.args.slice(0, 2)).toEqual(["exec", "resume"]);
    expect(inv.args).toContain('model_reasoning_effort="high"');
    expect(inv.args.slice(-2)).toEqual(["thread-99", "-"]);
    expect(inv.stdinPayload).toBe("continue");
  });
});
