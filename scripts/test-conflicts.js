import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rebuildEventIndexes, writeEventStoreSnapshot } from "../dist/event-store.js";
import { diffConflict, listConflicts, resolveConflict, showConflict } from "../dist/conflicts.js";

const repoRoot = process.cwd();
const cli = join(repoRoot, "bin", "git-agent-sync.js");
const base = mkdtempSync(join(tmpdir(), "agent-sync-conflicts-"));
const storePath = join(base, "store");
const projectRoot = join(base, "project");
const sourcePath = join(base, "codex-session.jsonl");
const forkPath = join(base, "codex-session-fork.jsonl");

mkdirSync(storePath, { recursive: true });
mkdirSync(projectRoot, { recursive: true });
run("git", ["init", "-b", "main"], projectRoot);

const config = {
  version: 1,
  projectId: "Project-1234567890",
  projectIdentity: "git:https://github.com/example/project",
  projectName: "Project",
  projectRoot,
  storePath,
  remote: null,
  legacyProjectIds: []
};
mkdirSync(join(projectRoot, ".agent-sync"), { recursive: true });
writeFileSync(join(projectRoot, ".agent-sync", "config.json"), JSON.stringify(config, null, 2));

const baseContent = writeCodexSession(sourcePath, "session-current", "openai", "base");
const forkContent = writeCodexSession(forkPath, "session-current", "openrouter", "fork");
const gitContext = {
  branch: "main",
  headCommit: "abcdef1234567890",
  baseCommit: "abcdef1234567890",
  dirty: false
};
const match = createMatch("codex-base-1234567890", sourcePath, baseContent);
const forkMatch = createMatch("codex-fork-1234567890", forkPath, forkContent);

writeEventStoreSnapshot(config, [match], gitContext, "2026-06-20T10:00:00.000Z:abcdef1234567890", {
  message: "sync base session"
});
const fork = writeEventStoreSnapshot(config, [forkMatch], gitContext, "2026-06-20T10:01:00.000Z:abcdef1234567890", {
  message: "sync forked session"
});

assert.equal(fork.indexes.conflicts, 1);
assert.equal(listConflicts(config).length, 1);
assert.equal(listConflicts(config, { all: true }).length, 1);

const listed = listConflicts(config)[0];
assert.equal(listed.status, "open");
assert.equal(listed.index, 1);
assert.equal(listed.agent, "codex");
assert.equal(listed.sessionId, "session-current");
assert.equal(listed.objectHashes.length, 2);

const cliList = JSON.parse(agent(["conflicts", "list", "--json"]));
assert.equal(cliList.length, 1);
assert.equal(cliList[0].id, listed.id);
const cliShow = JSON.parse(agent(["conflicts", "show", "1", "--json"]));
assert.equal(cliShow.type, "session-object-conflict");
const diff = diffConflict(config, "1");
assert.equal(diff.objects.length, 2);
assert.equal(diff.objects.some((object) => Object.hasOwn(object, "content")), false);
assert.equal(diff.comparisons.length, 1);
assert.equal(diff.comparisons[0].firstDifferentLine > 0, true);
const cliDiff = JSON.parse(agent(["conflicts", "diff", "1", "--json"]));
assert.equal(cliDiff.objects.length, 2);
assert.equal(cliDiff.comparisons[0].comparable, true);
const cliDryRun = JSON.parse(agent(["conflicts", "resolve", "1", "--strategy", "keep-remote", "--notes", "cli dry-run", "--dry-run", "--json"]));
assert.equal(cliDryRun.dryRun, true);
assert.equal(JSON.parse(readFileSync(join(storePath, listed.relativePath), "utf8")).status, "open");

assert.equal(showConflict(config, "1").id, listed.id);
assert.equal(showConflict(config, listed.id.slice(0, 8)).id, listed.id);

const dryRun = resolveConflict(config, "1", {
  dryRun: true,
  notes: "preview only",
  strategy: "keep-local"
});
assert.equal(dryRun.status, "resolved");
assert.equal(dryRun.dryRun, true);
assert.equal(JSON.parse(readFileSync(join(storePath, listed.relativePath), "utf8")).status, "open");

const resolved = resolveConflict(config, "1", {
  notes: "both objects are intentionally preserved",
  strategy: "keep-all"
});
assert.equal(resolved.status, "resolved");
assert.equal(resolved.resolution.strategy, "keep-all");
assert.equal(resolved.resolution.notes, "both objects are intentionally preserved");
assert.equal(listConflicts(config).length, 0);
assert.equal(listConflicts(config, { all: true }).length, 1);
assert.equal(showConflict(config, resolved.id, { all: true }).status, "resolved");

rebuildEventIndexes(config);
const preserved = showConflict(config, resolved.id, { all: true });
assert.equal(preserved.status, "resolved");
assert.equal(preserved.resolution.strategy, "keep-all");
assert.equal(preserved.objectHashes.length, 2);

console.log("agent-sync conflicts test passed");

function createMatch(bundleId, path, content) {
  return {
    agent: "codex",
    bundleId,
    originalPath: path,
    agentRelativePath: `2026/06/20/${bundleId}.jsonl`,
    storeRelativePath: `projects/${config.projectId}/codex/${bundleId}.jsonl`,
    sha256: sha256(content),
    matchedBy: ["cwd"],
    metadata: {
      sessionId: "session-current",
      title: "Conflict review",
      conversationAt: "2026-06-20T10:00:00.000Z"
    }
  };
}

function writeCodexSession(path, sessionId, provider, message) {
  const content = [
    JSON.stringify({
      type: "session_meta",
      payload: {
        id: sessionId,
        cwd: projectRoot,
        model_provider: provider
      }
    }),
    JSON.stringify({ type: "turn_context", payload: { cwd: projectRoot } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: message } })
  ].join("\n") + "\n";
  writeFileSync(path, content);
  return content;
}

function agent(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Agent Sync Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Agent Sync Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid"
    }
  });
  if (result.status !== 0) {
    throw new Error(`agent-sync ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Agent Sync Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Agent Sync Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid"
    }
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
