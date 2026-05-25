import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectBindings, queryBindings, writeBindings } from "../src/bindings.js";

const dir = mkdtempSync(join(tmpdir(), "agent-sync-bindings-"));
const config = { storePath: dir, projectId: "project" };
const projectDir = join(dir, "projects", config.projectId);
mkdirSync(projectDir, { recursive: true });

writeFileSync(join(projectDir, "bindings.jsonl"), [
  JSON.stringify({
    version: 2,
    syncRunId: "run-1",
    syncedAt: "2026-05-24T00:00:00.000Z",
    bundleId: "codex-1",
    agent: "codex",
    storeRelativePath: "projects/project/codex/codex-1.jsonl",
    projectCommit: "abc123",
    projectBranch: "main"
  }),
  "{not-json",
  JSON.stringify({ bundleId: "missing-required-fields" })
].join("\n") + "\n");

const summary = inspectBindings(config);
assert.equal(summary.exists, true);
assert.equal(summary.valid, 1);
assert.equal(summary.invalid, 2);
assert.equal(summary.bindings[0].projectCommit, "abc123");
assert.equal(summary.bindings[0].projectBaseCommit, "abc123");

const matches = queryBindings(config, { type: "commit", value: "abc" }, process.cwd());
assert.equal(matches.length, 1);
assert.equal(matches[0].bundleId, "codex-1");

const latest = queryBindings(config, { type: "latest" }, process.cwd());
assert.equal(latest.length, 1);
assert.equal(latest[0].bundleId, "codex-1");

const before = readFileSync(join(projectDir, "bindings.jsonl"), "utf8");
const added = writeBindings(config, [{
  agent: "codex",
  bundleId: "codex-2",
  sha256: "def456",
  storeRelativePath: "projects/project/codex/codex-2.jsonl",
  originalPath: "~/.codex/sessions/2.jsonl",
  agentRelativePath: "2.jsonl",
  modifiedAt: "2026-05-25T01:00:00.000Z",
  metadata: {
    sessionId: "session-2",
    title: "second",
    conversationAt: "2026-05-25T02:00:00.000Z"
  }
}, {
  agent: "claude",
  bundleId: "claude-1",
  sha256: "fed654",
  storeRelativePath: "projects/project/claude/claude-1.jsonl",
  originalPath: "~/.claude/projects/-tmp-project/claude-1.jsonl",
  agentRelativePath: "-tmp-project/claude-1.jsonl",
  modifiedAt: "2026-05-25T03:00:00.000Z",
  metadata: {
    sessionId: "claude-session-1",
    title: "claude session",
    conversationAt: "2026-05-25T04:00:00.000Z"
  }
}], {
  branch: "main",
  headCommit: "def456",
  baseCommit: "def456",
  dirty: false
}, "run-2", {
  message: "feat: add user login API",
  authorName: "Agent Sync Test",
  authorEmail: "test@example.invalid"
});

assert.equal(added, 2);
const after = readFileSync(join(projectDir, "bindings.jsonl"), "utf8");
assert.equal(after.startsWith(before), true);
assert.equal(existsSync(join(projectDir, "bindings.idx.json")), true);

const indexedLatest = queryBindings(config, { type: "latest" }, process.cwd());
assert.equal(indexedLatest.length, 2);
assert.deepEqual(indexedLatest.map((item) => item.bundleId), ["claude-1", "codex-2"]);
assert.equal(indexedLatest[0].agent, "claude");
assert.equal(indexedLatest[0].commitMessage, "feat: add user login API");
assert.equal(indexedLatest[0].authorName, "Agent Sync Test");
assert.equal(indexedLatest[0].authorEmail, "test@example.invalid");
assert.equal(indexedLatest[0].conversationAt, "2026-05-25T04:00:00.000Z");

const indexedCommit = queryBindings(config, { type: "commit", value: "def" }, process.cwd());
assert.equal(indexedCommit.length, 2);
assert.equal(indexedCommit.some((item) => item.agent === "claude" && item.bundleId === "claude-1"), true);

console.log("bindings v2 test passed");
