import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildSpawnEnv, resolveBinary } from "../env";
import type {
  EffortLevel,
  ModelInfo,
  ProviderId,
  ProviderInfo,
  VaultAgentSettings,
} from "../types";

const execFileAsync = promisify(execFile);

const EFFORT_ORDER: EffortLevel[] = [
  "default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

const EFFORT_SET = new Set<string>(EFFORT_ORDER);

export const PROVIDER_META: Record<
  ProviderId,
  { displayName: string; binaryName: string }
> = {
  claude: { displayName: "Claude Code", binaryName: "claude" },
  codex: { displayName: "Codex", binaryName: "codex" },
  antigravity: { displayName: "Antigravity", binaryName: "agy" },
  copilot: { displayName: "GitHub Copilot", binaryName: "copilot" },
  opencode: { displayName: "OpenCode", binaryName: "opencode" },
};

export const PROVIDER_ORDER: ProviderId[] = [
  "claude",
  "codex",
  "antigravity",
  "copilot",
  "opencode",
];

const CLAUDE_DEFAULT_MODELS: ModelInfo[] = [
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "medium",
  },
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "high",
  },
  {
    id: "claude-fable-5-2",
    label: "Claude Fable 5.2",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "medium",
  },
  {
    id: "claude-fable-5-1",
    label: "Claude Fable 5.1",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "medium",
  },
  {
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "medium",
  },
  {
    id: "opus",
    label: "Opus (latest alias)",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "medium",
  },
  {
    id: "sonnet",
    label: "Sonnet (latest alias)",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "medium",
  },
  {
    id: "haiku",
    label: "Haiku (latest alias)",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "low",
  },
];

const CODEX_FALLBACK_MODELS: ModelInfo[] = [
  {
    id: "gpt-6.2-sol",
    label: "GPT-6.2-Sol",
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    defaultEffort: "medium",
  },
  {
    id: "gpt-6.2-astra",
    label: "GPT-6.2-Astra",
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    defaultEffort: "medium",
  },
  {
    id: "gpt-6.1-terra",
    label: "GPT-6.1 Terra",
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    defaultEffort: "medium",
  },
  {
    id: "gpt-6.1-sol",
    label: "GPT-6.1-Sol",
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    defaultEffort: "medium",
  },
];

const AGY_FALLBACK_MODELS: ModelInfo[] = [
  {
    id: "gemini-4-neon",
    label: "Gemini 4 Neon",
    efforts: ["low", "medium", "high", "xhigh"],
    defaultEffort: "high",
    effortModelIds: {
      low: "gemini-4-neon-low",
      medium: "gemini-4-neon-medium",
      high: "gemini-4-neon-high",
      xhigh: "gemini-4-neon-xhigh",
    },
  },
  {
    id: "gemini-4-carbon",
    label: "Gemini 4 Carbon",
    efforts: ["low", "medium", "high"],
    defaultEffort: "high",
    effortModelIds: {
      low: "gemini-4-carbon-low",
      medium: "gemini-4-carbon-medium",
      high: "gemini-4-carbon-high",
    },
  },
  {
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    efforts: ["low", "medium", "high"],
    defaultEffort: "medium",
    effortModelIds: {
      low: "gemini-3.8-flash-low",
      medium: "gemini-3.8-flash-medium",
      high: "gemini-3.8-flash-high",
    },
  },
];

const COPILOT_DEFAULT_MODELS: ModelInfo[] = [
  {
    id: "auto",
    label: "Auto (Copilot Router)",
    efforts: ["default"],
    defaultEffort: "default",
  },
  {
    id: "claude-sonnet-5.5",
    label: "Claude Sonnet 5.5",
    efforts: ["default", "low", "medium", "high", "xhigh", "max"],
    defaultEffort: "medium",
  },
  {
    id: "claude-opus-5.5",
    label: "Claude Opus 5.5",
    efforts: ["default", "low", "medium", "high", "xhigh", "max"],
    defaultEffort: "medium",
  },
  {
    id: "gpt-6.2-sol",
    label: "GPT-6.2 Sol",
    efforts: ["default", "low", "medium", "high", "xhigh", "max"],
    defaultEffort: "medium",
  },
  {
    id: "gpt-6.1-sol",
    label: "GPT-6.1 Sol",
    efforts: ["default", "low", "medium", "high", "xhigh", "max"],
    defaultEffort: "medium",
  },
  {
    id: "gpt-6-luna",
    label: "GPT-6 Luna",
    efforts: ["default", "low", "medium", "high", "xhigh"],
    defaultEffort: "medium",
  },
  {
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    efforts: ["default", "low", "medium", "high", "xhigh"],
    defaultEffort: "medium",
  },
];

