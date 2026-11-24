import { describe, expect, it } from "vitest";
import { buildUserTurnPrompt } from "../src/context/promptBuilder";
import { extractPatternMatches } from "../src/context/patternMatcher";
import { stripFrontmatter } from "../src/context/vaultKnowledge";
import { DEFAULT_SETTINGS } from "../src/types";

describe("prompt builder", () => {
  it("packs focused note, marked excerpts with path/lines/heading, and Obsidian CLI guidance", () => {
    const built = buildUserTurnPrompt({
      userMessage: "Find other notes which write about the same topic",
      vaultName: "ossians-second-brain-sync",
      vaultRootPath: "/Users/ossianhempel/ossians-second-brain-sync",
      mode: "ask",
      activeFile: {
        filePath: "Notes/Deep Work.md",
        fileName: "Deep Work.md",
        title: "Deep Work",
        tags: ["evergreen"],
        cursorLine: 14,
        activeHeading: "Attention Residue",
        content: "# Deep Work\n\nSwitching tasks leaves attention residue.",
      },
      snippets: [
        {
          id: "s1",
          filePath: "Notes/Deep Work.md",
          fileName: "Deep Work.md",
          startLine: 3,
          endLine: 3,
          heading: "Attention Residue",
          text: "Switching tasks leaves attention residue.",
          createdAt: 1,
        },
      ],
      settings: DEFAULT_SETTINGS,
      obsidianCliAvailable: true,
      hasNativeSystemPrompt: false,
    });

    expect(built.systemInstructions).toContain("ASK (READ-ONLY)");
    expect(built.systemInstructions).toContain("obsidian search");
    expect(built.prompt).toContain("<system_instructions>");
    expect(built.prompt).toContain('path="Notes/Deep Work.md"');
    expect(built.prompt).toContain('lines="L3-L3"');
    expect(built.prompt).toContain('heading="Attention Residue"');
    expect(built.prompt).toContain("Switching tasks leaves attention residue.");
    expect(built.prompt).toContain("Find other notes which write about the same topic");
  });

  it("omits inline system_instructions when provider supports native system prompts", () => {
    const built = buildUserTurnPrompt({
      userMessage: "Summarize this",
      vaultName: "vault",
      vaultRootPath: "/tmp/vault",
      mode: "agent",
      activeFile: null,
      snippets: [],
      settings: DEFAULT_SETTINGS,
      obsidianCliAvailable: false,
      hasNativeSystemPrompt: true,
    });

    expect(built.systemInstructions).toContain("AGENT (EDIT ENABLED)");
    expect(built.prompt).not.toContain("<system_instructions>");
    expect(built.prompt).toBe("Summarize this");
  });

  it("injects vault AGENTS.md, Obsidian skill, and skips repeating inline system prompt on resume", () => {
    const knowledge = {
      agentsDocPath: "/vault/AGENTS.md",
      agentsDocContent: "# Vault Rules\nFlat Notes/ folder.",
      vaultGuideFiles: ["LINKING.md", "VOICE.md"],
      obsidianSkillPath: "/skills/obsidian/SKILL.md",
      obsidianSkillContent: "# Obsidian Skill\nUse wikilinks.",
    };

    const turn1 = buildUserTurnPrompt({
      userMessage: "Find related notes",
      vaultName: "second-brain",
      vaultRootPath: "/vault",
      mode: "agent",
      activeFile: null,
      snippets: [],
      settings: DEFAULT_SETTINGS,
      obsidianCliAvailable: true,
      vaultKnowledge: knowledge,
      hasNativeSystemPrompt: false,
      isResumingSession: false,
    });

    expect(turn1.systemInstructions).toContain("<vault_agents_instructions>");
    expect(turn1.systemInstructions).toContain("Flat Notes/ folder.");
    expect(turn1.systemInstructions).toContain("<obsidian_skill>");
    expect(turn1.systemInstructions).toContain("obsidian create");
    expect(turn1.systemInstructions).toContain("LINKING.md, VOICE.md");
    expect(turn1.prompt).toContain("<system_instructions>");

    const turn2 = buildUserTurnPrompt({
      userMessage: "Follow up",
      vaultName: "second-brain",
      vaultRootPath: "/vault",
      mode: "agent",
      activeFile: null,
      snippets: [],
      settings: DEFAULT_SETTINGS,
      obsidianCliAvailable: true,
      vaultKnowledge: knowledge,
      hasNativeSystemPrompt: false,
      isResumingSession: true,
    });

    expect(turn2.prompt).not.toContain("<system_instructions>");
    expect(turn2.prompt).toBe("Follow up");
  });
});

describe("stripFrontmatter", () => {
  it("strips YAML frontmatter from SKILL.md files", () => {
    expect(stripFrontmatter("---\nname: obsidian\n---\n# Title\nBody")).toBe("# Title\nBody");
    expect(stripFrontmatter("# No frontmatter")).toBe("# No frontmatter");
  });
});

describe("extractPatternMatches", () => {
  const doc = [
    "# Title",
    "First line about focus.",
    "Second line unrelated.",
    "Third line unrelated.",
    "Spacer line unrelated.",
    "Fourth line about Focus again.",
    "Fifth line also mentioning FOCUS.",
    "Sixth line end.",
  ].join("\n");

  it("finds case-insensitive literal matches and merges adjacent context windows", () => {
    const matches = extractPatternMatches(doc, "focus", {
      isRegex: false,
      caseSensitive: false,
      contextLines: 1,
    });

    expect(matches).toHaveLength(2);
    expect(matches[0].startLine).toBe(1);
    expect(matches[0].endLine).toBe(3);
    expect(matches[1].startLine).toBe(5);
    expect(matches[1].endLine).toBe(8);
    expect(doc.slice(matches[0].fromOffset, matches[0].toOffset)).toBe(matches[0].text);
    expect(doc.slice(matches[1].fromOffset, matches[1].toOffset)).toBe(matches[1].text);
  });

  it("supports regex and case-sensitive matching", () => {
    const matches = extractPatternMatches(doc, "^Fifth.*FOCUS", {
      isRegex: true,
      caseSensitive: true,
      contextLines: 0,
    });

    expect(matches).toHaveLength(1);
    expect(matches[0].startLine).toBe(7);
    expect(matches[0].endLine).toBe(7);
    expect(matches[0].text).toBe("Fifth line also mentioning FOCUS.");
  });
});
