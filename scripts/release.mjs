import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readReleaseMetadata } from "./check-release.mjs";

const manifest = readReleaseMetadata();
const repo = process.env.GITHUB_REPOSITORY;
const sha = process.env.GITHUB_SHA;

assert.ok(repo, "GITHUB_REPOSITORY is required");
assert.equal(process.env.GITHUB_EVENT_NAME, "push");
assert.equal(process.env.GITHUB_REF, "refs/heads/main");
assert.match(sha ?? "", /^[a-f0-9]{40}$/);

const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });

const releases = JSON.parse(
  gh(["api", "--paginate", "--slurp", `repos/${repo}/releases?per_page=100`]),
).flat();

const existing = releases.find((r) => r.tag_name === manifest.version);
const versionParts = (v) => v.split(".").map(Number);
const compare = (a, b) => {
  const x = versionParts(a);
  const y = versionParts(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

for (const release of releases) {
  if (!release.draft && /^\d+\.\d+\.\d+$/.test(release.tag_name)) {
    assert.ok(
      compare(manifest.version, release.tag_name) >= 0,
      "manifest.version would downgrade an existing release",
    );
  }
}

const assets = ["main.js", "manifest.json", "styles.css"];

if (existing && !existing.draft) {
  assert.ok(!existing.prerelease, "Existing version is a prerelease");
  const names = new Set(existing.assets.map((a) => a.name));
  for (const name of assets) {
    assert.ok(names.has(name), `Existing release missing ${name}`);
  }
  console.log(
    `Version ${manifest.version} already released; bump manifest.json / package.json / versions.json to publish an update.`,
  );
} else {
  if (existing) {
    gh(["release", "upload", manifest.version, "--clobber", ...assets]);
  } else {
    // Draft first so a failed upload never exposes an incomplete release
    gh([
      "release",
      "create",
      manifest.version,
      "--target",
      sha,
      "--draft",
      "--title",
      `${manifest.name} ${manifest.version}`,
      "--generate-notes",
      ...assets,
    ]);
  }
  gh(["release", "edit", manifest.version, "--draft=false", "--latest"]);
  console.log(`Published ${manifest.name} ${manifest.version} from ${sha}`);
}
