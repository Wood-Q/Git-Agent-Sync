import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { readConfig, scoreProjectManifest, stableProjectId, writeConfig, writeGitignoreEntry } from "../dist/config.js";
import { legacyProjectIdForPath } from "../dist/config.js";
import { sha256 } from "../dist/utils.js";

const base = mkdtempSync(join(tmpdir(), "agent-sync-config-"));

function gitInit(repo) {
  mkdirSync(repo, { recursive: true });
  const r = (args) => spawnSync("git", args, { cwd: repo, encoding: "utf8", env: process.env });
  if (r(["init", "-b", "main"]).status !== 0) throw new Error("git init failed");
  r(["config", "user.name", "Test"]);
  r(["config", "user.email", "test@example.invalid"]);
  writeFileSync(join(repo, "README.md"), "# x\n");
  r(["add", "README.md"]);
  r(["commit", "-m", "init"]);
}

// --- stableProjectId: deterministic, identity-derived --------------------
{
  const id = stableProjectId("MyProject", "git:github.com/you/myproject");
  assert.equal(id, `MyProject-${sha256("git:github.com/you/myproject").slice(0, 10)}`);
  // Same identity → same id (stable across machines).
  assert.equal(stableProjectId("MyProject", "git:github.com/you/myproject"), id);
  // Different identity → different id.
  assert.notEqual(stableProjectId("MyProject", "git:github.com/you/other"), id);
}

// --- legacyProjectIdForPath: path-derived (the old scheme) ---------------
{
  const legacy = legacyProjectIdForPath(join(base, "proj"));
  assert.ok(legacy.startsWith("proj-"));
  assert.equal(legacy, `proj-${sha256(resolve(join(base, "proj")).replaceAll("\\", "/")).slice(0, 10)}`);
}

// --- writeConfig / readConfig round-trip ---------------------------------
{
  const repo = join(base, "repo-a");
  gitInit(repo);
  writeConfig(repo, { projectId: "X-aaaaaaaaaa", projectName: "X", storePath: ".agent-sync-store" });
  const cfg = readConfig(repo);
  assert.equal(cfg.projectName, "X");
  assert.equal(cfg.projectRoot, repo);
  assert.ok(cfg.storePath.endsWith(".agent-sync-store"));
}

// readConfig without init throws.
{
  const repo = join(base, "no-init");
  mkdirSync(repo, { recursive: true });
  assert.throws(() => readConfig(repo), /not initialized/);
}

// --- legacy config: no projectIdentity → derives fresh stable id --------
{
  const repo = join(base, "legacy");
  gitInit(repo);
  // Legacy config stored only a projectId, no identity.
  writeConfig(repo, { projectId: "Legacy-oldhash", projectName: "Legacy", storePath: ".agent-sync-store" });
  const cfg = readConfig(repo);
  // No remote ⇒ identity is name:<basename>; projectId is recomputed stable.
  assert.equal(cfg.projectIdentity, "name:legacy");
  assert.equal(cfg.projectId, stableProjectId("Legacy", "name:legacy"));
  // The old stored id is preserved in legacyProjectIds so old bundles match.
  assert.ok(cfg.legacyProjectIds.includes("Legacy-oldhash"));
}

// --- scoreProjectManifest: ranks compatible bundles ----------------------
{
  const config = {
    projectId: "P-new",
    projectIdentity: "git:github.com/you/p",
    projectName: "P",
    legacyProjectIds: ["P-legacy"]
  };
  // Exact identity + name + remote match scores highest.
  const perfect = scoreProjectManifest(config, {
    projectIdentity: "git:github.com/you/p",
    projectName: "P",
    projectRemote: "git@github.com:you/p.git",
    legacyProjectIds: ["P-new"]
  });
  assert.ok(perfect >= 4 + 2 + 4 + 5, `perfect should be high, got ${perfect}`);

  // Foreign project scores zero.
  const foreign = scoreProjectManifest(config, {
    projectIdentity: "git:github.com/other/x",
    projectName: "Other"
  });
  assert.equal(foreign, 0);

  // Legacy id match alone contributes.
  const legacyOnly = scoreProjectManifest(config, {
    projectId: "P-legacy"
  });
  assert.equal(legacyOnly, 5);
}

// --- writeGitignoreEntry: idempotent -------------------------------------
{
  const repo = join(base, "ignore");
  mkdirSync(repo, { recursive: true });
  writeGitignoreEntry(repo, ".agent-sync-store");
  writeGitignoreEntry(repo, ".agent-sync-store"); // duplicate, must not duplicate the line
  writeGitignoreEntry(repo, ".agent-sync");
  const content = readFileSync(join(repo, ".gitignore"), "utf8");
  const lines = content.split(/\r?\n/).filter(Boolean);
  assert.equal(lines.filter((l) => l === ".agent-sync-store/").length, 1);
  assert.equal(lines.filter((l) => l === ".agent-sync/").length, 1);
  assert.ok(existsSync(join(repo, ".gitignore")));
}

rmSync(base, { recursive: true, force: true });
console.log("config test passed");
