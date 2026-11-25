# Vault CLI Agent

A desktop sidebar AI agent for Obsidian powered by your locally installed, subscription-authenticated coding & writing CLIs — **Claude Code**, **Codex**, **Antigravity**, **GitHub Copilot**, and **OpenCode** — without managing separate API keys inside Obsidian.

## Features

- **Provider, model & effort dropdowns**: Switch between installed local CLIs, pick from dynamically discovered models (`~/.codex/models_cache.json`, `agy models`, `opencode models`) or curated lists, and adjust reasoning effort per model.
- **Automatic focused-note context**: Tracks the Markdown note you are working in (even after focusing the chat sidebar) and attaches its vault-relative path, frontmatter/inline tags, cursor line, enclosing heading, and content. Toggle it on or off per chat with the eye icon.
- **Mark & attach text selections and patterns**:
  - Highlight text in any note and click **`+ Attach selection (L…)`** in the sidebar, right-click → **Ask about selection** / **Attach selection**, or use the Command Palette.
  - Click **Pattern** to match a literal string or regular expression across the active note and attach all matching passages with surrounding context lines.
  - Queued excerpts are highlighted in the editor via CodeMirror 6 and sent with vault-relative path, line range, heading, and verbatim text. Click any chip to jump back to the passage.
- **Vault traversal, `AGENTS.md`, and Obsidian CLI**:
  - Runs each CLI with your vault root as the working directory and your login shell `PATH` so the `obsidian` CLI (`search`, `backlinks`, `links`, `read`, `files`, `tags`, `properties`, `base:query`) and filesystem search tools work out of the box.
  - Automatically injects your vault's `AGENTS.md` / `CLAUDE.md` and optional Obsidian `SKILL.md` across all providers (both configurable in Settings).
  - Renders responses using Obsidian's native Markdown renderer so `[[wikilinks]]` open notes directly.
- **Ask (read-only) vs Agent (edit) mode**: Starts in read-only **Ask** mode so the assistant can explore and search without modifying notes; flip to **Agent** when you want it to edit or create notes.

## Prerequisites

- **Obsidian Desktop** (macOS, Linux, or Windows; desktop-only because it spawns local CLI subprocesses).
- At least one supported CLI installed and signed in on your machine:
  - `claude` (Claude Code)
  - `codex` (OpenAI Codex CLI)
  - `agy` (Antigravity CLI)
  - `copilot` (GitHub Copilot CLI)
  - `opencode` (OpenCode CLI)
- Optional: `obsidian` CLI installed in `PATH` for live vault graph/base queries.

## Privacy & external services disclosure

This plugin does not include telemetry, analytics, or a backend of its own. When you send a message in the sidebar:

- The plugin spawns the local CLI binary you selected (`claude`, `codex`, `agy`, `copilot`, or `opencode`) on your computer.
- Your prompt, any attached text excerpts, and (if enabled) the active note's path/metadata/body and vault instructions are passed to that CLI, which transmits them to the corresponding third-party AI provider under your own subscription and account terms.
- Chat history and settings are stored locally inside your vault's `.obsidian/plugins/vault-cli-agent/data.json`.

## Installation

### From Community plugins (once listed)
1. Open **Settings → Community plugins → Browse**.
2. Search for **Vault CLI Agent**, click **Install**, and **Enable**.

### Manual / from GitHub Releases
1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [GitHub Release](https://github.com/ossianhempel/obsidian-vault-agent/releases/latest).
2. Place them in `<your-vault>/.obsidian/plugins/vault-cli-agent/`.
3. Reload plugins and enable **Vault CLI Agent** in **Settings → Community plugins**.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
npm run deploy -- --reload
```