const OPENCODE_FALLBACK_MODELS: ModelInfo[] = [
  {
    id: "opencode-go/claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    efforts: ["default", "low", "medium", "high", "xhigh", "max"],
    defaultEffort: "medium",
  },
  {
    id: "opencode-go/deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    efforts: ["default", "high", "max"],
    defaultEffort: "high",
  },
  {
    id: "opencode/beam-free",
    label: "Beam Free",
    efforts: ["default", "low", "medium", "high"],
    defaultEffort: "medium",
  },
];

function sortEfforts(efforts: EffortLevel[]): EffortLevel[] {
  const unique = Array.from(new Set(efforts));
  return unique.sort((a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b));
}

export function parseCodexModelsCache(rawJson: string): ModelInfo[] {
  try {
    const parsed = JSON.parse(rawJson) as {
      models?: Array<{
        slug?: string;
        display_name?: string;
        visibility?: string;
        default_reasoning_level?: string;
        supported_reasoning_levels?: Array<{ effort?: string }>;
      }>;
    };
    if (!Array.isArray(parsed.models)) return [];
    const out: ModelInfo[] = [];
    for (const m of parsed.models) {
      if (!m.slug) continue;
      if (m.visibility && m.visibility !== "list") continue;
      const efforts: EffortLevel[] = [];
      for (const r of m.supported_reasoning_levels ?? []) {
        if (r.effort && EFFORT_SET.has(r.effort)) {
          efforts.push(r.effort as EffortLevel);
        }
      }
      const sortedEfforts: EffortLevel[] =
        efforts.length > 0 ? sortEfforts(efforts) : ["low", "medium", "high"];
      const def =
        m.default_reasoning_level && sortedEfforts.includes(m.default_reasoning_level as EffortLevel)
          ? (m.default_reasoning_level as EffortLevel)
          : sortedEfforts[0];
      out.push({
        id: m.slug,
        label: m.display_name || m.slug,
        efforts: sortedEfforts,
        defaultEffort: def,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function parseAgyModelsOutput(stdout: string): ModelInfo[] {
  const grouped = new Map<
    string,
    {
      label: string;
      efforts: EffortLevel[];
      effortModelIds: Partial<Record<EffortLevel, string>>;
    }
  >();

  const suffixRe = /-(low|medium|high|xhigh|max)$/;
  const labelSuffixRe = /\s*\((Low|Medium|High|XHigh|Max)\)\s*$/i;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.includes("\t")) continue;
    const [modelId, rawLabel] = line.split("\t").map((s) => s.trim());
    if (!modelId) continue;

    const match = modelId.match(suffixRe);
    if (match) {
      const effort = match[1] as EffortLevel;
      const baseId = modelId.slice(0, -match[0].length);
      const baseLabel = (rawLabel || baseId).replace(labelSuffixRe, "").trim();
      const existing = grouped.get(baseId) ?? {
        label: baseLabel,
        efforts: [],
        effortModelIds: {},
      };
      if (!existing.efforts.includes(effort)) {
        existing.efforts.push(effort);
      }
      existing.effortModelIds[effort] = modelId;
      grouped.set(baseId, existing);
    } else {
      const existing = grouped.get(modelId) ?? {
        label: rawLabel || modelId,
        efforts: ["default"],
        effortModelIds: { default: modelId },
      };
      grouped.set(modelId, existing);
    }
  }

  const results: ModelInfo[] = [];
  for (const [id, info] of grouped.entries()) {
    const sorted = sortEfforts(info.efforts);
    const defaultEffort: EffortLevel = sorted.includes("high")
      ? "high"
      : sorted.includes("medium")
        ? "medium"
        : sorted[0] ?? "default";
    results.push({
      id,
      label: info.label,
      efforts: sorted,
      defaultEffort,
      effortModelIds: info.effortModelIds,
    });
  }
  return results;
}

export function parseOpencodeModelsOutput(stdout: string): ModelInfo[] {
  const results: ModelInfo[] = [];
  const seen = new Set<string>();
  for (const rawLine of stdout.split(/\r?\n/)) {
    const id = rawLine.trim();
    if (!id || !id.includes("/") || id.includes(" ")) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    results.push({
      id,
      label: id,
      efforts: ["default", "low", "medium", "high", "xhigh", "max"],
      defaultEffort: "default",
    });
  }
  return results;
}

function mergeCustomModels(
  baseModels: ModelInfo[],
  customIds: string[] | undefined,
  defaultEfforts: EffortLevel[],
): ModelInfo[] {
  if (!customIds || customIds.length === 0) return baseModels;
  const existing = new Set(baseModels.map((m) => m.id));
  const merged = [...baseModels];
  for (const raw of customIds) {
    const id = raw.trim();
    if (!id || existing.has(id)) continue;
    existing.add(id);
    merged.push({
      id,
      label: `${id} (custom)`,
      efforts: defaultEfforts,
      defaultEffort: defaultEfforts.includes("medium") ? "medium" : defaultEfforts[0],
    });
  }
  return merged;
}

async function discoverCodexModels(): Promise<ModelInfo[]> {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const cachePath = path.join(codexHome, "models_cache.json");
  try {
    const raw = await fs.promises.readFile(cachePath, "utf8");
    const parsed = parseCodexModelsCache(raw);
    if (parsed.length > 0) return parsed;
  } catch {
    // fallback below
  }
  return CODEX_FALLBACK_MODELS;
}

async function discoverAgyModels(binaryPath: string | null): Promise<ModelInfo[]> {
  if (!binaryPath) return AGY_FALLBACK_MODELS;
  try {
    const { stdout } = await execFileAsync(binaryPath, ["models"], {
      env: buildSpawnEnv(),
      timeout: 8000,
      maxBuffer: 1024 * 1024,
    });
    const parsed = parseAgyModelsOutput(stdout);
    if (parsed.length > 0) return parsed;
  } catch {
    // fallback below
  }
  return AGY_FALLBACK_MODELS;
}

async function discoverOpencodeModels(binaryPath: string | null): Promise<ModelInfo[]> {
  if (!binaryPath) return OPENCODE_FALLBACK_MODELS;
  try {
    const { stdout } = await execFileAsync(binaryPath, ["models"], {
      env: buildSpawnEnv(),
      timeout: 8000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const parsed = parseOpencodeModelsOutput(stdout);
    if (parsed.length > 0) return parsed;
  } catch {
    // fallback below
  }
  return OPENCODE_FALLBACK_MODELS;
}

export async function discoverAllProviders(
  settings: VaultAgentSettings,
): Promise<Record<ProviderId, ProviderInfo>> {
  const binaryPaths: Record<ProviderId, string | null> = {
    claude: resolveBinary("claude", settings.binaryOverrides.claude),
    codex: resolveBinary("codex", settings.binaryOverrides.codex),
    antigravity: resolveBinary("agy", settings.binaryOverrides.antigravity),
    copilot: resolveBinary("copilot", settings.binaryOverrides.copilot),
    opencode: resolveBinary("opencode", settings.binaryOverrides.opencode),
  };

  const [codexModels, agyModels, opencodeModels] = await Promise.all([
    discoverCodexModels(),
    discoverAgyModels(binaryPaths.antigravity),
    discoverOpencodeModels(binaryPaths.opencode),
  ]);

  const claudeModels = mergeCustomModels(
    CLAUDE_DEFAULT_MODELS,
    settings.customModelsByProvider.claude,
    ["low", "medium", "high", "xhigh", "max"],
  );
  const copilotModels = mergeCustomModels(
    COPILOT_DEFAULT_MODELS,
    settings.customModelsByProvider.copilot,
    ["default", "low", "medium", "high", "xhigh", "max"],
  );

  return {
    claude: {
      id: "claude",
      displayName: PROVIDER_META.claude.displayName,
      binaryName: PROVIDER_META.claude.binaryName,
      installed: binaryPaths.claude !== null,
      binaryPath: binaryPaths.claude,
      models: claudeModels,
    },
    codex: {
      id: "codex",
      displayName: PROVIDER_META.codex.displayName,
      binaryName: PROVIDER_META.codex.binaryName,
      installed: binaryPaths.codex !== null,
      binaryPath: binaryPaths.codex,
      models: mergeCustomModels(
        codexModels,
        settings.customModelsByProvider.codex,
        ["low", "medium", "high", "xhigh", "max", "ultra"],
      ),
    },
    antigravity: {
      id: "antigravity",
      displayName: PROVIDER_META.antigravity.displayName,
      binaryName: PROVIDER_META.antigravity.binaryName,
      installed: binaryPaths.antigravity !== null,
      binaryPath: binaryPaths.antigravity,
      models: mergeCustomModels(
        agyModels,
        settings.customModelsByProvider.antigravity,
        ["low", "medium", "high", "xhigh"],
      ),
    },
    copilot: {
      id: "copilot",
      displayName: PROVIDER_META.copilot.displayName,
      binaryName: PROVIDER_META.copilot.binaryName,
      installed: binaryPaths.copilot !== null,
      binaryPath: binaryPaths.copilot,
      models: copilotModels,
    },
    opencode: {
      id: "opencode",
      displayName: PROVIDER_META.opencode.displayName,
      binaryName: PROVIDER_META.opencode.binaryName,
      installed: binaryPaths.opencode !== null,
      binaryPath: binaryPaths.opencode,
      models: mergeCustomModels(
        opencodeModels,
        settings.customModelsByProvider.opencode,
        ["default", "low", "medium", "high", "xhigh", "max"],
      ),
    },
  };
}
