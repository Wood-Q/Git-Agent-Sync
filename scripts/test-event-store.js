import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rebuildEventIndexes, readSessionEvents, writeEventStoreSnapshot } from "../dist/event-store.js";

const base = mkdtempSync(join(tmpdir(), "agent-sync-event-store-"));
const storePath = join(base, "store");
const projectRoot = join(base, "project");
const sourcePath = join(base, "codex-session.jsonl");
mkdirSync(storePath, { recursive: true });
mkdirSync(projectRoot, { recursive: true });

const content = [
  JSON.stringify({
    type: "session_meta",
    payload: {
      id: "session-current",
      cwd: projectRoot,
      model_provider: "openai"
    }
  }),
  JSON.stringify({ type: "turn_context", payload: { cwd: projectRoot } })
].join("\n") + "\n";
writeFileSync(sourcePath, content);

const config = {
  projectId: "Project-1234567890",
  projectIdentity: "git:https://github.com/example/project",
  projectName: "Project",
  projectRoot,
  storePath,
  legacyProjectIds: []
};
const gitContext = {
  branch: "main",
  headCommit: "abcdef1234567890",
  baseCommit: "abcdef1234567890",
  dirty: false
};
const match = {
  agent: "codex",
  bundleId: "codex-1234567890",
  originalPath: sourcePath,
  agentRelativePath: "2026/06/20/codex-session.jsonl",
  storeRelativePath: "projects/Project-1234567890/codex/codex-1234567890.jsonl",
  sha256: sha256(content),
  matchedBy: ["cwd"],
  metadata: {
    sessionId: "session-current",
    title: "Continue project work",
    conversationAt: "2026-06-20T10:00:00.000Z"
  },
  dependencies: {
    version: 1,
    skills: [{ agent: "codex", name: "review" }]
  }
};

const result = writeEventStoreSnapshot(config, [match], gitContext, "2026-06-20T10:30:00.000Z:abcdef1234567890", {
  message: "sync project sessions",
  authorName: "Agent Sync Test",
  authorEmail: "test@example.invalid"
});

assert.equal(result.eventsWritten, 1);
assert.equal(result.objectsWritten, 1);
assert.match(result.eventPath, /^events\/machine-/);
assert.equal(existsSync(join(storePath, "objects", "codex", "sha256", `${sha256(content)}.jsonl`)), true);

const events = readSessionEvents(config);
assert.equal(events.length, 1);
assert.equal(events[0].project.id, config.projectId);
assert.equal(events[0].session.bundleId, match.bundleId);
assert.equal(events[0].object.sha256, sha256(content));
assert.equal(events[0].commit.message, "sync project sessions");

const manifestPath = join(storePath, "projects", config.projectId, "manifest.events.json");
const bindingsIndexPath = join(storePath, "projects", config.projectId, "bindings.events.idx.json");
assert.equal(existsSync(manifestPath), true);
assert.equal(existsSync(bindingsIndexPath), true);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert.equal(manifest.generatedFrom, "events");
assert.equal(manifest.matches.length, 1);
assert.equal(manifest.matches[0].objectRelativePath, `objects/codex/sha256/${sha256(content)}.jsonl`);
assert.deepEqual(manifest.dependencies.skills.map((skill) => `${skill.agent}:${skill.name}`), ["codex:review"]);

const bindingsIndex = JSON.parse(readFileSync(bindingsIndexPath, "utf8"));
assert.equal(bindingsIndex.generatedFrom, "events");
assert.equal(bindingsIndex.total, 1);
assert.equal(bindingsIndex.bindings[0].projectCommit, gitContext.headCommit);
assert.equal(bindingsIndex.bindings[0].storeRelativePath, match.storeRelativePath);
assert.equal(bindingsIndex.bindings[0].objectRelativePath, `objects/codex/sha256/${sha256(content)}.jsonl`);

rmSync(manifestPath);
rmSync(bindingsIndexPath);
const rebuilt = rebuildEventIndexes(config);
assert.equal(rebuilt.events, 1);
assert.equal(existsSync(manifestPath), true);
assert.equal(existsSync(bindingsIndexPath), true);

const second = writeEventStoreSnapshot(config, [match], gitContext, "2026-06-20T10:31:00.000Z:abcdef1234567890", {
  message: "sync project sessions again"
});
assert.equal(second.objectsWritten, 0);
assert.equal(second.objectsReused, 1);
assert.equal(readSessionEvents(config).length, 2);

const forkContent = [
  JSON.stringify({
    type: "session_meta",
    payload: {
      id: "session-current",
      cwd: projectRoot,
      model_provider: "openrouter"
    }
  }),
  JSON.stringify({ type: "turn_context", payload: { cwd: projectRoot } }),
  JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: "forked" } })
].join("\n") + "\n";
const forkPath = join(base, "codex-session-fork.jsonl");
writeFileSync(forkPath, forkContent);
const forkMatch = {
  ...match,
  bundleId: "codex-fork-1234567890",
  originalPath: forkPath,
  storeRelativePath: "projects/Project-1234567890/codex/codex-fork-1234567890.jsonl",
  sha256: sha256(forkContent)
};
const fork = writeEventStoreSnapshot(config, [forkMatch], gitContext, "2026-06-20T10:32:00.000Z:abcdef1234567890", {
  message: "sync forked project session"
});
assert.equal(fork.objectsWritten, 1);
assert.equal(fork.indexes.conflicts, 1);
assert.equal(fork.indexes.conflictPaths.length, 1);
assert.equal(existsSync(join(storePath, "objects", "codex", "sha256", `${sha256(forkContent)}.jsonl`)), true);
const conflict = JSON.parse(readFileSync(join(storePath, fork.indexes.conflictPaths[0]), "utf8"));
assert.equal(conflict.type, "session-object-conflict");
assert.equal(conflict.agent, "codex");
assert.equal(conflict.sessionId, "session-current");
assert.deepEqual(conflict.objectHashes.sort(), [sha256(content), sha256(forkContent)].sort());
const conflictManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert.equal(conflictManifest.conflicts, 1);
assert.deepEqual(conflictManifest.conflictPaths, fork.indexes.conflictPaths);

console.log("event store test passed");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
