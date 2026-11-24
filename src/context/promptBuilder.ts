import type {
  ActiveFileContext,
  AgentMode,
  ChatMessage,
  TextSnippetAttachment,
  VaultAgentSettings,
} from "../types";
import type { VaultKnowledge } from "./vaultKnowledge";

export interface PromptBuildInput {
  userMessage: string;
  vaultName: string;
  vaultRootPath: string;
  mode: AgentMode;
  activeFile: ActiveFileContext | null;
  snippets: TextSnippetAttachment[];
  settings: VaultAgentSettings;
  obsidianCliAvailable: boolean;
  vaultKnowledge?: VaultKnowledge;
  /** Provided when starting a fresh provider session mid-conversation (e.g. after switching providers) */
  priorHistory?: ChatMessage[];
  /** True when the provider CLI already receives systemInstructions separately */
  hasNativeSystemPrompt: boolean;
  /** True when resuming an existing native CLI session (avoids repeating bulky system prompt inline) */
  isResumingSession?: boolean;
}

export function buildSystemInstructions(input: {
  vaultName: string;
  vaultRootPath: string;
  mode: AgentMode;
  enableObsidianCliGuidance: boolean;
  obsidianCliAvailable: boolean;
  vaultKnowledge?: VaultKnowledge;
  customSystemPrompt?: string;
}): string {
  const lines: string[] = [
    `You are an AI assistant embedded inside Obsidian for the vault "${input.vaultName}".`,
    `Vault root directory: ${input.vaultRootPath}`,
    "",
    "Core behavior:",
    "- Reference notes in your responses using Obsidian wikilinks like [[Note Title]] and include vault-relative paths when helpful so the user can open them directly.",
    "- Be concise, grounded in actual vault contents, and cite exact notes/passages you found.",
  ];

  if (input.mode === "ask") {
    lines.push(
      "- Mode is ASK (READ-ONLY): DO NOT modify, create, move, or delete any files in the vault. Only read, search, analyze, and suggest edits.",
    );
  } else {
    lines.push(
      "- Mode is AGENT (EDIT ENABLED): You may read, search, create, and edit notes in the vault when requested. Follow the vault's conventions in AGENTS.md / LINKING.md and never edit files under .obsidian/.",
    );
  }

  if (input.enableObsidianCliGuidance) {
    lines.push(
      "",
      "Vault traversal & Obsidian CLI:",
      "- You can inspect vault files directly in the current working directory (the vault root) using read/grep/glob tools.",
    );
    if (input.obsidianCliAvailable) {
      lines.push(
        `- The Obsidian CLI (\`obsidian\`) is available and connected to the running Obsidian app (target with \`vault="${input.vaultName}"\` if multiple vaults are open):`,
        '  - Full-text search: `obsidian search query="topic" limit=20` or `obsidian search:context query="topic"`',
        '  - Graph traversal: `obsidian backlinks file="Note Name"`, `obsidian links file="Note Name"`, `obsidian unresolved`, `obsidian orphans`, `obsidian deadends`',
        '  - Files & structure: `obsidian files folder="Notes"`, `obsidian read path="Notes/Example.md"`, `obsidian outline path="Notes/Example.md"`, `obsidian daily:read`',
        '  - Metadata & Bases: `obsidian tags`, `obsidian properties path="..."`, `obsidian property:read name="status" path="..."`, `obsidian base:query path="..."`',
      );
      if (input.mode === "agent") {
        lines.push(
          '  - Writing via CLI (Agent mode only): `obsidian create ...`, `obsidian append path="..." content="..."`, `obsidian daily:append content="..."`, `obsidian property:set name="..." value="..." path="..."`',
        );
      }
    } else {
      lines.push(
        "- Note: the `obsidian` CLI binary was not detected in PATH; traverse the vault using file listing, grep/ripgrep, and file read tools.",
      );
    }
  }

  const vk = input.vaultKnowledge;
  if (vk) {
    if (vk.vaultGuideFiles.length > 0) {
      lines.push(
        "",
        `Additional vault guide files available in the vault root: ${vk.vaultGuideFiles.join(", ")} (read them before editing or drafting when relevant).`,
      );
    }

    if (vk.agentsDocContent) {
      lines.push(
        "",
        "<vault_agents_instructions>",
        vk.agentsDocContent,
        "</vault_agents_instructions>",
      );
    }

    if (vk.obsidianSkillContent) {
      lines.push(
        "",
        "<obsidian_skill>",
        "Note: Because you are running inside a live Obsidian session, the `obsidian` CLI IS live and encouraged for search/backlinks/links/bases/properties. Where this skill differs from <vault_agents_instructions>, the vault's own AGENTS.md takes precedence.",
        "",
        vk.obsidianSkillContent,
        "</obsidian_skill>",
      );
    }
  }

  const custom = input.customSystemPrompt?.trim();
  if (custom) {
    lines.push("", "User custom instructions:", custom);
  }

  return lines.join("\n");
}

