import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkLocalTransferWatch, runLocalTransfer } from "../dist/local-transfer.js";

const base = mkdtempSync(join(tmpdir(), "agent-sync-local-transfer-"));
const projectRoot = join(base, "project");
const codexRoot = join(base, "codex", "sessions");
const claudeRoot = join(base, "claude", "projects");
mkdirSync(projectRoot, { recursive: true });
mkdirSync(codexRoot, { recursive: true });
mkdirSync(claudeRoot, { recursive: true });

execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
execFileSync("git", ["config", "user.name", "Agent Sync Test"], { cwd: projectRoot });
execFileSync("git", ["config", "user.email", "agent-sync-test@example.invalid"], { cwd: projectRoot });
writeFileSync(join(projectRoot, "README.md"), "local transfer test\n");
execFileSync("git", ["add", "README.md"], { cwd: projectRoot });
execFileSync("git", ["commit", "-m", "init"], { cwd: projectRoot, stdio: "ignore" });

process.env.AGENT_SYNC_CODEX_DIR = codexRoot;
process.env.AGENT_SYNC_CLAUDE_DIR = claudeRoot;

const config = {
  projectId: "project",
  projectName: "Project",
  projectRoot,
  projectIdentity: "name:Project",
  storePath: join(base, "store"),
  agents: ["codex", "claude"]
};

const codexSessionPath = join(codexRoot, "source-codex.jsonl");
writeFileSync(codexSessionPath, makeCodexSession({
  id: "codex-source",
  cwd: projectRoot,
  title: "Move Codex work to Claude"
}));

const copyResult = runLocalTransfer(projectRoot, config, {
  mode: "copy",
  from: "codex",
  to: "claude"
});
assert.equal(copyResult.stats.copied, 1);
assert.equal(copyResult.results[0].registered.registered, true);
assert.equal(existsSync(copyResult.results[0].targetPath), true);
const copiedClaude = parseJsonl(readFileSync(copyResult.results[0].targetPath, "utf8"));
assert.equal(copiedClaude[0].sessionId, "codex-source");
assert.equal(copiedClaude[0].message.content, "Move Codex work to Claude");
assert.equal(copiedClaude[0].agentSyncLocalTransfer.from, "codex");

const copyAgain = runLocalTransfer(projectRoot, config, {
  mode: "copy",
  from: "codex",
  to: "claude"
});
assert.equal(copyAgain.stats.skipped_exists, 1);

const watchEvent = checkLocalTransferWatch(projectRoot, config, {
  mode: "copy",
  from: "codex",
  to: "claude",
  once: true
});
assert.equal(watchEvent.changed, false);
assert.equal(watchEvent.result.stats.skipped_exists, 1);

const claudeSessionPath = join(claudeRoot, "-tmp-project", "source-claude.jsonl");
mkdirSync(join(claudeRoot, "-tmp-project"), { recursive: true });
writeFileSync(claudeSessionPath, makeClaudeSession({
  id: "claude-source",
  cwd: projectRoot,
  title: "Move Claude work to Codex"
}));

const cloneResult = runLocalTransfer(projectRoot, config, {
  mode: "clone",
  from: "claude",
  to: "codex"
});
assert.equal(cloneResult.stats.cloned, 1);
assert.equal(existsSync(cloneResult.results[0].targetPath), true);
const clonedCodex = parseJsonl(readFileSync(cloneResult.results[0].targetPath, "utf8"));
assert.notEqual(clonedCodex[0].payload.id, "claude-source");
assert.equal(clonedCodex[0].payload.agentSyncLocalTransfer.mode, "clone");
assert.equal(clonedCodex[2].payload.content, "Move Claude work to Codex");

console.log("local transfer test passed");

function makeCodexSession({ id, cwd, title }) {
  return [
    {
      type: "session_meta",
      payload: {
        id,
        cwd,
        timestamp: "2026-05-23T02:14:00.000Z",
        thread_name: title
      }
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: title
      }
    }
  ].map((line) => JSON.stringify(line)).join("\n") + "\n";
}

function makeClaudeSession({ id, cwd, title }) {
  return [
    {
      type: "user",
      sessionId: id,
      cwd,
      timestamp: "2026-05-23T02:14:00.000Z",
      message: {
        role: "user",
        content: title
      }
    }
  ].map((line) => JSON.stringify(line)).join("\n") + "\n";
}

function parseJsonl(value) {
  return value.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
