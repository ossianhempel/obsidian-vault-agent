import type { ProviderId, StreamEvent } from "../types";

export interface ParserState {
  sawStreamDeltas: boolean;
  accumulatedText: string;
}

export function createParserState(): ParserState {
  return {
    sawStreamDeltas: false,
    accumulatedText: "",
  };
}

function safeJsonParse(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function summarizeToolInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;
  for (const key of ["command", "cmd", "path", "file_path", "pattern", "query", "url", "description"]) {
    const val = obj[key];
    if (typeof val === "string" && val.trim()) {
      return val.trim().length > 100 ? `${val.trim().slice(0, 100)}…` : val.trim();
    }
  }
  return undefined;
}

export function parseClaudeLine(line: string, state: ParserState): StreamEvent[] {
  const obj = safeJsonParse(line);
  if (!obj) return [];

  const events: StreamEvent[] = [];
  const type = typeof obj.type === "string" ? obj.type : "";
  const sessionId = typeof obj.session_id === "string" ? obj.session_id : undefined;
  if (sessionId) {
    events.push({ type: "session", sessionId });
  }

  if (type === "stream_event" && obj.event && typeof obj.event === "object") {
    const ev = obj.event as Record<string, unknown>;
    if (ev.type === "content_block_delta" && ev.delta && typeof ev.delta === "object") {
      const delta = ev.delta as Record<string, unknown>;
      if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) {
        state.sawStreamDeltas = true;
        state.accumulatedText += delta.text;
        events.push({ type: "text_delta", text: delta.text });
      } else if (
        delta.type === "thinking_delta" &&
        typeof delta.thinking === "string" &&
        delta.thinking.length > 0
      ) {
        events.push({ type: "thinking_delta", text: delta.thinking });
      }
    } else if (
      ev.type === "content_block_start" &&
      ev.content_block &&
      typeof ev.content_block === "object"
    ) {
      const block = ev.content_block as Record<string, unknown>;
      if (block.type === "tool_use") {
        const id = typeof block.id === "string" ? block.id : `tool-${Date.now()}`;
        const name = typeof block.name === "string" ? block.name : "Tool";
        events.push({ type: "tool_start", id, name });
      }
    }
    return events;
  }

  if (type === "assistant" && obj.message && typeof obj.message === "object") {
    const message = obj.message as Record<string, unknown>;
    const content = Array.isArray(message.content) ? message.content : [];
    const textParts: string[] = [];
    for (const rawBlock of content) {
      if (!rawBlock || typeof rawBlock !== "object") continue;
      const block = rawBlock as Record<string, unknown>;
      if (block.type === "text" && typeof block.text === "string") {
        textParts.push(block.text);
      } else if (block.type === "thinking" && typeof block.thinking === "string" && !state.sawStreamDeltas) {
        events.push({ type: "thinking_delta", text: block.thinking });
      } else if (block.type === "tool_use") {
        const id = typeof block.id === "string" ? block.id : `tool-${Date.now()}`;
        const name = typeof block.name === "string" ? block.name : "Tool";
        const detail = summarizeToolInput(block.input);
        events.push({ type: "tool_start", id, name, detail });
      }
    }
    if (textParts.length > 0 && !state.sawStreamDeltas) {
      const joined = textParts.join("");
      state.accumulatedText = joined;
      events.push({ type: "text_replace", text: joined });
    }
    return events;
  }

  if (type === "user" && obj.message && typeof obj.message === "object") {
    const message = obj.message as Record<string, unknown>;
    const content = Array.isArray(message.content) ? message.content : [];
    for (const rawBlock of content) {
      if (!rawBlock || typeof rawBlock !== "object") continue;
      const block = rawBlock as Record<string, unknown>;
      if (block.type === "tool_result") {
        const id = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
        if (id) {
          events.push({
            type: "tool_end",
            id,
            isError: block.is_error === true,
          });
        }
      }
    }
    return events;
  }

  if (type === "result") {
    const isError = obj.is_error === true;
    const resultText = typeof obj.result === "string" ? obj.result : undefined;
    if (isError) {
      events.push({
        type: "error",
        message: resultText || "Claude CLI returned an error.",
      });
    } else {
      events.push({
        type: "done",
        finalText: resultText || state.accumulatedText || undefined,
        sessionId,
      });
    }
    return events;
  }

  return events;
}

