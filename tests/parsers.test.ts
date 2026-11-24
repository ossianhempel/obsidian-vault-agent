import { describe, expect, it } from "vitest";
import {
  createParserState,
  parseAgyLine,
  parseClaudeLine,
  parseCodexLine,
  parseCopilotLine,
  parseOpencodeLine,
} from "../src/providers/parsers";

describe("provider stream parsers", () => {
  it("parses Claude stream-json events including deltas, tools, and result", () => {
    const state = createParserState();

    const initEvents = parseClaudeLine(
      JSON.stringify({ type: "system", subtype: "init", session_id: "sess-claude-1" }),
      state,
    );
    expect(initEvents).toContainEqual({ type: "session", sessionId: "sess-claude-1" });

    const deltaEvents = parseClaudeLine(
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Found [[Atomic Note]]" },
        },
      }),
      state,
    );
    expect(deltaEvents).toEqual([{ type: "text_delta", text: "Found [[Atomic Note]]" }]);

    // Subsequent full assistant frame should not duplicate streamed text, but should parse tool_use
    const toolEvents = parseClaudeLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Found [[Atomic Note]]" },
            {
              type: "tool_use",
              id: "tu_1",
              name: "Bash",
              input: { command: 'obsidian search query="habits"' },
            },
          ],
        },
      }),
      state,
    );
    expect(toolEvents).toEqual([
      {
        type: "tool_start",
        id: "tu_1",
        name: "Bash",
        detail: 'obsidian search query="habits"',
      },
    ]);

    const toolDone = parseClaudeLine(
      JSON.stringify({
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "tu_1", is_error: false }],
        },
      }),
      state,
    );
    expect(toolDone).toEqual([{ type: "tool_end", id: "tu_1", isError: false }]);

    const doneEvents = parseClaudeLine(
      JSON.stringify({
        type: "result",
        is_error: false,
        session_id: "sess-claude-1",
        result: "Found [[Atomic Note]]",
      }),
      state,
    );
    expect(doneEvents).toContainEqual({
      type: "done",
      finalText: "Found [[Atomic Note]]",
      sessionId: "sess-claude-1",
    });
  });

  it("parses Codex JSONL and ignores non-fatal config warning items", () => {
    const state = createParserState();

    expect(
      parseCodexLine(JSON.stringify({ type: "thread.started", thread_id: "codex-t1" }), state),
    ).toEqual([{ type: "session", sessionId: "codex-t1" }]);

    // Non-fatal config warning before turn starts
    expect(
      parseCodexLine(
        JSON.stringify({
          type: "item.completed",
          item: { id: "item_0", type: "error", message: "deprecated feature" },
        }),
        state,
      ),
    ).toEqual([]);

    expect(
      parseCodexLine(
        JSON.stringify({
          type: "item.started",
          item: { id: "cmd_1", type: "command_execution", command: "obsidian backlinks file=Focus" },
        }),
        state,
      ),
    ).toEqual([
      { type: "tool_start", id: "cmd_1", name: "Bash", detail: "obsidian backlinks file=Focus" },
    ]);

    expect(
      parseCodexLine(
        JSON.stringify({
          type: "item.completed",
          item: { id: "msg_1", type: "agent_message", text: "See [[Focus]] and [[Deep Work]]." },
        }),
        state,
      ),
    ).toEqual([{ type: "text_replace", text: "See [[Focus]] and [[Deep Work]]." }]);

    expect(parseCodexLine(JSON.stringify({ type: "turn.completed" }), state)).toEqual([
      { type: "done", finalText: "See [[Focus]] and [[Deep Work]]." },
    ]);
  });

  it("parses Antigravity (agy) stream-json events", () => {
    const state = createParserState();

    expect(
      parseAgyLine(
        JSON.stringify({ event: "init", conversation_id: "agy-conv-1" }),
        state,
      ),
    ).toEqual([{ type: "session", sessionId: "agy-conv-1" }]);

    expect(
      parseAgyLine(
        JSON.stringify({
          event: "step_update",
          step_update: {
            conversation_id: "agy-conv-1",
            step_index: 1,
            state: "DONE",
            step_type: "agent_response",
            text_delta: "Related notes: [[Writing Habit]]",
          },
        }),
        state,
      ),
    ).toEqual([
      { type: "session", sessionId: "agy-conv-1" },
      { type: "text_delta", text: "Related notes: [[Writing Habit]]" },
    ]);

    expect(
      parseAgyLine(
        JSON.stringify({
          event: "result",
          result: {
            conversation_id: "agy-conv-1",
            status: "SUCCESS",
            response: "Related notes: [[Writing Habit]]",
          },
        }),
        state,
      ),
    ).toEqual([
      {
        type: "done",
        finalText: "Related notes: [[Writing Habit]]",
        sessionId: "agy-conv-1",
      },
    ]);
  });

  it("parses Copilot JSONL deltas, errors, and results", () => {
    const state = createParserState();

    expect(
      parseCopilotLine(
        JSON.stringify({ type: "session.start", data: { sessionId: "cop-1" } }),
        state,
      ),
    ).toEqual([{ type: "session", sessionId: "cop-1" }]);

    expect(
      parseCopilotLine(
        JSON.stringify({
          type: "assistant.message_delta",
          data: { deltaContent: "Hello from Copilot" },
        }),
        state,
      ),
    ).toEqual([{ type: "text_delta", text: "Hello from Copilot" }]);

    expect(
      parseCopilotLine(
        JSON.stringify({ type: "result", sessionId: "cop-1", exitCode: 0 }),
        state,
      ),
    ).toEqual([
      { type: "session", sessionId: "cop-1" },
      { type: "done", finalText: "Hello from Copilot", sessionId: "cop-1" },
    ]);

    expect(
      parseCopilotLine('Error: Model "auto" does not support reasoning effort', state),
    ).toEqual([
      { type: "error", message: 'Error: Model "auto" does not support reasoning effort' },
    ]);
  });

  it("parses OpenCode JSON events including errors", () => {
    const state = createParserState();

    expect(
      parseOpencodeLine(
        JSON.stringify({
          type: "text",
          sessionID: "ses_oc_1",
          part: { text: "Matches found" },
        }),
        state,
      ),
    ).toEqual([
      { type: "session", sessionId: "ses_oc_1" },
      { type: "text_delta", text: "Matches found" },
    ]);

    expect(
      parseOpencodeLine(
        JSON.stringify({
          type: "error",
          sessionID: "ses_oc_1",
          error: { message: "API key expired" },
        }),
        state,
      ),
    ).toEqual([
      { type: "session", sessionId: "ses_oc_1" },
      { type: "error", message: "API key expired" },
    ]);
  });
});
