import {
  Component,
  ItemView,
  MarkdownRenderer,
  Notice,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import { buildUserTurnPrompt } from "../context/promptBuilder";
import { PROVIDER_META, PROVIDER_ORDER } from "../providers/catalog";
import {
  providerSupportsNativeSystemPrompt,
  runProviderTurn,
  type RunningTurn,
} from "../providers/runner";
import type {
  ActiveFileContext,
  AgentMode,
  ChatMessage,
  ChatSession,
  EffortLevel,
  ModelInfo,
  ProviderId,
  TextSnippetAttachment,
  ToolActivityItem,
} from "../types";
import type VaultAgentPlugin from "../main";

export const VIEW_TYPE_VAULT_AGENT = "vault-agent-chat-view";

const EFFORT_LABELS: Record<EffortLevel, string> = {
  default: "Default",
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
  ultra: "Ultra",
};

export interface LiveSelectionPreview {
  filePath: string;
  fileName: string;
  startLine: number;
  endLine: number;
  lineCount: number;
  charCount: number;
}

export class VaultAgentChatView extends ItemView {
  private sessionSelectEl!: HTMLSelectElement;
  private messagesEl!: HTMLElement;
  private contextTrayEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private providerSelectEl!: HTMLSelectElement;
  private modelSelectEl!: HTMLSelectElement;
  private effortSelectEl!: HTMLSelectElement;
  private modeToggleBtn!: HTMLButtonElement;
  private sendBtn!: HTMLButtonElement;

  private activeTurn: RunningTurn | null = null;
  private activeFileIncludedOverride: boolean | null = null;
  private renderComponent = new Component();
  private userScrolledUp = false;
  private streamRenderTimer: ReturnType<typeof setTimeout> | null = null;
  private streamingBodyEl: HTMLElement | null = null;
  private streamingActivityEl: HTMLElement | null = null;
  private streamingThinkingEl: HTMLElement | null = null;
  private streamingMsg: ChatMessage | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: VaultAgentPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_VAULT_AGENT;
  }

  getDisplayText(): string {
    return "Vault Agent";
  }

  getIcon(): string {
    return "sparkles";
  }

  async onOpen(): Promise<void> {
    this.renderComponent.load();
    this.contentEl.empty();
    this.contentEl.addClass("vault-agent-root");

    this.buildHeader();
    this.buildMessagesContainer();
    this.buildComposer();

    this.refreshAll();
  }

  async onClose(): Promise<void> {
    this.stopCurrentTurn();
    if (this.streamRenderTimer) {
      clearTimeout(this.streamRenderTimer);
      this.streamRenderTimer = null;
    }
    this.renderComponent.unload();
  }

  public focusInput(): void {
    this.inputEl?.focus();
  }

  public refreshAll(): void {
    if (!this.messagesEl) return;
    this.renderSessionHeader();
    this.renderMessages();
    this.renderContextTray();
    this.renderControls();
  }

  public refreshContextOnly(): void {
    if (!this.contextTrayEl) return;
    this.renderContextTray();
  }

  private buildHeader(): void {
    const header = this.contentEl.createDiv({ cls: "vault-agent-header" });

    const left = header.createDiv({ cls: "vault-agent-header-left" });
    this.sessionSelectEl = left.createEl("select", {
      cls: "vault-agent-session-select",
      attr: { "aria-label": "Chat session" },
    });
    this.sessionSelectEl.addEventListener("change", async () => {
      const id = this.sessionSelectEl.value;
      if (id) {
        await this.plugin.setActiveSession(id);
      }
    });

    const actions = header.createDiv({ cls: "vault-agent-header-actions" });

    const newBtn = actions.createEl("button", {
      cls: "clickable-icon vault-agent-icon-btn",
      attr: { "aria-label": "New chat", title: "New chat" },
    });
    setIcon(newBtn, "plus");
    newBtn.addEventListener("click", async () => {
      if (this.activeTurn) {
        this.stopCurrentTurn();
      }
      await this.plugin.createNewSession();
      this.focusInput();
    });

    const clearBtn = actions.createEl("button", {
      cls: "clickable-icon vault-agent-icon-btn",
      attr: { "aria-label": "Delete chat", title: "Delete current chat" },
    });
    setIcon(clearBtn, "trash-2");
    clearBtn.addEventListener("click", async () => {
      if (this.activeTurn) {
        this.stopCurrentTurn();
      }
      await this.plugin.deleteActiveSession();
    });
  }

  private buildMessagesContainer(): void {
    this.messagesEl = this.contentEl.createDiv({ cls: "vault-agent-messages" });
    this.messagesEl.addEventListener("scroll", () => {
      const distanceFromBottom =
        this.messagesEl.scrollHeight -
        this.messagesEl.scrollTop -
        this.messagesEl.clientHeight;
      this.userScrolledUp = distanceFromBottom > 60;
    });
  }

  private buildComposer(): void {
    const composerWrap = this.contentEl.createDiv({ cls: "vault-agent-composer-wrap" });

    this.contextTrayEl = composerWrap.createDiv({ cls: "vault-agent-context-tray" });

    const box = composerWrap.createDiv({ cls: "vault-agent-composer-box" });
    this.inputEl = box.createEl("textarea", {
      cls: "vault-agent-input",
      attr: {
        placeholder:
          "Ask about your note, attached excerpts, or vault… (Enter to send, Shift+Enter for newline)",
        rows: "2",
      },
    });

    this.inputEl.addEventListener("input", () => {
      this.autoResizeInput();
    });

    this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void this.handleSend();
      } else if (e.key === "Escape" && this.activeTurn) {
        e.preventDefault();
        this.stopCurrentTurn();
      }
    });

    const footer = box.createDiv({ cls: "vault-agent-composer-footer" });

    const modelRow = footer.createDiv({ cls: "vault-agent-footer-row" });

    this.providerSelectEl = modelRow.createEl("select", {
      cls: "vault-agent-picker vault-agent-picker-provider",
      attr: { "aria-label": "AI Provider", title: "AI Provider" },
    });
    this.providerSelectEl.addEventListener("change", async () => {
      const provider = this.providerSelectEl.value as ProviderId;
      await this.handleProviderChange(provider);
    });

    this.modelSelectEl = modelRow.createEl("select", {
      cls: "vault-agent-picker vault-agent-picker-model",
      attr: { "aria-label": "Model", title: "Model" },
    });
    this.modelSelectEl.addEventListener("change", async () => {
      const session = this.plugin.getActiveSession();
      session.model = this.modelSelectEl.value;
      this.plugin.settings.defaultModelByProvider[session.provider] = session.model;
      const modelInfo = this.getModelInfo(session.provider, session.model);
      if (modelInfo && !modelInfo.efforts.includes(session.effort)) {
        session.effort = modelInfo.defaultEffort;
      }
      await this.plugin.savePluginData();
      this.renderControls();
    });

    const actionRow = footer.createDiv({ cls: "vault-agent-footer-row vault-agent-footer-actions" });
    const actionLeft = actionRow.createDiv({ cls: "vault-agent-footer-left" });

    this.effortSelectEl = actionLeft.createEl("select", {
      cls: "vault-agent-picker vault-agent-picker-effort",
      attr: { "aria-label": "Effort level", title: "Reasoning effort level" },
    });
    this.effortSelectEl.addEventListener("change", async () => {
      const session = this.plugin.getActiveSession();
      session.effort = this.effortSelectEl.value as EffortLevel;
      this.plugin.settings.defaultEffortByProvider[session.provider] = session.effort;
      await this.plugin.savePluginData();
    });

    this.modeToggleBtn = actionLeft.createEl("button", {
      cls: "vault-agent-mode-btn",
      attr: { type: "button" },
    });
    this.modeToggleBtn.addEventListener("click", async () => {
      const session = this.plugin.getActiveSession();
      session.mode = session.mode === "ask" ? "agent" : "ask";
      this.plugin.settings.defaultMode = session.mode;
      await this.plugin.savePluginData();
      this.renderControls();
    });

    this.sendBtn = actionRow.createEl("button", {
      cls: "vault-agent-send-btn mod-cta",
      attr: { type: "button", "aria-label": "Send message" },
    });
    this.sendBtn.addEventListener("click", () => {
      if (this.activeTurn) {
        this.stopCurrentTurn();
      } else {
        void this.handleSend();
      }
    });
  }

  private autoResizeInput(): void {
    if (!this.inputEl) return;
    this.inputEl.style.height = "auto";
    const max = 180;
    this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, max)}px`;
  }

  private renderSessionHeader(): void {
    const active = this.plugin.getActiveSession();
    this.sessionSelectEl.empty();
    for (const s of this.plugin.sessions) {
      const count = s.messages.length;
      const opt = this.sessionSelectEl.createEl("option", {
        value: s.id,
        text: count > 0 ? `${s.title} (${count})` : s.title,
      });
      if (s.id === active.id) opt.selected = true;
    }
  }

  private getModelInfo(provider: ProviderId, modelId: string): ModelInfo | undefined {
    const p = this.plugin.providers[provider];
    return p?.models.find((m) => m.id === modelId);
  }

  private renderControls(): void {
    const session = this.plugin.getActiveSession();

    // Provider selector
    this.providerSelectEl.empty();
    for (const pid of PROVIDER_ORDER) {
      const info = this.plugin.providers[pid];
      const installed = info?.installed ?? !this.plugin.providersLoaded;
      const label = installed
        ? PROVIDER_META[pid].displayName
        : `${PROVIDER_META[pid].displayName} (missing)`;
      const opt = this.providerSelectEl.createEl("option", {
        value: pid,
        text: label,
      });
      if (pid === session.provider) opt.selected = true;
    }

    // Model selector
    const providerInfo = this.plugin.providers[session.provider];
    const models = providerInfo?.models ?? [];
    this.modelSelectEl.empty();
    let matchedModel = models.find((m) => m.id === session.model);
    if (!matchedModel && models.length > 0) {
      matchedModel = models[0];
      session.model = matchedModel.id;
    }
    if (models.length === 0 && !this.plugin.providersLoaded) {
      this.modelSelectEl.createEl("option", {
        value: session.model,
        text: session.model || "Loading models…",
      });
    } else {
      for (const m of models) {
        const opt = this.modelSelectEl.createEl("option", {
          value: m.id,
          text: m.label,
        });
        if (m.id === session.model) opt.selected = true;
      }
    }

    // Effort selector
    const efforts: EffortLevel[] = matchedModel?.efforts ?? ["default", "low", "medium", "high"];
    if (!efforts.includes(session.effort)) {
      session.effort = matchedModel?.defaultEffort ?? efforts[0] ?? "default";
    }
    this.effortSelectEl.empty();
    for (const eff of efforts) {
      const opt = this.effortSelectEl.createEl("option", {
        value: eff,
        text: EFFORT_LABELS[eff] ?? eff,
      });
      if (eff === session.effort) opt.selected = true;
    }
    const onlyDefault = efforts.length === 1 && efforts[0] === "default";
    this.effortSelectEl.disabled = onlyDefault;
    this.effortSelectEl.title = onlyDefault
      ? "Effort level is managed automatically for this model"
      : "Reasoning effort level";

    // Mode button
    const isAgent = session.mode === "agent";
    this.modeToggleBtn.empty();
    this.modeToggleBtn.toggleClass("is-agent", isAgent);
    this.modeToggleBtn.setText(isAgent ? "Agent" : "Ask");
    this.modeToggleBtn.title = isAgent
      ? "Agent mode: can read, traverse, and edit vault notes (click to switch to read-only Ask mode)"
      : "Ask mode (read-only): can read and traverse the vault without modifying files (click to enable Agent edits)";

    // Send / Stop button
    this.sendBtn.empty();
    if (this.activeTurn) {
      setIcon(this.sendBtn, "square");
      this.sendBtn.addClass("is-stop");
      this.sendBtn.setAttr("aria-label", "Stop generation");
      this.sendBtn.title = "Stop (Esc)";
    } else {
      setIcon(this.sendBtn, "arrow-up");
      this.sendBtn.removeClass("is-stop");
      this.sendBtn.setAttr("aria-label", "Send message");
      this.sendBtn.title = "Send (Enter)";
    }
  }

  private isActiveFileIncluded(): boolean {
    if (this.activeFileIncludedOverride !== null) {
      return this.activeFileIncludedOverride;
    }
    return this.plugin.settings.autoAttachActiveFile;
  }

  private renderContextTray(): void {
    this.contextTrayEl.empty();

    const activeFile = this.plugin.getActiveFile();
    const liveSelection = this.plugin.getLiveSelectionPreview();
    const snippets = this.plugin.getDraftSnippets();

    const row = this.contextTrayEl.createDiv({ cls: "vault-agent-chip-row" });

    // 1. Focused file chip
    if (activeFile) {
      const included = this.isActiveFileIncluded();
      const fileChip = row.createDiv({
        cls: `vault-agent-chip vault-agent-chip-file ${included ? "is-active" : "is-muted"}`,
        attr: {
          title: included
            ? `Focused note automatically attached: ${activeFile.path} (click eye to exclude)`
            : `Focused note excluded: ${activeFile.path} (click eye to include)`,
        },
      });

      const iconSpan = fileChip.createSpan({ cls: "vault-agent-chip-icon" });
      setIcon(iconSpan, "file-text");

      const nameBtn = fileChip.createSpan({
        text: activeFile.basename,
        cls: "vault-agent-chip-label",
      });
      nameBtn.addEventListener("click", () => {
        void this.app.workspace.openLinkText(activeFile.path, "", false);
      });

      const toggleBtn = fileChip.createEl("button", {
        cls: "vault-agent-chip-action",
        attr: {
          type: "button",
          "aria-label": included ? "Exclude focused note" : "Include focused note",
          title: included ? "Exclude focused note from next message" : "Include focused note",
        },
      });
      setIcon(toggleBtn, included ? "eye" : "eye-off");
      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.activeFileIncludedOverride = !included;
        this.renderContextTray();
      });
    } else {
      const emptyChip = row.createDiv({
        cls: "vault-agent-chip is-muted",
        text: "No focused note",
      });
      emptyChip.title = "Open a Markdown note to automatically attach it";
    }

    // 2. Pattern attach button
    if (activeFile) {
      const patternBtn = row.createEl("button", {
        cls: "vault-agent-chip vault-agent-chip-action-pill",
        attr: {
          type: "button",
          title: "Find and attach all passages matching a text/regex pattern in the active note",
        },
      });
      const patIcon = patternBtn.createSpan({ cls: "vault-agent-chip-icon" });
      setIcon(patIcon, "search-code");
      patternBtn.createSpan({ text: "Pattern" });
      patternBtn.addEventListener("click", () => {
        void this.plugin.openAttachPatternModal();
      });
    }

    // 3. Live selection quick-attach pill
    if (liveSelection) {
      const selBtn = row.createEl("button", {
        cls: "vault-agent-chip vault-agent-chip-selection-cta",
        attr: {
          type: "button",
          title: `Attach currently selected text from ${liveSelection.filePath} (L${liveSelection.startLine}-L${liveSelection.endLine})`,
        },
      });
      const plusIcon = selBtn.createSpan({ cls: "vault-agent-chip-icon" });
      setIcon(plusIcon, "quote");
      selBtn.createSpan({
        text: `+ Attach selection (L${liveSelection.startLine}-L${liveSelection.endLine})`,
      });
      selBtn.addEventListener("click", () => {
        this.plugin.attachCurrentSelection(false);
      });
    }

    // 4. Attached marked text snippet chips
    if (snippets.length > 0) {
      const snipRow = this.contextTrayEl.createDiv({ cls: "vault-agent-chip-row" });
      for (const snip of snippets) {
        const chip = snipRow.createDiv({
          cls: "vault-agent-chip vault-agent-chip-snippet",
          attr: {
            title: `${snip.filePath} (L${snip.startLine}-L${snip.endLine})${snip.heading ? ` · ${snip.heading}` : ""}\n\n${snip.text.slice(0, 300)}`,
          },
        });

        const quoteIcon = chip.createSpan({ cls: "vault-agent-chip-icon" });
        setIcon(quoteIcon, snip.pattern ? "regex" : "highlighter");

        const labelText = `${snip.fileName.replace(/\.md$/i, "")}:L${snip.startLine}${
          snip.endLine !== snip.startLine ? `-${snip.endLine}` : ""
        }`;
        const label = chip.createSpan({
          text: labelText,
          cls: "vault-agent-chip-label",
        });
        label.addEventListener("click", () => {
          void this.plugin.jumpToSnippet(snip);
        });

        const preview = snip.text.replace(/\s+/g, " ").trim();
        if (preview) {
          chip.createSpan({
            text: `“${preview.length > 26 ? `${preview.slice(0, 26)}…` : preview}”`,
            cls: "vault-agent-chip-preview",
          });
        }

        const rmBtn = chip.createEl("button", {
          cls: "vault-agent-chip-action",
          attr: {
            type: "button",
            "aria-label": "Remove snippet",
            title: "Remove snippet",
          },
        });
        setIcon(rmBtn, "x");
        rmBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.plugin.removeDraftSnippet(snip.id);
        });
      }

      if (snippets.length > 1) {
        const clearAllBtn = snipRow.createEl("button", {
          cls: "vault-agent-clear-snippets-btn",
          text: "Clear all",
          attr: { type: "button" },
        });
        clearAllBtn.addEventListener("click", () => {
          this.plugin.clearDraftSnippets();
        });
      }
    }
  }

  private renderMessages(): void {
    const session = this.plugin.getActiveSession();
    this.messagesEl.empty();
    this.streamingBodyEl = null;
    this.streamingActivityEl = null;
    this.streamingThinkingEl = null;

    if (session.messages.length === 0) {
      this.renderEmptyState();
      return;
    }

    for (const msg of session.messages) {
      this.renderMessageElement(msg, msg === this.streamingMsg);
    }

    this.scrollToBottom(true);
  }

  private renderEmptyState(): void {
    const empty = this.messagesEl.createDiv({ cls: "vault-agent-empty" });
    const icon = empty.createDiv({ cls: "vault-agent-empty-icon" });
    setIcon(icon, "sparkles");
    empty.createEl("h4", { text: "Vault Agent" });
    empty.createEl("p", {
      text: "Select text in any note to mark & attach excerpts, or ask a question about your focused note and vault.",
    });

    const suggestions = [
      "Find other notes in my vault that write about the same topic as this note",
      "Suggest [[wikilinks]] to existing Evergreen notes that connect to this note",
      "Summarize the core argument and open questions in this note",
    ];

    const list = empty.createDiv({ cls: "vault-agent-suggestions" });
    for (const prompt of suggestions) {
      const btn = list.createEl("button", {
        cls: "vault-agent-suggestion-btn",
        text: prompt,
        attr: { type: "button" },
      });
      btn.addEventListener("click", () => {
        this.inputEl.value = prompt;
        this.autoResizeInput();
        this.focusInput();
      });
    }
  }

  private renderMessageElement(msg: ChatMessage, isStreaming: boolean): void {
    const row = this.messagesEl.createDiv({
      cls: `vault-agent-msg vault-agent-msg-${msg.role}${msg.isError ? " is-error" : ""}`,
    });

    if (msg.role === "user") {
      if (msg.activeFilePath || (msg.snippets && msg.snippets.length > 0)) {
        const metaRow = row.createDiv({ cls: "vault-agent-msg-attachments" });
        if (msg.activeFilePath) {
          const badge = metaRow.createSpan({
            cls: "vault-agent-msg-badge",
            text: `📄 ${msg.activeFilePath}`,
          });
          badge.addEventListener("click", () => {
            if (msg.activeFilePath) {
              void this.app.workspace.openLinkText(msg.activeFilePath, "", false);
            }
          });
        }
        for (const snip of msg.snippets ?? []) {
          const badge = metaRow.createSpan({
            cls: "vault-agent-msg-badge is-snippet",
            text: `✂ ${snip.fileName.replace(/\.md$/i, "")}:L${snip.startLine}-${snip.endLine}`,
            attr: { title: `${snip.filePath}\n\n${snip.text.slice(0, 400)}` },
          });
          badge.addEventListener("click", () => {
            void this.plugin.jumpToSnippet(snip);
          });
        }
      }

      const body = row.createDiv({ cls: "vault-agent-msg-body vault-agent-user-bubble" });
      body.setText(msg.content);
      return;
    }

    // Assistant message header
    const header = row.createDiv({ cls: "vault-agent-msg-header" });
    const providerLabel = msg.provider ? PROVIDER_META[msg.provider].displayName : "Assistant";
    const metaParts = [providerLabel];
    if (msg.model) metaParts.push(msg.model);
    if (msg.effort && msg.effort !== "default") metaParts.push(msg.effort);
    if (msg.durationMs) metaParts.push(`${(msg.durationMs / 1000).toFixed(1)}s`);
    header.createSpan({
      text: metaParts.join(" · "),
      cls: "vault-agent-msg-meta",
    });

    // Thinking collapsible
    const thinkingContainer = row.createDiv({ cls: "vault-agent-thinking-wrap" });
    this.renderThinkingBlock(thinkingContainer, msg.thinking);

    // Tool activity collapsible
    const activityContainer = row.createDiv({ cls: "vault-agent-activity-wrap" });
    this.renderActivityBlock(activityContainer, msg.activities ?? [], isStreaming);

    // Body
    const body = row.createDiv({ cls: "vault-agent-msg-body markdown-rendered" });
    if (isStreaming) {
      this.streamingThinkingEl = thinkingContainer;
      this.streamingActivityEl = activityContainer;
      this.streamingBodyEl = body;
      if (msg.content) {
        void this.renderMarkdownInto(body, msg.content, msg.activeFilePath ?? "");
      } else {
        body.createDiv({ cls: "vault-agent-streaming-placeholder", text: "Thinking…" });
      }
    } else {
      void this.renderMarkdownInto(body, msg.content || "(empty response)", msg.activeFilePath ?? "");
    }

    // Message action bar (for completed non-error assistant messages)
    if (!isStreaming && !msg.isError && msg.content.trim()) {
      const actions = row.createDiv({ cls: "vault-agent-msg-actions" });

      const copyBtn = actions.createEl("button", {
        cls: "vault-agent-msg-action-btn",
        text: "Copy",
        attr: { type: "button" },
      });
      copyBtn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(msg.content);
        new Notice("Copied response to clipboard.");
      });

      const insertBtn = actions.createEl("button", {
        cls: "vault-agent-msg-action-btn",
        text: "Insert into note",
        attr: { type: "button" },
      });
      insertBtn.addEventListener("click", () => {
        this.plugin.insertTextIntoActiveNote(msg.content);
      });
    }
  }

  private renderThinkingBlock(container: HTMLElement, thinking?: string): void {
    container.empty();
    if (!thinking || !thinking.trim()) return;
    const details = container.createEl("details", { cls: "vault-agent-collapsible" });
    details.createEl("summary", { text: "Reasoning" });
    details.createEl("pre", {
      cls: "vault-agent-thinking-text",
      text: thinking.trim(),
    });
  }

  private renderActivityBlock(
    container: HTMLElement,
    activities: ToolActivityItem[],
    isStreaming: boolean,
  ): void {
    container.empty();
    if (activities.length === 0) return;

    const runningCount = activities.filter((a) => a.status === "running").length;
    const details = container.createEl("details", {
      cls: "vault-agent-collapsible",
    });
    if (isStreaming && runningCount > 0) {
      details.open = true;
    }

    const summaryText =
      runningCount > 0
        ? `Working… (${activities.length} tool ${activities.length === 1 ? "call" : "calls"})`
        : `Used ${activities.length} tool ${activities.length === 1 ? "call" : "calls"}`;
    details.createEl("summary", { text: summaryText });

    const list = details.createDiv({ cls: "vault-agent-activity-list" });
    for (const act of activities) {
      const item = list.createDiv({
        cls: `vault-agent-activity-item is-${act.status}`,
      });
      const glyph = act.status === "running" ? "⋯" : act.status === "error" ? "✕" : "✓";
      item.createSpan({ text: glyph, cls: "vault-agent-activity-glyph" });
      item.createSpan({ text: act.name, cls: "vault-agent-activity-name" });
      if (act.detail) {
        item.createSpan({ text: act.detail, cls: "vault-agent-activity-detail" });
      }
    }
  }

  private async renderMarkdownInto(
    container: HTMLElement,
    markdown: string,
    sourcePath: string,
  ): Promise<void> {
    container.empty();
    await MarkdownRenderer.render(
      this.app,
      markdown,
      container,
      sourcePath,
      this.renderComponent,
    );

    // Wire internal [[wikilink]] clicks so notes open natively in Obsidian
    container.querySelectorAll("a.internal-link").forEach((anchor) => {
      anchor.addEventListener("click", (evt) => {
        evt.preventDefault();
        const href = anchor.getAttribute("data-href") || anchor.getAttribute("href");
        if (href) {
          const mouseEvt = evt as MouseEvent;
          void this.app.workspace.openLinkText(
            href,
            sourcePath,
            mouseEvt.metaKey || mouseEvt.ctrlKey,
          );
        }
      });
    });
  }

  private scheduleStreamRender(): void {
    if (this.streamRenderTimer) return;
    this.streamRenderTimer = setTimeout(() => {
      this.streamRenderTimer = null;
      if (!this.streamingMsg) return;
      if (this.streamingThinkingEl) {
        this.renderThinkingBlock(this.streamingThinkingEl, this.streamingMsg.thinking);
      }
      if (this.streamingActivityEl) {
        this.renderActivityBlock(
          this.streamingActivityEl,
          this.streamingMsg.activities ?? [],
          true,
        );
      }
      if (this.streamingBodyEl && this.streamingMsg.content) {
        void this.renderMarkdownInto(
          this.streamingBodyEl,
          this.streamingMsg.content,
          this.streamingMsg.activeFilePath ?? "",
        );
      }
      this.scrollToBottom(false);
    }, 80);
  }

  private scrollToBottom(force: boolean): void {
    if (!this.messagesEl) return;
    if (!force && this.userScrolledUp) return;
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private async handleProviderChange(provider: ProviderId): Promise<void> {
    const session = this.plugin.getActiveSession();
    session.provider = provider;
    this.plugin.settings.defaultProvider = provider;

    const info = this.plugin.providers[provider];
    const savedModel = this.plugin.settings.defaultModelByProvider[provider];
    const validModel =
      info?.models.find((m) => m.id === savedModel) ?? info?.models[0];
    if (validModel) {
      session.model = validModel.id;
      const savedEffort = this.plugin.settings.defaultEffortByProvider[provider];
      session.effort =
        savedEffort && validModel.efforts.includes(savedEffort)
          ? savedEffort
          : validModel.defaultEffort;
    }

    await this.plugin.savePluginData();
    this.renderControls();
  }

  private stopCurrentTurn(): void {
    if (this.activeTurn) {
      this.activeTurn.cancel();
      this.activeTurn = null;
      this.renderControls();
    }
  }

  private async buildActiveFileContext(file: TFile | null): Promise<ActiveFileContext | null> {
    if (!file || !this.isActiveFileIncluded()) return null;

    const cache = this.app.metadataCache.getFileCache(file);
    const tags: string[] = [];
    const fmTags = cache?.frontmatter?.tags;
    if (Array.isArray(fmTags)) {
      for (const t of fmTags) tags.push(String(t));
    } else if (typeof fmTags === "string") {
      tags.push(fmTags);
    }
    for (const inlineTag of cache?.tags ?? []) {
      const cleaned = inlineTag.tag.replace(/^#/, "");
      if (!tags.includes(cleaned)) tags.push(cleaned);
    }

    const cursorLine = this.plugin.getActiveCursorLine(file.path);
    const activeHeading =
      cursorLine !== undefined
        ? this.plugin.resolveHeadingForLine(file, cursorLine)
        : undefined;

    let content: string | undefined;
    let truncated = false;
    let totalChars: number | undefined;
    if (this.plugin.settings.includeActiveFileContent) {
      const raw = await this.app.vault.cachedRead(file);
      totalChars = raw.length;
      const maxChars = this.plugin.settings.maxActiveFileChars;
      if (raw.length > maxChars) {
        content = `${raw.slice(0, maxChars)}\n\n... [truncated after ${maxChars} of ${raw.length} chars; read full file at ${file.path} if needed]`;
        truncated = true;
      } else {
        content = raw;
      }
    }

    return {
      filePath: file.path,
      fileName: file.name,
      title: file.basename,
      tags,
      cursorLine,
      activeHeading,
      content,
      truncated,
      totalChars,
    };
  }

  private async handleSend(): Promise<void> {
    if (this.activeTurn) return;
    const rawText = this.inputEl.value.trim();
    const snippets = this.plugin.getDraftSnippets();

    if (!rawText && snippets.length === 0) return;

    const userText =
      rawText ||
      "Analyze the attached excerpt(s) and explain how they connect to other notes in my vault.";

    const session: ChatSession = this.plugin.getActiveSession();
    const providerInfo = this.plugin.providers[session.provider];
    if (!providerInfo?.installed || !providerInfo.binaryPath) {
      new Notice(
        `${PROVIDER_META[session.provider].displayName} CLI (${PROVIDER_META[session.provider].binaryName}) was not found. Check Vault Agent settings.`,
      );
      return;
    }

    const vaultRoot = this.plugin.getVaultRootPath();
    if (!vaultRoot) {
      new Notice("Vault Agent requires a local desktop filesystem vault.");
      return;
    }

    const activeFile = this.plugin.getActiveFile();
    const activeFileCtx = await this.buildActiveFileContext(activeFile);

    // Clear composer & consume draft snippets
    this.inputEl.value = "";
    this.autoResizeInput();
    const attachedSnippets = [...snippets];
    this.plugin.clearDraftSnippets();

    const priorMessages = [...session.messages];
    const resumeSessionId = session.providerSessionIds[session.provider];

    // Update session title on first user prompt
    if (session.messages.length === 0) {
      session.title =
        userText.length > 46 ? `${userText.slice(0, 46).trim()}…` : userText;
    }

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: userText,
      timestamp: Date.now(),
      activeFilePath: activeFileCtx?.filePath ?? null,
      snippets: attachedSnippets.length > 0 ? attachedSnippets : undefined,
    };

    const assistantMsg: ChatMessage = {
      id: `a-${Date.now() + 1}`,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      provider: session.provider,
      model: session.model,
      effort: session.effort,
      mode: session.mode,
      activeFilePath: activeFileCtx?.filePath ?? null,
      activities: [],
      thinking: "",
    };

    session.messages.push(userMsg, assistantMsg);
    session.updatedAt = Date.now();
    this.streamingMsg = assistantMsg;
    this.userScrolledUp = false;

    const vaultKnowledge = this.plugin.refreshVaultKnowledge();

    const builtPrompt = buildUserTurnPrompt({
      userMessage: userText,
      vaultName: this.app.vault.getName(),
      vaultRootPath: vaultRoot,
      mode: session.mode,
      activeFile: activeFileCtx,
      snippets: attachedSnippets,
      settings: this.plugin.settings,
      obsidianCliAvailable: this.plugin.obsidianCliPath !== null,
      vaultKnowledge,
      // Only inject compact prior history when starting a fresh CLI session on a non-empty chat
      priorHistory: !resumeSessionId && priorMessages.length > 0 ? priorMessages : undefined,
      hasNativeSystemPrompt: providerSupportsNativeSystemPrompt(session.provider),
      isResumingSession: Boolean(resumeSessionId),
    });

    const startedAt = Date.now();
    const modelInfo = this.getModelInfo(session.provider, session.model);

    this.activeTurn = runProviderTurn(
      {
        provider: session.provider,
        binaryPath: providerInfo.binaryPath,
        cwd: vaultRoot,
        model: session.model,
        modelInfo,
        effort: session.effort,
        mode: session.mode,
        prompt: builtPrompt.prompt,
        systemInstructions: builtPrompt.systemInstructions,
        resumeSessionId,
      },
      (event) => {
        switch (event.type) {
          case "session":
            session.providerSessionIds[session.provider] = event.sessionId;
            break;

          case "text_delta":
            assistantMsg.content += event.text;
            this.scheduleStreamRender();
            break;

          case "text_replace":
            assistantMsg.content = event.text;
            this.scheduleStreamRender();
            break;

          case "thinking_delta":
            assistantMsg.thinking = (assistantMsg.thinking ?? "") + event.text;
            this.scheduleStreamRender();
            break;

          case "tool_start": {
            const list = assistantMsg.activities ?? (assistantMsg.activities = []);
            const existing = list.find((a) => a.id === event.id);
            if (existing) {
              existing.name = event.name;
              if (event.detail) existing.detail = event.detail;
              existing.status = "running";
            } else {
              list.push({
                id: event.id,
                name: event.name,
                detail: event.detail,
                status: "running",
              });
            }
            this.scheduleStreamRender();
            break;
          }

          case "tool_end": {
            const list = assistantMsg.activities ?? (assistantMsg.activities = []);
            const existing = list.find((a) => a.id === event.id);
            if (existing) {
              existing.status = event.isError ? "error" : "done";
              if (event.detail) existing.detail = event.detail;
            } else if (event.name) {
              list.push({
                id: event.id,
                name: event.name,
                detail: event.detail,
                status: event.isError ? "error" : "done",
              });
            }
            this.scheduleStreamRender();
            break;
          }

          case "error":
            assistantMsg.isError = true;
            assistantMsg.content = assistantMsg.content
              ? `${assistantMsg.content}\n\n**Error:** ${event.message}`
              : event.message;
            this.scheduleStreamRender();
            break;

          case "done":
            if (event.sessionId) {
              session.providerSessionIds[session.provider] = event.sessionId;
            }
            if (!assistantMsg.content && event.finalText) {
              assistantMsg.content = event.finalText;
            }
            break;
        }
      },
    );

    this.renderSessionHeader();
    this.renderMessages();
    this.renderControls();

    await this.activeTurn.promise;

    if (this.streamRenderTimer) {
      clearTimeout(this.streamRenderTimer);
      this.streamRenderTimer = null;
    }

    assistantMsg.durationMs = Date.now() - startedAt;
    for (const act of assistantMsg.activities ?? []) {
      if (act.status === "running") act.status = "done";
    }
    this.activeTurn = null;
    this.streamingMsg = null;
    session.updatedAt = Date.now();

    await this.plugin.savePluginData();
    this.renderMessages();
    this.renderControls();
    this.focusInput();
  }
}
