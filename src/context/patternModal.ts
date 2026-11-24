import { App, Modal, Notice, Setting } from "obsidian";
import type { TextSnippetAttachment } from "../types";
import { extractPatternMatches, type PatternMatchResult } from "./patternMatcher";

export class AttachPatternModal extends Modal {
  private pattern = "";
  private isRegex = false;
  private caseSensitive = false;
  private contextLines = 1;
  private previewEl: HTMLElement | null = null;
  private submitBtn: HTMLButtonElement | null = null;

  constructor(
    app: App,
    private readonly filePath: string,
    private readonly fileName: string,
    private readonly content: string,
    private readonly resolveHeading: (line: number) => string | undefined,
    private readonly onAttach: (snippets: TextSnippetAttachment[]) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("vault-agent-pattern-modal");

    contentEl.createEl("h3", { text: `Mark pattern in ${this.fileName}` });
    contentEl.createEl("p", {
      text: "Find matching lines in the active note and attach each passage (with path and line numbers) to Vault Agent.",
      cls: "vault-agent-modal-desc",
    });

    new Setting(contentEl)
      .setName("Text or pattern")
      .addText((text) => {
        text.setPlaceholder("e.g. evergreen, [[Topic]], or ^## .*");
        text.onChange((val) => {
          this.pattern = val;
          this.updatePreview();
        });
        text.inputEl.focus();
        text.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            this.handleSubmit();
          }
        });
      });

    new Setting(contentEl)
      .setName("Use regular expression")
      .addToggle((toggle) => {
        toggle.setValue(this.isRegex).onChange((val) => {
          this.isRegex = val;
          this.updatePreview();
        });
      });

    new Setting(contentEl)
      .setName("Case sensitive")
      .addToggle((toggle) => {
        toggle.setValue(this.caseSensitive).onChange((val) => {
          this.caseSensitive = val;
          this.updatePreview();
        });
      });

    new Setting(contentEl)
      .setName("Surrounding context lines")
      .addSlider((slider) => {
        slider
          .setLimits(0, 5, 1)
          .setValue(this.contextLines)
          .setDynamicTooltip()
          .onChange((val) => {
            this.contextLines = val;
            this.updatePreview();
          });
      });

    this.previewEl = contentEl.createDiv({ cls: "vault-agent-pattern-preview" });

    const actions = contentEl.createDiv({ cls: "vault-agent-modal-actions" });
    const cancelBtn = actions.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());

    this.submitBtn = actions.createEl("button", {
      text: "Attach matches",
      cls: "mod-cta",
    });
    this.submitBtn.addEventListener("click", () => this.handleSubmit());

    this.updatePreview();
  }

  private getMatches(): { matches: PatternMatchResult[]; error?: string } {
    if (!this.pattern.trim()) return { matches: [] };
    try {
      const matches = extractPatternMatches(this.content, this.pattern, {
        isRegex: this.isRegex,
        caseSensitive: this.caseSensitive,
        contextLines: this.contextLines,
      });
      return { matches };
    } catch (err) {
      return {
        matches: [],
        error: err instanceof Error ? err.message : "Invalid pattern",
      };
    }
  }

  private updatePreview(): void {
    if (!this.previewEl || !this.submitBtn) return;
    this.previewEl.empty();

    if (!this.pattern.trim()) {
      this.previewEl.setText("Enter text or a regex pattern to preview matches.");
      this.submitBtn.disabled = true;
      this.submitBtn.setText("Attach matches");
      return;
    }

    const { matches, error } = this.getMatches();
    if (error) {
      this.previewEl.createDiv({
        text: `Pattern error: ${error}`,
        cls: "vault-agent-error-text",
      });
      this.submitBtn.disabled = true;
      this.submitBtn.setText("Attach matches");
      return;
    }

    if (matches.length === 0) {
      this.previewEl.setText("No matches found in this note.");
      this.submitBtn.disabled = true;
      this.submitBtn.setText("Attach matches");
      return;
    }

    this.submitBtn.disabled = false;
    this.submitBtn.setText(
      `Attach ${matches.length} ${matches.length === 1 ? "passage" : "passages"}`,
    );

    const shown = matches.slice(0, 6);
    for (const m of shown) {
      const item = this.previewEl.createDiv({ cls: "vault-agent-pattern-item" });
      item.createDiv({
        text: `L${m.startLine}-L${m.endLine}`,
        cls: "vault-agent-pattern-lines",
      });
      item.createEl("pre", {
        text: m.text.length > 240 ? `${m.text.slice(0, 240)}…` : m.text,
        cls: "vault-agent-pattern-code",
      });
    }
    if (matches.length > shown.length) {
      this.previewEl.createDiv({
        text: `+ ${matches.length - shown.length} more passages`,
        cls: "vault-agent-muted",
      });
    }
  }

  private handleSubmit(): void {
    const { matches, error } = this.getMatches();
    if (error || matches.length === 0) {
      new Notice(error ? `Invalid pattern: ${error}` : "No matches to attach.");
      return;
    }

    const now = Date.now();
    const snippets: TextSnippetAttachment[] = matches.map((m, idx) => ({
      id: `pat-${now}-${idx}`,
      filePath: this.filePath,
      fileName: this.fileName,
      startLine: m.startLine,
      endLine: m.endLine,
      fromOffset: m.fromOffset,
      toOffset: m.toOffset,
      heading: this.resolveHeading(m.startLine),
      pattern: this.pattern,
      text: m.text,
      createdAt: now,
    }));

    this.onAttach(snippets);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