export function parseCodexLine(line: string, state: ParserState): StreamEvent[] {
  const obj = safeJsonParse(line);
  if (!obj) return [];

  const events: StreamEvent[] = [];
  const type = typeof obj.type === "string" ? obj.type : "";

  if (type === "thread.started" && typeof obj.thread_id === "string") {
    events.push({ type: "session", sessionId: obj.thread_id });
    return events;
  }

  if (
    (type === "item.started" || type === "item.updated" || type === "item.completed") &&
    obj.item &&
    typeof obj.item === "object"
  ) {
    const item = obj.item as Record<string, unknown>;
    const itemType = typeof item.type === "string" ? item.type : "";
    const id = typeof item.id === "string" ? item.id : `codex-${Date.now()}`;

    if (itemType === "agent_message" && typeof item.text === "string") {
      state.accumulatedText = item.text;
      events.push({ type: "text_replace", text: item.text });
    } else if (itemType === "reasoning" && typeof item.text === "string") {
      events.push({ type: "thinking_delta", text: `${item.text}\n` });
    } else if (itemType === "command_execution") {
      const cmd = typeof item.command === "string" ? item.command : undefined;
      if (type === "item.started") {
        events.push({ type: "tool_start", id, name: "Bash", detail: cmd });
      } else if (type === "item.completed") {
        const exitCode = typeof item.exit_code === "number" ? item.exit_code : 0;
        events.push({
          type: "tool_end",
          id,
          name: "Bash",
          detail: cmd,
          isError: exitCode !== 0,
        });
      }
    } else if (itemType === "mcp_tool_call") {
      const name =
        typeof item.tool === "string"
          ? item.tool
          : typeof item.server === "string"
            ? item.server
            : "MCP Tool";
      if (type === "item.started") {
        events.push({ type: "tool_start", id, name, detail: summarizeToolInput(item.arguments) });
      } else if (type === "item.completed") {
        events.push({ type: "tool_end", id, name, isError: Boolean(item.error) });
      }
    } else if (itemType === "file_change") {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const firstChange =
        changes[0] && typeof changes[0] === "object"
          ? (changes[0] as Record<string, unknown>)
          : null;
      const firstPath =
        firstChange && typeof firstChange.path === "string"
          ? firstChange.path
          : undefined;
      if (type === "item.started") {
        events.push({ type: "tool_start", id, name: "Edit", detail: firstPath });
      } else if (type === "item.completed") {
        events.push({ type: "tool_end", id, name: "Edit", detail: firstPath });
      }
    }
    // Note: Codex emits config deprecation warnings as item.completed with item.type === "error"
    // before turn.started; we intentionally ignore those non-fatal warnings.
    return events;
  }

  if (type === "turn.completed") {
    events.push({ type: "done", finalText: state.accumulatedText || undefined });
    return events;
  }

  if (type === "turn.failed" || type === "error") {
    const errObj = obj.error && typeof obj.error === "object" ? (obj.error as Record<string, unknown>) : null;
    const msg =
      (errObj && typeof errObj.message === "string" ? errObj.message : undefined) ||
      (typeof obj.message === "string" ? obj.message : undefined) ||
      "Codex execution failed.";
    events.push({ type: "error", message: msg });
    return events;
  }

  return events;
}

