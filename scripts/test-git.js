import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { getGitContext, getProjectIdentity, getProjectRemote, normalizeRemoteUrl } from "../dist/git.js";

const base = mkdtempSync(join(tmpdir(), "agent-sync-git-"));

function git(args, cwd, env = {}) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

// --- normalizeRemoteUrl: SSH / HTTPS / variants collapse to one identity -
assert.equal(normalizeRemoteUrl("git@github.com:Wood-Q/Git-Agent-Sync.git"), "github.com/wood-q/git-agent-sync");
assert.equal(normalizeRemoteUrl("git@github.com:Wood-Q/Git-Agent-Sync"), "github.com/wood-q/git-agent-sync");
assert.equal(normalizeRemoteUrl("https://github.com/Wood-Q/Git-Agent-Sync.git"), "github.com/wood-q/git-agent-sync");
assert.equal(normalizeRemoteUrl("https://github.com/Wood-Q/Git-Agent-Sync"), "github.com/wood-q/git-agent-sync");
assert.equal(normalizeRemoteUrl("ssh://git@github.com/Wood-Q/Git-Agent-Sync.git"), "github.com/wood-q/git-agent-sync");
assert.equal(normalizeRemoteUrl("git+https://github.com/Wood-Q/Repo.git"), "github.com/wood-q/repo");
assert.equal(normalizeRemoteUrl(""), "");
assert.equal(normalizeRemoteUrl("   "), "");

// All three forms of the same repo produce the SAME identity (the core point).
const same = new Set([
  normalizeRemoteUrl("git@github.com:you/repo.git"),
  normalizeRemoteUrl("https://github.com/you/repo.git"),
  normalizeRemoteUrl("ssh://git@github.com/you/repo")
]);
assert.equal(same.size, 1);

// --- getProjectIdentity / getProjectRemote / getGitContext on a real repo -
const repo = join(base, "project");
mkdirSync(repo, { recursive: true });
git(["init", "-b", "main"], repo);
git(["config", "user.name", "Test"], repo);
git(["config", "user.email", "test@example.invalid"], repo);
writeFileSync(join(repo, "README.md"), "# test\n");
git(["add", "README.md"], repo);
git(["commit", "-m", "initial"], repo);

// No remote → name-based identity.
{
  const identity = getProjectIdentity(repo);
  assert.equal(identity, "name:project");
  const remote = getProjectRemote(repo);
  assert.equal(remote, null);
}

// With an origin remote → git:<normalized> identity.
git(["remote", "add", "origin", "git@github.com:you/project.git"], repo);
{
  const identity = getProjectIdentity(repo);
  assert.equal(identity, "git:github.com/you/project");
  const remote = getProjectRemote(repo);
  assert.equal(remote, "git@github.com:you/project.git");
}

// getGitContext reads branch, HEAD, dirty state.
{
  const ctx = getGitContext(repo);
  assert.equal(ctx.branch, "main");
  assert.ok(ctx.headCommit && ctx.headCommit.length >= 7);
  assert.equal(ctx.dirty, false);
  // stage a change → dirty becomes true
  writeFileSync(join(repo, "README.md"), "# changed\n");
  const dirty = getGitContext(repo);
  assert.equal(dirty.dirty, true);
  assert.equal(dirty.headCommit, ctx.headCommit); // unchanged HEAD
}

// Fallback to first non-origin remote when origin is absent.
const repo2 = join(base, "project2");
mkdirSync(repo2, { recursive: true });
git(["init", "-b", "main"], repo2);
git(["config", "user.name", "Test"], repo2);
git(["config", "user.email", "test@example.invalid"], repo2);
writeFileSync(join(repo2, "f.txt"), "x");
git(["add", "f.txt"], repo2);
git(["commit", "-m", "init"], repo2);
git(["remote", "add", "upstream", "https://github.com/you/upstream.git"], repo2);
assert.equal(getProjectRemote(repo2), "https://github.com/you/upstream.git");

rmSync(base, { recursive: true, force: true });
console.log("git module test passed");
