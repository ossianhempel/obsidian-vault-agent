import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { PROVIDER_META, PROVIDER_ORDER } from "../providers/catalog";
import type { AgentMode, ProviderId } from "../types";
import type VaultAgentPlugin from "../main";

export class VaultAgentSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: VaultAgentPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("vault-agent-settings");

    containerEl.createEl("h2", { text: "Vault Agent" });

    // CLI Health Status Card
    const statusSection = containerEl.createDiv({ cls: "vault-agent-status-card" });
    const headerRow = statusSection.createDiv({ cls: "vault-agent-status-header" });
    headerRow.createEl("strong", { text: "Detected local CLIs (subscriptions & Obsidian)" });
    const refreshBtn = headerRow.createEl("button", { text: "Re-scan CLIs & models" });
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.disabled = true;
      refreshBtn.setText("Scanning…");
      await this.plugin.refreshProviders();
      new Notice("Vault Agent refreshed CLI providers and model catalogs.");
      this.display();
    });

    const listEl = statusSection.createDiv({ cls: "vault-agent-cli-grid" });
    for (const pid of PROVIDER_ORDER) {
      const info = this.plugin.providers[pid];
      const row = listEl.createDiv({ cls: "vault-agent-cli-row" });
      row.createSpan({
        cls: `vault-agent-dot ${info?.installed ? "is-ok" : "is-missing"}`,
      });
      row.createSpan({
        text: info?.displayName ?? PROVIDER_META[pid].displayName,
        cls: "vault-agent-cli-name",
      });
      row.createSpan({
        text: info?.installed
          ? `${info.binaryPath} (${info.models.length} models)`
          : `${PROVIDER_META[pid].binaryName} not found in PATH`,
        cls: "vault-agent-cli-path",
      });
    }

    const obsRow = listEl.createDiv({ cls: "vault-agent-cli-row" });
    obsRow.createSpan({
      cls: `vault-agent-dot ${this.plugin.obsidianCliPath ? "is-ok" : "is-missing"}`,
    });
    obsRow.createSpan({ text: "Obsidian CLI", cls: "vault-agent-cli-name" });
    obsRow.createSpan({
      text: this.plugin.obsidianCliPath ?? "obsidian not found in PATH",
      cls: "vault-agent-cli-path",
    });

    const vk = this.plugin.vaultKnowledge;
    const agentsRow = listEl.createDiv({ cls: "vault-agent-cli-row" });
    agentsRow.createSpan({
      cls: `vault-agent-dot ${vk.agentsDocPath ? "is-ok" : "is-missing"}`,
    });
    agentsRow.createSpan({ text: "Vault AGENTS.md", cls: "vault-agent-cli-name" });
    agentsRow.createSpan({
      text: vk.agentsDocPath
        ? `${vk.agentsDocPath}${vk.vaultGuideFiles.length > 0 ? ` (+ ${vk.vaultGuideFiles.join(", ")})` : ""}`
        : "No AGENTS.md / CLAUDE.md in vault root",
      cls: "vault-agent-cli-path",
    });

    const skillRow = listEl.createDiv({ cls: "vault-agent-cli-row" });
    skillRow.createSpan({
      cls: `vault-agent-dot ${vk.obsidianSkillPath ? "is-ok" : "is-missing"}`,
    });
    skillRow.createSpan({ text: "Obsidian skill", cls: "vault-agent-cli-name" });
    skillRow.createSpan({
      text: vk.obsidianSkillPath ?? "No obsidian SKILL.md auto-detected",
      cls: "vault-agent-cli-path",
    });

    containerEl.createEl("h3", { text: "Defaults" });

    new Setting(containerEl)
      .setName("Default AI provider")
      .setDesc("Provider selected for new chat sessions.")
      .addDropdown((dd) => {
        for (const pid of PROVIDER_ORDER) {
          const info = this.plugin.providers[pid];
          const suffix = info?.installed ? "" : " (not detected)";
          dd.addOption(pid, `${PROVIDER_META[pid].displayName}${suffix}`);
        }
        dd.setValue(this.plugin.settings.defaultProvider);
        dd.onChange(async (val) => {
          this.plugin.settings.defaultProvider = val as ProviderId;
          await this.plugin.savePluginData();
        });
      });

    new Setting(containerEl)
      .setName("Default mode")
      .setDesc("Ask (read-only) prevents edits; Agent allows creating and modifying vault notes.")
      .addDropdown((dd) => {
        dd.addOption("ask", "Ask (Read-only)");
        dd.addOption("agent", "Agent (Can edit notes)");
        dd.setValue(this.plugin.settings.defaultMode);
        dd.onChange(async (val) => {
          this.plugin.settings.defaultMode = val as AgentMode;
          await this.plugin.savePluginData();
        });
      });

    containerEl.createEl("h3", { text: "Automatic note & selection context" });

    new Setting(containerEl)
      .setName("Auto-attach active focused note")
      .setDesc("Automatically include the currently focused Markdown note whenever you send a message.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.autoAttachActiveFile)
          .onChange(async (val) => {
            this.plugin.settings.autoAttachActiveFile = val;
            await this.plugin.savePluginData();
            this.plugin.notifyViewsUpdated();
          });
      });

    new Setting(containerEl)
      .setName("Include active note body inline")
      .setDesc("Send the focused note's text alongside its path, tags, and heading so the agent sees it immediately.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.includeActiveFileContent)
          .onChange(async (val) => {
            this.plugin.settings.includeActiveFileContent = val;
            await this.plugin.savePluginData();
          });
      });

    new Setting(containerEl)
      .setName("Max inline active note length (chars)")
      .setDesc("Notes longer than this are truncated inline (the agent can still read the full file from disk).")
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.maxActiveFileChars))
          .onChange(async (val) => {
            const parsed = Number.parseInt(val, 10);
            if (!Number.isNaN(parsed) && parsed >= 1000) {
              this.plugin.settings.maxActiveFileChars = parsed;
              await this.plugin.savePluginData();
            }
          });
      });

    new Setting(containerEl)
      .setName("Highlight marked text snippets in editor")
      .setDesc("Visually highlight passages in your note while they are attached to the chat composer.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.highlightMarkedSnippets)
          .onChange(async (val) => {
            this.plugin.settings.highlightMarkedSnippets = val;
            await this.plugin.savePluginData();
            this.plugin.syncEditorHighlights();
          });
      });

    new Setting(containerEl)
      .setName("Include Obsidian CLI vault-traversal guidance")
      .setDesc("Tell the agent how to use `obsidian search`, `obsidian backlinks`, `obsidian read`, `obsidian base:query`, etc. inside your vault.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.enableObsidianCliGuidance)
          .onChange(async (val) => {
            this.plugin.settings.enableObsidianCliGuidance = val;
            await this.plugin.savePluginData();
          });
      });

    new Setting(containerEl)
      .setName("Inject vault AGENTS.md / CLAUDE.md")
      .setDesc("Automatically inject your vault's own AGENTS.md rules into every provider (including Codex, Antigravity, Copilot, and OpenCode).")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.injectVaultAgentsMd)
          .onChange(async (val) => {
            this.plugin.settings.injectVaultAgentsMd = val;
            this.plugin.refreshVaultKnowledge();
            await this.plugin.savePluginData();
          });
      });

    new Setting(containerEl)
      .setName("Inject Obsidian skill (SKILL.md)")
      .setDesc("Auto-detect and inject your installed Obsidian SKILL.md into every provider session (with vault AGENTS.md and live Obsidian CLI taking precedence).")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.injectObsidianSkill)
          .onChange(async (val) => {
            this.plugin.settings.injectObsidianSkill = val;
            this.plugin.refreshVaultKnowledge();
            await this.plugin.savePluginData();
          });
      });

    new Setting(containerEl)
      .setName("Obsidian skill path override (optional)")
      .setDesc("Custom path to a SKILL.md file if not auto-detected.")
      .addText((text) => {
        text
          .setPlaceholder("~/.claude/plugins/marketplaces/ossian-stack/skills/obsidian/SKILL.md")
          .setValue(this.plugin.settings.obsidianSkillPathOverride)
          .onChange(async (val) => {
            this.plugin.settings.obsidianSkillPathOverride = val.trim();
            this.plugin.refreshVaultKnowledge();
            await this.plugin.savePluginData();
          });
      });

    new Setting(containerEl)
      .setName("Custom system instructions")
      .setDesc("Optional extra instructions appended to every session.")
      .addTextArea((area) => {
        area
          .setPlaceholder("e.g. Always answer in concise bullet points and prefer Evergreen notes first.")
          .setValue(this.plugin.settings.customSystemPrompt)
          .onChange(async (val) => {
            this.plugin.settings.customSystemPrompt = val;
            await this.plugin.savePluginData();
          });
        area.inputEl.rows = 4;
        area.inputEl.style.width = "100%";
      });

    containerEl.createEl("h3", { text: "CLI binary path overrides (optional)" });

    const binaryKeys: Array<{ key: ProviderId | "obsidian"; label: string; placeholder: string }> = [
      { key: "claude", label: "Claude CLI path", placeholder: "~/.local/bin/claude" },
      { key: "codex", label: "Codex CLI path", placeholder: "~/.local/bin/codex" },
      { key: "antigravity", label: "Antigravity CLI path", placeholder: "~/.local/bin/agy" },
      { key: "copilot", label: "GitHub Copilot CLI path", placeholder: "/opt/homebrew/bin/copilot" },
      { key: "opencode", label: "OpenCode CLI path", placeholder: "~/.opencode/bin/opencode" },
      { key: "obsidian", label: "Obsidian CLI path", placeholder: "/opt/homebrew/bin/obsidian" },
    ];

    for (const item of binaryKeys) {
      new Setting(containerEl)
        .setName(item.label)
        .addText((text) => {
          text
            .setPlaceholder(item.placeholder)
            .setValue(this.plugin.settings.binaryOverrides[item.key] ?? "")
            .onChange(async (val) => {
              const trimmed = val.trim();
              if (trimmed) {
                this.plugin.settings.binaryOverrides[item.key] = trimmed;
              } else {
                delete this.plugin.settings.binaryOverrides[item.key];
              }
              await this.plugin.savePluginData();
            });
        });
    }

    containerEl.createEl("h3", { text: "Extra custom models (comma-separated)" });
    for (const pid of PROVIDER_ORDER) {
      new Setting(containerEl)
        .setName(`${PROVIDER_META[pid].displayName} custom models`)
        .addText((text) => {
          text
            .setPlaceholder("model-a, model-b")
            .setValue((this.plugin.settings.customModelsByProvider[pid] ?? []).join(", "))
            .onChange(async (val) => {
              const list = val
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              if (list.length > 0) {
                this.plugin.settings.customModelsByProvider[pid] = list;
              } else {
                delete this.plugin.settings.customModelsByProvider[pid];
              }
              await this.plugin.savePluginData();
            });
        });
    }
  }
}
