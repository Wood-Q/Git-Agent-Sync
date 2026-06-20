import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerRestoredCodexSession } from "../dist/codex-session.js";
import { checkLocalTransferWatch, runLocalRegister, runLocalRepair, runLocalTransfer } from "../dist/local-transfer.js";

const repoRoot = process.cwd();
const cli = join(repoRoot, "bin", "git-agent-sync.js");
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
  version: 1,
  projectId: "project",
  projectName: "Project",
  projectRoot,
  projectIdentity: "name:Project",
  storePath: join(base, "store"),
  agents: ["codex", "claude"]
};
mkdirSync(join(projectRoot, ".agent-sync"), { recursive: true });
writeFileSync(join(projectRoot, ".agent-sync", "config.json"), JSON.stringify(config, null, 2));

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
assert.equal(cloneResult.results[0].registered.registered, true);

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
assert.equal(cloneAgain.results[0].registered.registered, true);

const repairResult = runLocalRepair(projectRoot, config);
assert.equal(repairResult.stats.repaired >= 1, true);
assert.equal(repairResult.results.some((item) => item.registered?.registered), true);

const registerResult = runLocalRegister(projectRoot, config);
assert.equal(registerResult.mode, "register");
assert.equal(registerResult.stats.registered >= 1, true);
assert.equal(registerResult.results.some((item) => item.action === "registered" && item.registered?.registered), true);

const cliRegister = JSON.parse(agent(["register-local", "--json"]));
assert.equal(cliRegister.mode, "register");
assert.equal(cliRegister.stats.registered >= 1, true);
const cliRegisterDryRun = JSON.parse(agent(["register-local", "--dry-run", "--json"]));
assert.equal(cliRegisterDryRun.mode, "register");
assert.equal(cliRegisterDryRun.stats.dry_run >= 1, true);

writeFileSync(join(codexHome, "config.toml"), "model_provider = \"openrouter\"\n");
const watchEvent = checkLocalTransferWatch(projectRoot, config, {
  once: true
}, "anthropic");
assert.equal(watchEvent.provider, "openrouter");
assert.equal(watchEvent.previousProvider, "anthropic");
assert.equal(watchEvent.changed, true);
assert.equal(watchEvent.result.stats.cloned, 2);

const noRegister = runLocalTransfer(projectRoot, config, {
  targetProvider: "localai",
  noRegister: true
});
assert.equal(noRegister.results.some((item) => item.registered?.reason === "disabled"), true);

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

function agent(args) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      AGENT_SYNC_CODEX_DIR: codexRoot,
      AGENT_SYNC_CLAUDE_DIR: join(base, "claude", "projects")
    },
    encoding: "utf8"
  });
}
