import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { normalizePath } from "./utils.js";

export function getGitRoot() {
  const result = runGit(["rev-parse", "--show-toplevel"], process.cwd(), { allowFail: true });
  if (result.status !== 0) {
    throw new Error("not inside a Git repository");
  }
  return normalizePath(result.stdout.trim());
}

export function getProjectIdentity(gitRoot) {
  const remote = getProjectRemote(gitRoot);
  if (remote) {
    return `git:${normalizeRemoteUrl(remote)}`;
  }
  return `name:${basename(gitRoot)}`;
}

export function getProjectRemote(gitRoot) {
  const origin = runGit(["config", "--get", "remote.origin.url"], gitRoot, { allowFail: true });
  if (origin.status === 0 && origin.stdout.trim()) {
    return origin.stdout.trim();
  }
  const remotes = runGit(["remote"], gitRoot, { allowFail: true });
  if (remotes.status !== 0) {
    return null;
  }
  const firstRemote = remotes.stdout.split(/\r?\n/).find(Boolean);
  if (!firstRemote) {
    return null;
  }
  const url = runGit(["config", "--get", `remote.${firstRemote}.url`], gitRoot, { allowFail: true });
  return url.status === 0 && url.stdout.trim() ? url.stdout.trim() : null;
}

export function getGitContext(gitRoot) {
  const headCommit = getHeadCommit(gitRoot);
  return {
    branch: getCurrentBranch(gitRoot),
    headCommit,
    baseCommit: headCommit,
    dirty: isWorktreeDirty(gitRoot)
  };
}

export function getGitValue(args, cwd) {
  const result = runGit(args, cwd, { allowFail: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

function getCurrentBranch(gitRoot) {
  const result = runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], gitRoot, { allowFail: true });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

function getHeadCommit(gitRoot) {
  const result = runGit(["rev-parse", "HEAD"], gitRoot, { allowFail: true });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error("cannot read HEAD commit; commit the project at least once before syncing bindings");
  }
  return result.stdout.trim();
}

function isWorktreeDirty(gitRoot) {
  const result = runGit(["status", "--porcelain"], gitRoot, { allowFail: true });
  return result.status === 0 && Boolean(result.stdout.trim());
}

export function normalizeRemoteUrl(remote) {
  const value = remote.trim();
  if (!value) {
    return "";
  }
  let normalized = value.replace(/^git\+/, "").replace(/\.git$/i, "");
  const ssh = normalized.match(/^git@([^:]+):(.+)$/);
  if (ssh) {
    normalized = `https://${ssh[1]}/${ssh[2]}`;
  }
  normalized = normalized.replace(/^ssh:\/\/git@([^/]+)\//, "https://$1/");
  normalized = normalized.replace(/^https?:\/\//i, "").toLowerCase();
  return normalized;
}

export function runGit(args, cwd, options: { allowFail?: boolean } = {}) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0 && !options.allowFail) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result;
}
