export type ProviderId = "claude" | "codex" | "antigravity" | "copilot" | "opencode";

export type EffortLevel =
  | "default"
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra";

export type AgentMode = "ask" | "agent";

export interface ModelInfo {
  id: string;
  label: string;
  efforts: EffortLevel[];
  defaultEffort: EffortLevel;
  /** Optional provider-specific model ID map by effort (used by Antigravity) */
  effortModelIds?: Partial<Record<EffortLevel, string>>;
}

export interface ProviderInfo {
  id: ProviderId;
  displayName: string;
  binaryName: string;
  installed: boolean;
  binaryPath: string | null;
  models: ModelInfo[];
}

export interface TextSnippetAttachment {
  id: string;
  filePath: string;
  fileName: string;
  startLine: number;
  endLine: number;
  /** Character offsets in the document (used for CodeMirror visual marks) */
  fromOffset?: number;
  toOffset?: number;
  heading?: string;
  pattern?: string;
  text: string;
  createdAt: number;
}

export interface ActiveFileContext {
  filePath: string;
  fileName: string;
  title: string;
  tags: string[];
  cursorLine?: number;
  activeHeading?: string;
  content?: string;
  truncated?: boolean;
  totalChars?: number;
}

export interface ToolActivityItem {
  id: string;
  name: string;
  detail?: string;
  status: "running" | "done" | "error";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  provider?: ProviderId;
  model?: string;
  effort?: EffortLevel;
  mode?: AgentMode;
  activeFilePath?: string | null;
  snippets?: TextSnippetAttachment[];
  activities?: ToolActivityItem[];
  thinking?: string;
  isError?: boolean;
  durationMs?: number;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  provider: ProviderId;
  model: string;
  effort: EffortLevel;
  mode: AgentMode;
  /** Native CLI session/conversation IDs keyed by provider for seamless --resume */
  providerSessionIds: Partial<Record<ProviderId, string>>;
  messages: ChatMessage[];
}

export interface VaultAgentSettings {
  defaultProvider: ProviderId;
  defaultModelByProvider: Partial<Record<ProviderId, string>>;
  defaultEffortByProvider: Partial<Record<ProviderId, EffortLevel>>;
  defaultMode: AgentMode;
  autoAttachActiveFile: boolean;
  includeActiveFileContent: boolean;
  maxActiveFileChars: number;
  enableObsidianCliGuidance: boolean;
  injectObsidianSkill: boolean;
  obsidianSkillPathOverride: string;
  injectVaultAgentsMd: boolean;
  highlightMarkedSnippets: boolean;
  customSystemPrompt: string;
  binaryOverrides: Partial<Record<ProviderId | "obsidian", string>>;
  customModelsByProvider: Partial<Record<ProviderId, string[]>>;
}

export interface PersistedPluginData {
  settings: VaultAgentSettings;
  sessions: ChatSession[];
  activeSessionId: string | null;
}

export type StreamEvent =
  | { type: "session"; sessionId: string }
  | { type: "text_delta"; text: string }
  | { type: "text_replace"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_start"; id: string; name: string; detail?: string }
  | { type: "tool_end"; id: string; name?: string; detail?: string; isError?: boolean }
  | { type: "error"; message: string }
  | { type: "done"; finalText?: string; sessionId?: string };

export const DEFAULT_SETTINGS: VaultAgentSettings = {
  defaultProvider: "claude",
  defaultModelByProvider: {
    claude: "claude-sonnet-5-5",
    codex: "gpt-6.2-sol",
    antigravity: "gemini-4-neon",
    copilot: "auto",
    opencode: "opencode-go/claude-haiku-5-5",
  },
  defaultEffortByProvider: {
    claude: "medium",
    codex: "medium",
    antigravity: "high",
    copilot: "default",
    opencode: "medium",
  },
  defaultMode: "ask",
  autoAttachActiveFile: true,
  includeActiveFileContent: true,
  maxActiveFileChars: 24000,
  enableObsidianCliGuidance: true,
  injectObsidianSkill: true,
  obsidianSkillPathOverride: "",
  injectVaultAgentsMd: true,
  highlightMarkedSnippets: true,
  customSystemPrompt: "",
  binaryOverrides: {},
  customModelsByProvider: {},
};