export function parseAgyLine(line: string, state: ParserState): StreamEvent[] {
  const obj = safeJsonParse(line);
  if (!obj) return [];

  const events: StreamEvent[] = [];
  const event = typeof obj.event === "string" ? obj.event : "";
  const convId = typeof obj.conversation_id === "string" ? obj.conversation_id : undefined;
  if (convId) {
    events.push({ type: "session", sessionId: convId });
  }

  if (event === "step_update" && obj.step_update && typeof obj.step_update === "object") {
    const step = obj.step_update as Record<string, unknown>;
    const stepConvId = typeof step.conversation_id === "string" ? step.conversation_id : undefined;
    if (stepConvId && stepConvId !== convId) {
      events.push({ type: "session", sessionId: stepConvId });
    }
    const stepType = typeof step.step_type === "string" ? step.step_type : "";
    const stepState = typeof step.state === "string" ? step.state : "";
    const stepIdx =
      typeof step.step_index === "number" || typeof step.step_index === "string"
        ? String(step.step_index)
        : String(Date.now());

    if (typeof step.thinking_delta === "string" && step.thinking_delta.length > 0) {
      events.push({ type: "thinking_delta", text: step.thinking_delta });
    }
    if (typeof step.text_delta === "string" && step.text_delta.length > 0) {
      state.sawStreamDeltas = true;
      state.accumulatedText += step.text_delta;
      events.push({ type: "text_delta", text: step.text_delta });
    }
    if (
      stepType &&
      stepType !== "user_input" &&
      stepType !== "agent_response" &&
      stepType !== "thinking"
    ) {
      const toolName =
        typeof step.tool_name === "string"
          ? step.tool_name
          : stepType;
      const detail =
        (typeof step.summary === "string" ? step.summary : undefined) ||
        summarizeToolInput(step.tool_input ?? step.arguments);
      if (stepState === "DONE" || stepState === "ERROR") {
        events.push({
          type: "tool_end",
          id: `agy-${stepIdx}`,
          name: toolName,
          detail,
          isError: stepState === "ERROR",
        });
      } else {
        events.push({
          type: "tool_start",
          id: `agy-${stepIdx}`,
          name: toolName,
          detail,
        });
      }
    }
    return events;
  }

  if (event === "result" && obj.result && typeof obj.result === "object") {
    const res = obj.result as Record<string, unknown>;
    const resConvId = typeof res.conversation_id === "string" ? res.conversation_id : convId;
    const status = typeof res.status === "string" ? res.status : "SUCCESS";
    if (status === "ERROR" || status === "FAILED") {
      const msg =
        (typeof res.error === "string" ? res.error : undefined) ||
        (typeof res.response === "string" ? res.response : undefined) ||
        "Antigravity execution failed.";
      events.push({ type: "error", message: msg });
    } else {
      const finalText =
        (typeof res.response === "string" && res.response.length > 0 ? res.response : undefined) ||
        state.accumulatedText ||
        undefined;
      events.push({ type: "done", finalText, sessionId: resConvId });
    }
    return events;
  }

  return events;
}

export function parseCopilotLine(line: string, state: ParserState): StreamEvent[] {
  const obj = safeJsonParse(line);
  if (!obj) {
    const trimmed = line.trim();
    if (trimmed.startsWith("Error:")) {
      return [{ type: "error", message: trimmed }];
    }
    return [];
  }

  const events: StreamEvent[] = [];
  const type = typeof obj.type === "string" ? obj.type : "";
  const data = obj.data && typeof obj.data === "object" ? (obj.data as Record<string, unknown>) : {};

  if (type === "session.start" && typeof data.sessionId === "string") {
    events.push({ type: "session", sessionId: data.sessionId });
    return events;
  }

  if (type === "assistant.message_delta" && typeof data.deltaContent === "string" && data.deltaContent.length > 0) {
    state.sawStreamDeltas = true;
    state.accumulatedText += data.deltaContent;
    events.push({ type: "text_delta", text: data.deltaContent });
    return events;
  }

  if (
    (type === "assistant.reasoning_delta" || type === "assistant.thinking_delta") &&
    typeof data.deltaContent === "string" &&
    data.deltaContent.length > 0
  ) {
    events.push({ type: "thinking_delta", text: data.deltaContent });
    return events;
  }

  if (type === "assistant.message") {
    if (typeof data.content === "string" && data.content.length > 0 && !state.sawStreamDeltas) {
      state.accumulatedText = data.content;
      events.push({ type: "text_replace", text: data.content });
    }
    const toolRequests = Array.isArray(data.toolRequests) ? data.toolRequests : [];
    for (const rawReq of toolRequests) {
      if (!rawReq || typeof rawReq !== "object") continue;
      const req = rawReq as Record<string, unknown>;
      const id = typeof req.toolCallId === "string" ? req.toolCallId : `cop-${Date.now()}`;
      const name = typeof req.name === "string" ? req.name : "Tool";
      events.push({
        type: "tool_start",
        id,
        name,
        detail: summarizeToolInput(req.arguments),
      });
    }
    return events;
  }

  if (type === "tool.execution_start") {
    const id = typeof data.toolCallId === "string" ? data.toolCallId : `cop-${Date.now()}`;
    const name = typeof data.toolName === "string" ? data.toolName : "Tool";
    events.push({
      type: "tool_start",
      id,
      name,
      detail: summarizeToolInput(data.arguments),
    });
    return events;
  }

  if (type === "tool.execution_complete") {
    const id = typeof data.toolCallId === "string" ? data.toolCallId : "";
    if (id) {
      events.push({
        type: "tool_end",
        id,
        name: typeof data.toolName === "string" ? data.toolName : undefined,
        isError: data.success === false,
      });
    }
    return events;
  }

  if (type === "result") {
    const sessionId = typeof obj.sessionId === "string" ? obj.sessionId : undefined;
    if (sessionId) {
      events.push({ type: "session", sessionId });
    }
    const exitCode = typeof obj.exitCode === "number" ? obj.exitCode : 0;
    if (exitCode !== 0) {
      events.push({
        type: "error",
        message: `Copilot exited with code ${exitCode}.`,
      });
    } else {
      events.push({
        type: "done",
        finalText: state.accumulatedText || undefined,
        sessionId,
      });
    }
    return events;
  }

  return events;
}