function formatSnippetXml(snippet: TextSnippetAttachment, index: number): string {
  const attrs: string[] = [
    `index="${index + 1}"`,
    `path="${escapeAttr(snippet.filePath)}"`,
    `lines="L${snippet.startLine}-L${snippet.endLine}"`,
  ];
  if (snippet.heading) {
    attrs.push(`heading="${escapeAttr(snippet.heading)}"`);
  }
  if (snippet.pattern) {
    attrs.push(`matched_pattern="${escapeAttr(snippet.pattern)}"`);
  }
  return `<attached_excerpt ${attrs.join(" ")}>\n${snippet.text}\n</attached_excerpt>`;
}

function formatActiveFileXml(activeFile: ActiveFileContext): string {
  const attrs: string[] = [
    `path="${escapeAttr(activeFile.filePath)}"`,
    `title="${escapeAttr(activeFile.title)}"`,
  ];
  if (activeFile.cursorLine !== undefined) {
    attrs.push(`cursor_line="${activeFile.cursorLine}"`);
  }
  if (activeFile.activeHeading) {
    attrs.push(`section="${escapeAttr(activeFile.activeHeading)}"`);
  }
  if (activeFile.tags.length > 0) {
    attrs.push(`tags="${escapeAttr(activeFile.tags.join(", "))}"`);
  }
  if (activeFile.truncated) {
    attrs.push(`truncated="true"`);
    if (activeFile.totalChars !== undefined) {
      attrs.push(`total_chars="${activeFile.totalChars}"`);
    }
  }

  if (activeFile.content !== undefined) {
    return `<focused_obsidian_file ${attrs.join(" ")}>\n${activeFile.content}\n</focused_obsidian_file>`;
  }
  return `<focused_obsidian_file ${attrs.join(" ")} />`;
}

function formatPriorHistory(messages: ChatMessage[]): string {
  const recent = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-8);
  if (recent.length === 0) return "";
  const formatted = recent
    .map((m) => {
      const role = m.role === "user" ? "User" : "Assistant";
      const snippetNote =
        m.snippets && m.snippets.length > 0
          ? ` [attached ${m.snippets.length} excerpt(s): ${m.snippets.map((s) => `${s.filePath}:L${s.startLine}-${s.endLine}`).join(", ")}]`
          : "";
      const body = m.content.length > 2500 ? `${m.content.slice(0, 2500)}\n...[truncated]` : m.content;
      return `${role}${snippetNote}:\n${body}`;
    })
    .join("\n\n");
  return `<prior_conversation_context>\n${formatted}\n</prior_conversation_context>`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildUserTurnPrompt(input: PromptBuildInput): {
  systemInstructions: string;
  prompt: string;
} {
  const systemInstructions = buildSystemInstructions({
    vaultName: input.vaultName,
    vaultRootPath: input.vaultRootPath,
    mode: input.mode,
    enableObsidianCliGuidance: input.settings.enableObsidianCliGuidance,
    obsidianCliAvailable: input.obsidianCliAvailable,
    vaultKnowledge: input.vaultKnowledge,
    customSystemPrompt: input.settings.customSystemPrompt,
  });

  const sections: string[] = [];

  if (!input.hasNativeSystemPrompt && !input.isResumingSession) {
    sections.push(`<system_instructions>\n${systemInstructions}\n</system_instructions>`);
  }

  if (input.priorHistory && input.priorHistory.length > 0) {
    const historyBlock = formatPriorHistory(input.priorHistory);
    if (historyBlock) sections.push(historyBlock);
  }

  const contextParts: string[] = [];
  if (input.activeFile) {
    contextParts.push(formatActiveFileXml(input.activeFile));
  }
  if (input.snippets.length > 0) {
    contextParts.push(
      input.snippets.map((snippet, idx) => formatSnippetXml(snippet, idx)).join("\n\n"),
    );
  }

  if (contextParts.length > 0) {
    sections.push(`<obsidian_context>\n${contextParts.join("\n\n")}\n</obsidian_context>`);
  }

  sections.push(input.userMessage.trim());

  return {
    systemInstructions,
    prompt: sections.join("\n\n"),
  };
}
