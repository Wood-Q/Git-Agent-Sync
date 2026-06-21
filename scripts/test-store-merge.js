import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const cli = join(repoRoot, "bin", "git-agent-sync.js");
const base = realpathSync(mkdtempSync(join(tmpdir(), "agent-sync-store-merge-")));
const projectRemote = join(base, "project.git");
const storeRemote = join(base, "store.git");
const machineA = join(base, "machine-a");
const machineB = join(base, "machine-b");
const projectName = "agent-sync-merge-project";
const projectA = join(machineA, projectName);
const projectB = join(machineB, projectName);
const codexA = join(base, "codex-a");
const codexB = join(base, "codex-b");
const claudeA = join(base, "claude-a");
const claudeB = join(base, "claude-b");

mkdirSync(machineA, { recursive: true });
mkdirSync(machineB, { recursive: true });
mkdirSync(projectA, { recursive: true });
mkdirSync(codexA, { recursive: true });
mkdirSync(codexB, { recursive: true });
mkdirSync(claudeA, { recursive: true });
mkdirSync(claudeB, { recursive: true });

run("git", ["init", "--bare", "-b", "main", projectRemote], base);
run("git", ["init", "--bare", "-b", "main", storeRemote], base);
run("git", ["init", "-b", "main"], projectA);
run("git", ["config", "user.name", "Agent Sync Test"], projectA);
run("git", ["config", "user.email", "test@example.invalid"], projectA);
run("git", ["remote", "add", "origin", projectRemote], projectA);
writeFileSync(join(projectA, "README.md"), "# merge test\n");
run("git", ["add", "README.md"], projectA);
run("git", ["commit", "-m", "initial"], projectA);
run("git", ["push", "-u", "origin", "main"], projectA);

run("git", ["clone", projectRemote, projectB], machineB);
run("git", ["config", "user.name", "Agent Sync Test"], projectB);
run("git", ["config", "user.email", "test@example.invalid"], projectB);
const currentCommit = run("git", ["rev-parse", "HEAD"], projectA);

agent(projectA, codexA, claudeA, ["init", "--remote", storeRemote]);
writeCodexSession(codexA, "session-base", projectA, projectRemote, currentCommit, "Base sidecar work");
const basePushA = agent(projectA, codexA, claudeA, ["push", "--privacy", "allow", "--m", "sync base"]);
assert.match(basePushA, /pushed sidecar repo/);
agent(projectB, codexB, claudeB, ["init", "--remote", storeRemote]);

writeCodexSession(codexB, "session-b", projectB, projectRemote, currentCommit, "B local sidecar work");
const configPathB = join(projectB, ".agent-sync", "config.json");
const configB = JSON.parse(readFileSync(configPathB, "utf8"));
writeFileSync(configPathB, JSON.stringify({ ...configB, remote: null }, null, 2));
const offlinePushB = agent(projectB, codexB, claudeB, ["push", "--privacy", "allow", "--m", "sync B offline"]);
assert.match(offlinePushB, /committed 1 matched session file/);
assert.equal(run("git", ["status", "--porcelain"], join(projectB, ".agent-sync-store")), "");

writeCodexSession(codexA, "session-a", projectA, projectRemote, currentCommit, "A remote sidecar work");
const pushA = agent(projectA, codexA, claudeA, ["push", "--privacy", "allow", "--m", "sync A remote"]);
assert.match(pushA, /pushed sidecar repo/);

writeFileSync(configPathB, JSON.stringify(configB, null, 2));
const pushB = agent(projectB, codexB, claudeB, ["push", "--privacy", "allow", "--m", "sync B after remote"]);
assert.match(pushB, /rebuilt event indexes/);
assert.match(pushB, /pushed sidecar repo/);

const logB = JSON.parse(agent(projectB, codexB, claudeB, ["log", "--json"]));
assert.equal(logB.some((binding) => binding.sessionId === "session-a"), true);
assert.equal(logB.some((binding) => binding.sessionId === "session-b"), true);
assert.equal(run("git", ["rev-parse", "HEAD"], join(projectB, ".agent-sync-store")), run("git", ["rev-parse", "origin/main"], join(projectB, ".agent-sync-store")));

const projectConfigB = JSON.parse(readFileSync(configPathB, "utf8"));
const eventIndexPath = join(projectB, ".agent-sync-store", "projects", projectConfigB.projectId, "bindings.events.idx.json");
assert.equal(existsSync(eventIndexPath), true);
const eventIndex = JSON.parse(readFileSync(eventIndexPath, "utf8"));
assert.equal(eventIndex.bindings.some((binding) => binding.sessionId === "session-a"), true);
assert.equal(eventIndex.bindings.some((binding) => binding.sessionId === "session-b"), true);

console.log("store merge retry test passed");

function writeCodexSession(root, sessionId, projectRoot, remote, commit, message) {
  const dir = join(root, "2026", "06", "20");
  mkdirSync(dir, { recursive: true });
  writeJsonl(join(dir, `${sessionId}.jsonl`), [
    {
      type: "session_meta",
      payload: {
        id: sessionId,
        cwd: projectRoot,
        model_provider: "openai",
        thread_name: message,
        git: {
          branch: "main",
          commit_hash: commit,
          repository_url: remote
        }
      }
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: message
      }
    }
  ]);
}

function writeJsonl(path, items) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${items.map((item) => JSON.stringify(item)).join("\n")}\n`);
}

function agent(cwd, codexRoot, claudeRoot, args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_SYNC_CODEX_DIR: codexRoot,
      AGENT_SYNC_CLAUDE_DIR: claudeRoot,
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

function run(command, args, cwd, options = {}) {
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
  if (result.status !== 0 && !options.allowFail) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}
