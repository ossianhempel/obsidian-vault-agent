# Vault Agent (Obsidian Plugin)

A VS Code Claude / Copilot-style AI agent sidebar inside Obsidian powered by your locally installed, subscription-authenticated AI CLIs — no extra API keys required.

## Features

- **Multi-provider, model & effort dropdowns**: Switch between **Claude Code** (`claude`), **Codex** (`codex`), **Antigravity** (`agy`), **GitHub Copilot** (`copilot`), and **OpenCode** (`opencode`), with live model discovery (`~/.codex/models_cache.json`, `agy models`, `opencode models`) and per-model reasoning effort dropdowns.
- **Automatic focused-file context**: Tracks the note you are focused on (even after clicking into the chat sidebar) and injects its vault-relative path, tags, cursor line, active heading, and body automatically, with a one-click eye toggle per chat.
- **Mark & attach text selections and patterns**:
  - Select text in any note → right-click → **Ask Vault Agent about selection** or **Attach selection to Vault Agent**
  - Click the live **`+ Attach selection`** pill that appears in the chat sidebar whenever text is selected
  - Use **Pattern** (or command `Mark & attach text pattern matches from active note`) to attach every passage matching a literal text or regex pattern
  - Attached passages are highlighted directly in the editor via CodeMirror 6 and sent with vault-relative path, line numbers, enclosing heading, and verbatim text. Click any chip to jump back to that passage.
- **Obsidian CLI + Vault `AGENTS.md` + Obsidian Skill injection**:
  - Runs every CLI with your vault root as `cwd` and your login shell `PATH` (including `obsidian`).
  - Automatically injects the full Obsidian CLI reference (`search`, `search:context`, `backlinks`, `links`, `unresolved`, `orphans`, `files`, `read`, `outline`, `tags`, `properties`, `base:query`, and write commands in Agent mode), your vault's `AGENTS.md`, and your installed `obsidian` `SKILL.md` into every provider.
  - Renders `[[wikilinks]]` as clickable native Obsidian links inside chat replies.
- **Ask (Read-only) vs Agent (Edit) mode**: Defaults to safe read-only exploration; flip to **Agent** when you want the model to create or edit notes.

## Development & Deploy

```bash
npm install
npm run typecheck
npm test
npm run build
npm run deploy -- --reload
```
