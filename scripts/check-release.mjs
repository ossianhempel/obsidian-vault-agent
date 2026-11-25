import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

export function readReleaseMetadata() {
  const root = process.cwd();
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const versions = JSON.parse(fs.readFileSync(path.join(root, "versions.json"), "utf8"));

  assert.match(manifest.id, /^[a-z0-9-]+$/, "manifest.id must be kebab-case");
  assert.ok(!manifest.id.startsWith("obsidian-"), "manifest.id must not start with obsidian-");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/, "manifest.version must be semver");
  assert.equal(manifest.version, pkg.version, "manifest.json and package.json versions must match");
  assert.equal(
    versions[manifest.version],
    manifest.minAppVersion,
    "versions.json must map current version to minAppVersion",
  );
  assert.ok(manifest.description.length <= 250, "manifest.description must be <= 250 chars");
  assert.ok(manifest.description.endsWith("."), "manifest.description must end with a period");

  for (const artifact of ["main.js", "manifest.json", "styles.css"]) {
    const p = path.join(root, artifact);
    assert.ok(fs.existsSync(p) && fs.statSync(p).size > 0, `Missing or empty build artifact: ${artifact}`);
  }

  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifest = readReleaseMetadata();
  console.log(`Release metadata OK: ${manifest.id} v${manifest.version} (minApp ${manifest.minAppVersion})`);
}
