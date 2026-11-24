import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

const EXTRA_MAC_LINUX_DIRS = [
  ".local/bin",
  ".opencode/bin",
  ".bun/bin",
  ".cargo/bin",
  ".npm-global/bin",
  "bin",
];

const SYSTEM_DIRS = [
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
];

let cachedLoginPath: string | null | undefined;

function getNvmBinDirs(home: string): string[] {
  const nvmVersionsDir = path.join(home, ".nvm", "versions", "node");
  try {
    if (!fs.existsSync(nvmVersionsDir)) return [];
    const versions = fs
      .readdirSync(nvmVersionsDir)
      .filter((v) => v.startsWith("v"))
      .sort()
      .reverse();
    return versions.map((v) => path.join(nvmVersionsDir, v, "bin"));
  } catch {
    return [];
  }
}

function readLoginShellPath(): string | null {
  if (cachedLoginPath !== undefined) return cachedLoginPath;
  if (process.platform === "win32") {
    cachedLoginPath = null;
    return null;
  }
  const shell = process.env.SHELL || "/bin/zsh";
  try {
    const out = execFileSync(shell, ["-lc", "printf '%s' \"$PATH\""], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    cachedLoginPath = out || null;
  } catch {
    cachedLoginPath = null;
  }
  return cachedLoginPath;
}

export function buildEnhancedPath(existingPath?: string): string {
  const sep = path.delimiter;
  const home = os.homedir();
  const candidates: string[] = [];

  const loginPath = readLoginShellPath();
  if (loginPath) {
    candidates.push(...loginPath.split(sep));
  }
  if (existingPath) {
    candidates.push(...existingPath.split(sep));
  }

  if (process.platform !== "win32") {
    for (const rel of EXTRA_MAC_LINUX_DIRS) {
      candidates.push(path.join(home, rel));
    }
    candidates.push(...getNvmBinDirs(home));
    candidates.push(...SYSTEM_DIRS);
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const dir of candidates) {
    const trimmed = dir.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
  }
  return unique.join(sep);
}

export function buildSpawnEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: buildEnhancedPath(process.env.PATH),
    NO_COLOR: "1",
    TERM: "dumb",
  };
  return env;
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (process.platform === "win32") return true;
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveBinary(binaryName: string, overridePath?: string): string | null {
  const override = overridePath?.trim();
  if (override) {
    const expanded = override.startsWith("~/")
      ? path.join(os.homedir(), override.slice(2))
      : override;
    if (isExecutableFile(expanded)) return expanded;
  }

  if (path.isAbsolute(binaryName) && isExecutableFile(binaryName)) {
    return binaryName;
  }

  const enhancedPath = buildEnhancedPath(process.env.PATH);
  const dirs = enhancedPath.split(path.delimiter);
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];

  for (const dir of dirs) {
    for (const ext of extensions) {
      const full = path.join(dir, `${binaryName}${ext}`);
      if (isExecutableFile(full)) {
        return full;
      }
    }
  }
  return null;
}
