import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerRestoredCodexSession } from "../dist/codex-session.js";
import { checkLocalTransferWatch, runLocalTransfer } from "../dist/local-transfer.js";

const base = mkdtempSync(join(tmpdir(), "agent-sync-local-transfer-"));
const projectRoot = join(base, "project");
const codexHome = join(base, "codex");
const codexRoot = join(codexHome, "sessions");
mkdirSync(projectRoot, { recursive: true });
mkdirSync(codexRoot, { recursive: true });
writeFileSync(join(codexHome, "config.toml"), "model_provider = \"anthropic\"\n");

execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
execFileSync("git", ["config", "user.name", "Agent Sync Test"], { cwd: projectRoot });
execFileSync("git", ["config", "user.email", "agent-sync-test@example.invalid"], { cwd: projectRoot });
writeFileSync(join(projectRoot, "README.md"), "local transfer test\n");
execFileSync("git", ["add", "README.md"], { cwd: projectRoot });
execFileSync("git", ["commit", "-m", "init"], { cwd: projectRoot, stdio: "ignore" });

process.env.AGENT_SYNC_CODEX_DIR = codexRoot;
process.env.AGENT_SYNC_CLAUDE_DIR = join(base, "claude", "projects");

const config = {
  projectId: "project",
  projectName: "Project",
  projectRoot,
  projectIdentity: "name:Project",
  storePath: join(base, "store"),
  agents: ["codex", "claude"]
};

const sourceId = "11111111-1111-4111-8111-111111111111";
const codexSessionDir = join(codexRoot, "2026", "05", "23");
mkdirSync(codexSessionDir, { recursive: true });
const codexSessionPath = join(codexSessionDir, `rollout-2026-05-23T02-14-00-${sourceId}.jsonl`);
writeFileSync(codexSessionPath, makeCodexSession({
  id: sourceId,
  cwd: projectRoot,
  title: "Move Codex work across API providers",
  provider: "openai"
}));
registerRestoredCodexSession(readFileSync(codexSessionPath, "utf8"), codexSessionPath, config, {
  sessionId: sourceId,
  title: "Move Codex work across API providers"
}, codexRoot);

const cloneResult = runLocalTransfer(projectRoot, config, {
  targetProvider: "anthropic"
});
assert.equal(cloneResult.provider, "anthropic");
assert.equal(cloneResult.stats.cloned, 1);
assert.equal(existsSync(cloneResult.results[0].targetPath), true);

const clonedCodex = parseJsonl(readFileSync(cloneResult.results[0].targetPath, "utf8"));
assert.notEqual(clonedCodex[0].payload.id, sourceId);
assert.equal(clonedCodex[0].payload.model_provider, "anthropic");
assert.equal(clonedCodex[0].payload.cloned_from, sourceId);
assert.equal(clonedCodex[0].payload.original_provider, "openai");
assert.equal(clonedCodex[0].payload.agentSyncLocalTransfer.type, "codex-provider-clone");
assert.equal(clonedCodex[1].payload.content, "Move Codex work across API providers");

const cloneAgain = runLocalTransfer(projectRoot, config, {
  targetProvider: "anthropic"
});
assert.equal(cloneAgain.stats.skipped_exists, 1);

writeFileSync(join(codexHome, "config.toml"), "model_provider = \"openrouter\"\n");
const watchEvent = checkLocalTransferWatch(projectRoot, config, {
  once: true
}, "anthropic");
assert.equal(watchEvent.provider, "openrouter");
assert.equal(watchEvent.previousProvider, "anthropic");
assert.equal(watchEvent.changed, true);
assert.equal(watchEvent.result.stats.cloned, 2);

console.log("local transfer test passed");

function makeCodexSession({ id, cwd, title, provider }) {
  return [
    {
      type: "session_meta",
      payload: {
        id,
        cwd,
        timestamp: "2026-05-23T02:14:00.000Z",
        model_provider: provider,
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

function parseJsonl(value) {
  return value.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