export function parseOpencodeLine(line: string, state: ParserState): StreamEvent[] {
  const obj = safeJsonParse(line);
  if (!obj) return [];

  const events: StreamEvent[] = [];
  const type = typeof obj.type === "string" ? obj.type : "";
  const sessionId = typeof obj.sessionID === "string" ? obj.sessionID : undefined;
  if (sessionId) {
    events.push({ type: "session", sessionId });
  }

  if (type === "error") {
    const err = obj.error && typeof obj.error === "object" ? (obj.error as Record<string, unknown>) : null;
    const msg =
      (err && typeof err.message === "string" ? err.message : undefined) ||
      "OpenCode execution failed.";
    events.push({ type: "error", message: msg });
    return events;
  }

  const part = obj.part && typeof obj.part === "object" ? (obj.part as Record<string, unknown>) : null;
  if (type === "text" && part && typeof part.text === "string") {
    state.sawStreamDeltas = true;
    state.accumulatedText += part.text;
    events.push({ type: "text_delta", text: part.text });
    return events;
  }

  if (type === "reasoning" && part && typeof part.text === "string") {
    events.push({ type: "thinking_delta", text: part.text });
    return events;
  }

  if (type === "tool_use" && part) {
    const id = typeof part.callID === "string" ? part.callID : typeof part.id === "string" ? part.id : `oc-${Date.now()}`;
    const name = typeof part.tool === "string" ? part.tool : "Tool";
    const partState = part.state && typeof part.state === "object" ? (part.state as Record<string, unknown>) : null;
    const status = partState && typeof partState.status === "string" ? partState.status : "";
    const detail = partState ? summarizeToolInput(partState.input) : undefined;
    if (status === "completed" || status === "error") {
      events.push({
        type: "tool_end",
        id,
        name,
        detail,
        isError: status === "error",
      });
    } else {
      events.push({ type: "tool_start", id, name, detail });
    }
    return events;
  }

  if (type === "step_finish") {
    events.push({
      type: "done",
      finalText: state.accumulatedText || undefined,
      sessionId,
    });
    return events;
  }

  return events;
}

export function parseProviderLine(
  provider: ProviderId,
  line: string,
  state: ParserState,
): StreamEvent[] {
  switch (provider) {
    case "claude":
      return parseClaudeLine(line, state);
    case "codex":
      return parseCodexLine(line, state);
    case "antigravity":
      return parseAgyLine(line, state);
    case "copilot":
      return parseCopilotLine(line, state);
    case "opencode":
      return parseOpencodeLine(line, state);
  }
}
