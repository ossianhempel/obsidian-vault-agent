import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface VaultKnowledge {
  agentsDocPath: string | null;
  agentsDocContent: string | null;
  vaultGuideFiles: string[];
  obsidianSkillPath: string | null;
  obsidianSkillContent: string | null;
}

const KNOWN_GUIDE_FILES = [
  "LINKING.md",
  "VAULT_ARCHITECTURE.md",
  "VOICE.md",
  "STYLE.md",
];

const MAX_INJECTED_DOC_CHARS = 12000;

function expandHome(filePath: string): string {
  const trimmed = filePath.trim();
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function readFileTrimmed(filePath: string, maxChars = MAX_INJECTED_DOC_CHARS): string | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const stripped = stripFrontmatter(raw).trim();
    if (!stripped) return null;
    if (stripped.length > maxChars) {
      return `${stripped.slice(0, maxChars)}\n\n... [truncated after ${maxChars} chars; read full file at ${filePath}]`;
    }
    return stripped;
  } catch {
    return null;
  }
}

export function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---")) return markdown;
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? markdown.slice(match[0].length) : markdown;
}

export function resolveObsidianSkillPath(overridePath?: string): string | null {
  if (overridePath?.trim()) {
    const expanded = expandHome(overridePath);
    if (fs.existsSync(expanded) && fs.statSync(expanded).isFile()) {
      return expanded;
    }
  }

  const home = os.homedir();
  const candidates: string[] = [
    path.join(home, ".claude", "skills", "obsidian", "SKILL.md"),
    path.join(home, ".agents", "skills", "obsidian", "SKILL.md"),
    path.join(home, ".codex", "skills", "obsidian", "SKILL.md"),
    path.join(
      home,
      ".claude",
      "plugins",
      "marketplaces",
      "ossian-stack",
      "skills",
      "obsidian",
      "SKILL.md",
    ),
    path.join(home, "Developer", "ossian-stack", "skills", "obsidian", "SKILL.md"),
  ];

  // Also check Claude plugin cache versions
  const cacheBase = path.join(
    home,
    ".claude",
    "plugins",
    "cache",
    "ossian-stack",
    "ossian-stack",
  );
  try {
    if (fs.existsSync(cacheBase)) {
      const entries = fs.readdirSync(cacheBase).sort().reverse();
      for (const entry of entries) {
        candidates.push(path.join(cacheBase, entry, "skills", "obsidian", "SKILL.md"));
      }
    }
  } catch {
    // ignore
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

export function loadVaultKnowledge(
  vaultRootPath: string | null,
  options: {
    injectVaultAgentsMd: boolean;
    injectObsidianSkill: boolean;
    obsidianSkillPathOverride?: string;
  },
): VaultKnowledge {
  let agentsDocPath: string | null = null;
  let agentsDocContent: string | null = null;
  const vaultGuideFiles: string[] = [];

  if (vaultRootPath) {
    for (const candidate of ["AGENTS.md", "CLAUDE.md"]) {
      const full = path.join(vaultRootPath, candidate);
      if (fs.existsSync(full)) {
        agentsDocPath = full;
        if (options.injectVaultAgentsMd) {
          agentsDocContent = readFileTrimmed(full);
        }
        break;
      }
    }

    for (const guide of KNOWN_GUIDE_FILES) {
      if (fs.existsSync(path.join(vaultRootPath, guide))) {
        vaultGuideFiles.push(guide);
      }
    }
  }

  const obsidianSkillPath = resolveObsidianSkillPath(options.obsidianSkillPathOverride);
  const obsidianSkillContent =
    obsidianSkillPath && options.injectObsidianSkill
      ? readFileTrimmed(obsidianSkillPath, 6000)
      : null;

  return {
    agentsDocPath,
    agentsDocContent,
    vaultGuideFiles,
    obsidianSkillPath,
    obsidianSkillContent,
  };
}
