import {
  Editor,
  FileSystemAdapter,
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import { EditorView } from "@codemirror/view";
import { AttachPatternModal } from "./context/patternModal";
import {
  markedRangesField,
  setMarkedRangesEffect,
  type MarkedRange,
} from "./context/selectionMarks";
import { loadVaultKnowledge, type VaultKnowledge } from "./context/vaultKnowledge";
import { resolveBinary } from "./env";
import { discoverAllProviders, PROVIDER_ORDER } from "./providers/catalog";
import {
  DEFAULT_SETTINGS,
  type ChatSession,
  type PersistedPluginData,
  type ProviderId,
  type ProviderInfo,
  type TextSnippetAttachment,
  type VaultAgentSettings,
} from "./types";
import {
  VIEW_TYPE_VAULT_AGENT,
  VaultAgentChatView,
  type LiveSelectionPreview,
} from "./ui/ChatView";
import { VaultAgentSettingTab } from "./ui/SettingsTab";

const MAX_PERSISTED_SESSIONS = 40;

export default class VaultAgentPlugin extends Plugin {
  settings: VaultAgentSettings = { ...DEFAULT_SETTINGS };
  sessions: ChatSession[] = [];
  activeSessionId: string | null = null;
  providers: Partial<Record<ProviderId, ProviderInfo>> = {};
  providersLoaded = false;
  obsidianCliPath: string | null = null;
  vaultKnowledge: VaultKnowledge = {
    agentsDocPath: null,
    agentsDocContent: null,
    vaultGuideFiles: [],
    obsidianSkillPath: null,
    obsidianSkillContent: null,
  };

  private lastActiveFile: TFile | null = null;
  private draftSnippets: TextSnippetAttachment[] = [];
  private liveSelection: LiveSelectionPreview | null = null;
  private selectionDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  async onload(): Promise<void> {
    await this.loadPluginData();

    // Register CM6 extension for visual highlights + live selection tracking
    this.registerEditorExtension([
      markedRangesField,
      EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) {
          this.scheduleSelectionCheck();
        }
      }),
    ]);

    this.registerView(
      VIEW_TYPE_VAULT_AGENT,
      (leaf) => new VaultAgentChatView(leaf, this),
    );

    this.addSettingTab(new VaultAgentSettingTab(this.app, this));

    this.addRibbonIcon("sparkles", "Open Vault Agent", () => {
      void this.activateView(true);
    });

    // Commands
    this.addCommand({
      id: "open-chat",
      name: "Open Vault Agent sidebar",
      callback: () => {
        void this.activateView(true);
      },
    });

    this.addCommand({
      id: "new-chat",
      name: "Start new Vault Agent chat",
      callback: async () => {
        await this.activateView(true);
        await this.createNewSession();
      },
    });

    this.addCommand({
      id: "attach-selection",
      name: "Attach selected text to Vault Agent",
      editorCallback: (editor, view) => {
        const file = view.file;
        if (!file) {
          new Notice("No active note to attach selection from.");
          return;
        }
        this.attachSelectionFromEditor(editor, file, false);
      },
    });

    this.addCommand({
      id: "ask-about-selection",
      name: "Ask Vault Agent about selected text",
      editorCallback: (editor, view) => {
        const file = view.file;
        if (!file) {
          new Notice("No active note to attach selection from.");
          return;
        }
        this.attachSelectionFromEditor(editor, file, true);
      },
    });

    this.addCommand({
      id: "attach-pattern-matches",
      name: "Mark & attach text pattern matches from active note",
      callback: () => {
        void this.openAttachPatternModal();
      },
    });

    // Editor right-click context menu
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, info) => {
        const selection = editor.getSelection();
        const file = info.file;
        if (!file) return;

        if (selection && selection.trim().length > 0) {
          menu.addSeparator();
          menu.addItem((item) => {
            item
              .setTitle("Ask Vault Agent about selection")
              .setIcon("sparkles")
              .onClick(() => {
                this.attachSelectionFromEditor(editor, file, true);
              });
          });
          menu.addItem((item) => {
            item
              .setTitle("Attach selection to Vault Agent")
              .setIcon("highlighter")
              .onClick(() => {
                this.attachSelectionFromEditor(editor, file, false);
              });
          });
        } else {
          menu.addItem((item) => {
            item
              .setTitle("Mark text pattern for Vault Agent…")
              .setIcon("search-code")
              .onClick(() => {
                void this.openAttachPatternModal();
              });
          });
        }
      }),
    );

    // Track focused Markdown note even when focus moves to the chat sidebar
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file && file.extension === "md") {
          this.lastActiveFile = file;
          this.updateLiveSelection();
          this.syncEditorHighlights();
          this.notifyContextUpdated();
        }
      }),
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        const view = leaf?.view;
        if (view instanceof MarkdownView && view.file) {
          this.lastActiveFile = view.file;
          this.updateLiveSelection();
          this.syncEditorHighlights();
          this.notifyContextUpdated();
        }
      }),
    );

    void this.refreshProviders();

    this.app.workspace.onLayoutReady(() => {
      const current = this.app.workspace.getActiveFile();
      if (current && current.extension === "md") {
        this.lastActiveFile = current;
      }
      this.updateLiveSelection();
      this.notifyContextUpdated();
    });
  }

  onunload(): void {
    if (this.selectionDebounceTimer) {
      clearTimeout(this.selectionDebounceTimer);
      this.selectionDebounceTimer = null;
    }
    // Clear editor marks
    this.draftSnippets = [];
    this.syncEditorHighlights();
  }

  async refreshProviders(): Promise<void> {
    this.obsidianCliPath = resolveBinary("obsidian", this.settings.binaryOverrides.obsidian);
    this.refreshVaultKnowledge();
    this.providers = await discoverAllProviders(this.settings);
    this.providersLoaded = true;

    // If current default provider is not installed, pick the first installed one
    const currentDefault = this.providers[this.settings.defaultProvider];
    if (!currentDefault?.installed) {
      const firstInstalled = PROVIDER_ORDER.find((id) => this.providers[id]?.installed);
      if (firstInstalled) {
        this.settings.defaultProvider = firstInstalled;
      }
    }

    this.notifyViewsUpdated();
  }

  getVaultRootPath(): string | null {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      return adapter.getBasePath();
    }
    return null;
  }

  refreshVaultKnowledge(): VaultKnowledge {
    this.vaultKnowledge = loadVaultKnowledge(this.getVaultRootPath(), {
      injectVaultAgentsMd: this.settings.injectVaultAgentsMd,
      injectObsidianSkill: this.settings.injectObsidianSkill,
      obsidianSkillPathOverride: this.settings.obsidianSkillPathOverride,
    });
    return this.vaultKnowledge;
  }

  getActiveFile(): TFile | null {
    const live = this.app.workspace.getActiveFile();
    if (live && live.extension === "md") {
      this.lastActiveFile = live;
      return live;
    }
    if (this.lastActiveFile) {
      const exists = this.app.vault.getAbstractFileByPath(this.lastActiveFile.path);
      if (exists instanceof TFile) return exists;
    }
    return null;
  }

  private getMarkdownViewForFile(filePath: string): MarkdownView | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active?.file?.path === filePath) return active;

    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView && leaf.view.file?.path === filePath) {
        return leaf.view;
      }
    }
    return null;
  }

  getActiveCursorLine(filePath: string): number | undefined {
    const mdView = this.getMarkdownViewForFile(filePath);
    if (!mdView?.editor) return undefined;
    return mdView.editor.getCursor().line + 1;
  }

  resolveHeadingForLine(file: TFile, line1Based: number): string | undefined {
    const cache = this.app.metadataCache.getFileCache(file);
    const headings = cache?.headings;
    if (!headings || headings.length === 0) return undefined;
    let nearest: string | undefined;
    for (const h of headings) {
      const hLine = h.position.start.line + 1;
      if (hLine <= line1Based) {
        nearest = h.heading;
      } else {
        break;
      }
    }
    return nearest;
  }

  getLiveSelectionPreview(): LiveSelectionPreview | null {
    return this.liveSelection;
  }

  private scheduleSelectionCheck(): void {
    if (this.selectionDebounceTimer) {
      clearTimeout(this.selectionDebounceTimer);
    }
    this.selectionDebounceTimer = setTimeout(() => {
      this.selectionDebounceTimer = null;
      this.updateLiveSelection();
      this.notifyContextUpdated();
    }, 120);
  }

  private updateLiveSelection(): void {
    const file = this.getActiveFile();
    if (!file) {
      this.liveSelection = null;
      return;
    }
    const mdView = this.getMarkdownViewForFile(file.path);
    const editor = mdView?.editor;
    if (!editor) {
      this.liveSelection = null;
      return;
    }
    const text = editor.getSelection();
    if (!text || !text.trim()) {
      this.liveSelection = null;
      return;
    }
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    const startLine = Math.min(from.line, to.line) + 1;
    const endLine = Math.max(from.line, to.line) + 1;
    this.liveSelection = {
      filePath: file.path,
      fileName: file.name,
      startLine,
      endLine,
      lineCount: endLine - startLine + 1,
      charCount: text.length,
    };
  }

  getDraftSnippets(): TextSnippetAttachment[] {
    return this.draftSnippets;
  }

  attachCurrentSelection(focusChat: boolean): void {
    const file = this.getActiveFile();
    if (!file) {
      new Notice("No active note found.");
      return;
    }
    const mdView = this.getMarkdownViewForFile(file.path);
    if (!mdView?.editor) {
      new Notice("Open the note in Edit / Live Preview mode to attach a selection.");
      return;
    }
    this.attachSelectionFromEditor(mdView.editor, file, focusChat);
  }

  attachSelectionFromEditor(editor: Editor, file: TFile, focusChat: boolean): void {
    const text = editor.getSelection();
    if (!text || !text.trim()) {
      new Notice("Select some text in your note first.");
      return;
    }

    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    const startLine = Math.min(from.line, to.line) + 1;
    const endLine = Math.max(from.line, to.line) + 1;
    const fromOffset = editor.posToOffset(from);
    const toOffset = editor.posToOffset(to);
    const heading = this.resolveHeadingForLine(file, startLine);

    const snippet: TextSnippetAttachment = {
      id: `sel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      filePath: file.path,
      fileName: file.name,
      startLine,
      endLine,
      fromOffset: Math.min(fromOffset, toOffset),
      toOffset: Math.max(fromOffset, toOffset),
      heading,
      text,
      createdAt: Date.now(),
    };

    // Avoid exact duplicate snippet
    const duplicate = this.draftSnippets.some(
      (s) =>
        s.filePath === snippet.filePath &&
        s.startLine === snippet.startLine &&
        s.endLine === snippet.endLine &&
        s.text === snippet.text,
    );
    if (!duplicate) {
      this.draftSnippets.push(snippet);
      this.syncEditorHighlights();
    }

    this.notifyContextUpdated();
    void this.activateView(focusChat);
    if (!focusChat) {
      new Notice(`Attached ${file.basename}:L${startLine}-${endLine} to Vault Agent.`);
    }
  }

  async openAttachPatternModal(): Promise<void> {
    const file = this.getActiveFile();
    if (!file) {
      new Notice("Focus a Markdown note first to match patterns in it.");
      return;
    }
    const content = await this.app.vault.cachedRead(file);
    new AttachPatternModal(
      this.app,
      file.path,
      file.name,
      content,
      (line) => this.resolveHeadingForLine(file, line),
      (snippets) => {
        this.draftSnippets.push(...snippets);
        this.syncEditorHighlights();
        this.notifyContextUpdated();
        void this.activateView(true);
        new Notice(
          `Attached ${snippets.length} matching ${snippets.length === 1 ? "passage" : "passages"} from ${file.basename}.`,
        );
      },
    ).open();
  }

  removeDraftSnippet(id: string): void {
    this.draftSnippets = this.draftSnippets.filter((s) => s.id !== id);
    this.syncEditorHighlights();
    this.notifyContextUpdated();
  }

  clearDraftSnippets(): void {
    this.draftSnippets = [];
    this.syncEditorHighlights();
    this.notifyContextUpdated();
  }

  syncEditorHighlights(): void {
    const enabled = this.settings.highlightMarkedSnippets;
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (!(leaf.view instanceof MarkdownView)) continue;
      const file = leaf.view.file;
      if (!file) continue;
      const cm = (leaf.view.editor as unknown as { cm?: EditorView })?.cm;
      if (!cm || typeof cm.dispatch !== "function") continue;

      const ranges: MarkedRange[] = [];
      if (enabled) {
        for (const s of this.draftSnippets) {
          if (
            s.filePath === file.path &&
            s.fromOffset !== undefined &&
            s.toOffset !== undefined &&
            s.toOffset > s.fromOffset
          ) {
            ranges.push({ from: s.fromOffset, to: s.toOffset });
          }
        }
      }
      try {
        cm.dispatch({ effects: setMarkedRangesEffect.of(ranges) });
      } catch {
        // Editor view might not have the state field in rare non-standard editors
      }
    }
  }

  async jumpToSnippet(snippet: TextSnippetAttachment): Promise<void> {
    await this.app.workspace.openLinkText(snippet.filePath, "", false);
    const mdView = this.getMarkdownViewForFile(snippet.filePath);
    if (!mdView?.editor) return;
    const startLine = Math.max(0, snippet.startLine - 1);
    const endLine = Math.max(startLine, snippet.endLine - 1);
    const endCh = mdView.editor.getLine(endLine)?.length ?? 0;
    mdView.editor.setSelection(
      { line: startLine, ch: 0 },
      { line: endLine, ch: endCh },
    );
    mdView.editor.scrollIntoView(
      { from: { line: startLine, ch: 0 }, to: { line: endLine, ch: endCh } },
      true,
    );
  }

  insertTextIntoActiveNote(text: string): void {
    const file = this.getActiveFile();
    if (!file) {
      new Notice("No focused note to insert into.");
      return;
    }
    const mdView = this.getMarkdownViewForFile(file.path);
    if (!mdView?.editor) {
      new Notice("Open the target note in Edit mode to insert text.");
      return;
    }
    mdView.editor.replaceSelection(text);
    new Notice(`Inserted response into ${file.basename}.`);
  }

  // Session management
  getActiveSession(): ChatSession {
    let found = this.sessions.find((s) => s.id === this.activeSessionId);
    if (!found) {
      if (this.sessions.length === 0) {
        found = this.makeNewSessionObject();
        this.sessions.unshift(found);
      } else {
        found = this.sessions[0];
      }
      this.activeSessionId = found.id;
    }
    return found;
  }

  private makeNewSessionObject(): ChatSession {
    const provider = this.settings.defaultProvider;
    const providerInfo = this.providers[provider];
    const savedModel = this.settings.defaultModelByProvider[provider];
    const modelInfo =
      providerInfo?.models.find((m) => m.id === savedModel) ??
      providerInfo?.models[0];
    const model = modelInfo?.id ?? savedModel ?? "";
    const savedEffort = this.settings.defaultEffortByProvider[provider];
    const effort =
      savedEffort && (!modelInfo || modelInfo.efforts.includes(savedEffort))
        ? savedEffort
        : modelInfo?.defaultEffort ?? "medium";

    return {
      id: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: "New chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      provider,
      model,
      effort,
      mode: this.settings.defaultMode,
      providerSessionIds: {},
      messages: [],
    };
  }

  async createNewSession(): Promise<ChatSession> {
    const session = this.makeNewSessionObject();
    this.sessions.unshift(session);
    if (this.sessions.length > MAX_PERSISTED_SESSIONS) {
      this.sessions = this.sessions.slice(0, MAX_PERSISTED_SESSIONS);
    }
    this.activeSessionId = session.id;
    await this.savePluginData();
    this.notifyViewsUpdated();
    return session;
  }

  async setActiveSession(sessionId: string): Promise<void> {
    if (this.sessions.some((s) => s.id === sessionId)) {
      this.activeSessionId = sessionId;
      await this.savePluginData();
      this.notifyViewsUpdated();
    }
  }

  async deleteActiveSession(): Promise<void> {
    const active = this.getActiveSession();
    this.sessions = this.sessions.filter((s) => s.id !== active.id);
    if (this.sessions.length === 0) {
      const fresh = this.makeNewSessionObject();
      this.sessions.push(fresh);
      this.activeSessionId = fresh.id;
    } else {
      this.activeSessionId = this.sessions[0].id;
    }
    await this.savePluginData();
    this.notifyViewsUpdated();
  }

  async activateView(focusInput: boolean): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null =
      workspace.getLeavesOfType(VIEW_TYPE_VAULT_AGENT)[0] ?? null;

    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE_VAULT_AGENT, active: true });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
      if (focusInput && leaf.view instanceof VaultAgentChatView) {
        setTimeout(() => {
          if (leaf?.view instanceof VaultAgentChatView) {
            leaf.view.focusInput();
          }
        }, 30);
      }
    }
  }

  notifyViewsUpdated(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_VAULT_AGENT)) {
      if (leaf.view instanceof VaultAgentChatView) {
        leaf.view.refreshAll();
      }
    }
  }

  notifyContextUpdated(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_VAULT_AGENT)) {
      if (leaf.view instanceof VaultAgentChatView) {
        leaf.view.refreshContextOnly();
      }
    }
  }

  private async loadPluginData(): Promise<void> {
    const raw = (await this.loadData()) as Partial<PersistedPluginData> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(raw?.settings ?? {}),
      defaultModelByProvider: {
        ...DEFAULT_SETTINGS.defaultModelByProvider,
        ...(raw?.settings?.defaultModelByProvider ?? {}),
      },
      defaultEffortByProvider: {
        ...DEFAULT_SETTINGS.defaultEffortByProvider,
        ...(raw?.settings?.defaultEffortByProvider ?? {}),
      },
      binaryOverrides: {
        ...(raw?.settings?.binaryOverrides ?? {}),
      },
      customModelsByProvider: {
        ...(raw?.settings?.customModelsByProvider ?? {}),
      },
    };
    this.sessions = Array.isArray(raw?.sessions) ? raw.sessions : [];
    this.activeSessionId = raw?.activeSessionId ?? this.sessions[0]?.id ?? null;
  }

  async savePluginData(): Promise<void> {
    const payload: PersistedPluginData = {
      settings: this.settings,
      sessions: this.sessions.slice(0, MAX_PERSISTED_SESSIONS),
      activeSessionId: this.activeSessionId,
    };
    await this.saveData(payload);
  }
}
