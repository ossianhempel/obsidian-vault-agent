import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

const PLUGIN_ID = "vault-agent";
const FILES_TO_COPY = ["manifest.json", "main.js", "styles.css"];

function resolveVaultPath() {
  if (process.env.OBSIDIAN_VAULT_PATH) {
    return process.env.OBSIDIAN_VAULT_PATH;
  }
  const home = os.homedir();
  const candidates = [
    path.join(home, "ossians-second-brain-sync"),
    path.join(home, "Developer", "ossians-second-brain-sync"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, ".obsidian"))) {
      return dir;
    }
  }
  throw new Error(
    "Could not locate Obsidian vault. Set OBSIDIAN_VAULT_PATH=/path/to/vault.",
  );
}

const vaultPath = resolveVaultPath();
const targetDir = path.join(vaultPath, ".obsidian", "plugins", PLUGIN_ID);
fs.mkdirSync(targetDir, { recursive: true });

for (const file of FILES_TO_COPY) {
  const src = path.resolve(process.cwd(), file);
  if (!fs.existsSync(src)) {
    throw new Error(`Missing build artifact: ${src}`);
  }
  fs.copyFileSync(src, path.join(targetDir, file));
  console.log(`Copied ${file} -> ${path.join(targetDir, file)}`);
}

if (process.argv.includes("--reload")) {
  try {
    execFileSync("obsidian", ["eval", "code=await app.plugins.loadManifests()"], {
      stdio: "inherit",
    });
    execFileSync("obsidian", ["plugin:enable", `id=${PLUGIN_ID}`], {
      stdio: "inherit",
    });
    execFileSync("obsidian", ["plugin:reload", `id=${PLUGIN_ID}`], {
      stdio: "inherit",
    });
    console.log(`Reloaded ${PLUGIN_ID} in Obsidian.`);
  } catch (err) {
    console.warn("Could not reload via obsidian CLI:", err instanceof Error ? err.message : err);
  }
}
