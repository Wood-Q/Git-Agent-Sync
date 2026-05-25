import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

const repoRoot = process.cwd();
const cli = join(repoRoot, "bin", "git-agent-sync.js");
const base = realpathSync(mkdtempSync(join(tmpdir(), "agent-sync-e2e-")));
const bareProjectRemote = join(base, "project.git");
const bareStoreRemote = join(base, "store.git");
const machineA = join(base, "machine-a");
const machineBParent = join(base, "machine-b");
const projectName = "agent-sync-e2e-project";
const projectA = join(machineA, projectName);
const projectB = join(machineBParent, projectName);
const codexA = join(base, "codex-a");
const codexB = join(base, "codex-b");
const codexIndex = join(base, "codex-index");
const codexShortIndex = join(base, "codex-short-index");
const codexBranch = join(base, "codex-branch");
const codexCommit = join(base, "codex-commit");
const claudeA = join(base, "claude-a");
const claudeB = join(base, "claude-b");
const windowsRoot = `C:\\Users\\woodq\\FullStack\\${projectName}`;
const pushMessage = "feat: add user login API";
const conversationAtMs = Date.parse("2026-05-23T02:14:00.000Z");
const olderConversationAtMs = Date.parse("2026-05-21T02:14:00.000Z");

mkdirSync(machineA, { recursive: true });
mkdirSync(machineBParent, { recursive: true });
mkdirSync(projectA, { recursive: true });
mkdirSync(codexA, { recursive: true });
mkdirSync(codexB, { recursive: true });
mkdirSync(codexIndex, { recursive: true });
mkdirSync(codexShortIndex, { recursive: true });
mkdirSync(codexBranch, { recursive: true });
mkdirSync(codexCommit, { recursive: true });
mkdirSync(claudeA, { recursive: true });
mkdirSync(claudeB, { recursive: true });
mkdirSync(join(codexA, "archived_sessions"), { recursive: true });
mkdirSync(join(codexA, "2026", "05", "21"), { recursive: true });
mkdirSync(join(codexA, "2026", "05", "20"), { recursive: true });
mkdirSync(join(claudeA, `-Users-woodq-FullStack-${projectName}`), { recursive: true });
mkdirSync(join(claudeA, "-Users-woodq-FullStack-Agent-Sync"), { recursive: true });

run("git", ["init", "--bare", "-b", "main", bareProjectRemote], base);
run("git", ["init", "--bare", "-b", "main", bareStoreRemote], base);
run("git", ["init", "-b", "main"], projectA);
run("git", ["config", "user.name", "Agent Sync Test"], projectA);
run("git", ["config", "user.email", "test@example.invalid"], projectA);
run("git", ["remote", "add", "origin", bareProjectRemote], projectA);
writeFileSync(join(projectA, "README.md"), "# e2e\n");
run("git", ["add", "README.md"], projectA);
run("git", ["commit", "-m", "initial"], projectA);
run("git", ["push", "-u", "origin", "main"], projectA);

agent(projectA, codexA, claudeA, ["init", "--remote", bareStoreRemote]);
run("git", ["add", ".gitignore"], projectA);
run("git", ["commit", "-m", "ignore agent sync files"], projectA);
run("git", ["push"], projectA);
const currentCommit = run("git", ["rev-parse", "HEAD"], projectA);

const sessionPath = join(codexA, "2026", "05", "21", "session.jsonl");
const olderSessionPath = join(codexA, "2026", "05", "20", "older-session.jsonl");
const foreignSessionPath = join(codexA, "2026", "05", "21", "foreign-session.jsonl");
const archivedPath = join(codexA, "archived_sessions", "archived-session.jsonl");
const claudeSessionPath = join(claudeA, `-Users-woodq-FullStack-${projectName}`, "claude-session.jsonl");
const foreignClaudeSessionPath = join(claudeA, "-Users-woodq-FullStack-Agent-Sync", "foreign-claude-session.jsonl");
writeJsonl(sessionPath, [
  {
    type: "session_meta",
    payload: {
      id: "session-current",
      cwd: windowsRoot,
      git: {
        commit_hash: currentCommit,
        branch: "main",
        repository_url: bareProjectRemote
      }
    }
  },
  { type: "turn_context", payload: { cwd: windowsRoot } },
  {
    type: "response_item",
    payload: {
      type: "function_call",
      name: "exec_command",
      arguments: JSON.stringify({
        cmd: `Get-ChildItem ${windowsRoot}\\src`,
        workdir: windowsRoot,
        shell: "powershell.exe"
      })
    }
  }
]);
writeCodexState(codexA, [
  ["session-current", "Continue e2e session", "Preview should not win", "First message should not win", conversationAtMs - 3600000, conversationAtMs],
  ["session-older", "Older e2e session", "Older preview should not win", "Older first message should not win", olderConversationAtMs - 3600000, olderConversationAtMs]
]);
writeJsonl(olderSessionPath, [
  {
    type: "session_meta",
    payload: {
      id: "session-older",
      cwd: windowsRoot,
      git: {
        commit_hash: currentCommit,
        branch: "main",
        repository_url: bareProjectRemote
      }
    }
  },
  { type: "turn_context", payload: { cwd: windowsRoot } }
]);
writeJsonl(foreignSessionPath, [
  {
    type: "session_meta",
    payload: {
      id: "foreign-session",
      cwd: "/Users/woodq/FullStack/Agent-Sync",
      git: {
        commit_hash: "foreign-commit",
        branch: "main",
        repository_url: "https://github.com/Wood-Q/Agent-Sync.git"
      }
    }
  },
  { type: "turn_context", payload: { cwd: "/Users/woodq/FullStack/Agent-Sync" } },
  {
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: `This Agent-Sync session mentions ${projectName} but belongs elsewhere.`
    }
  }
]);
writeJsonl(archivedPath, [
  {
    type: "session_meta",
    payload: {
      id: "archived-session",
      cwd: windowsRoot,
      git: {
        commit_hash: currentCommit,
        branch: "main",
        repository_url: bareProjectRemote
      }
    }
  },
  { type: "turn_context", payload: { cwd: windowsRoot } }
]);
writeJsonl(claudeSessionPath, makeClaudeSession({
  sessionId: "claude-current",
  cwd: windowsRoot,
  gitRemote: bareProjectRemote,
  gitBranch: "main",
  timestamp: "2026-05-23T03:14:00.000Z",
  title: "Continue Claude e2e session"
}));
writeJsonl(foreignClaudeSessionPath, makeClaudeSession({
  sessionId: "foreign-claude",
  cwd: "/Users/woodq/FullStack/Agent-Sync",
  gitRemote: "https://github.com/Wood-Q/Agent-Sync.git",
  gitBranch: "main",
  timestamp: "2026-05-23T03:14:00.000Z",
  title: `This ${projectName} text is not enough for Claude ownership`
}));

const pushOut = agent(projectA, codexA, claudeA, ["push", "--m", pushMessage]);
assert.match(pushOut, /3 matched session file\(s\), 3 new binding\(s\)/);
assert.match(pushOut, /archived removed/);
assert.equal(run("git", ["status", "--porcelain", "--", ".agent-sync-store"], projectA), "");
assert.equal(run("git", ["status", "--porcelain"], projectA), "");
assert.equal(run("git", ["ls-files", ".agent-sync-store"], projectA), "");
assert.equal(run("git", ["grep", "-n", "foreign-session", "HEAD", "--", "projects"], join(projectA, ".agent-sync-store"), { allowFail: true }), "");
assert.equal(run("git", ["log", "-1", "--pretty=%s"], join(projectA, ".agent-sync-store")), pushMessage);
assert.equal(run("git", ["log", "-1", "--pretty=%an <%ae>"], join(projectA, ".agent-sync-store")), "Agent Sync Test <test@example.invalid>");
const projectConfigA = JSON.parse(readFileSync(join(projectA, ".agent-sync", "config.json"), "utf8"));
seedForeignCurrentProjectEntry(base, bareStoreRemote, projectConfigA.projectId);
seedForeignStoreProject(base, bareStoreRemote);

run("git", ["clone", bareProjectRemote, projectB], machineBParent);
agent(projectB, codexB, claudeB, ["init", "--remote", bareStoreRemote]);
const pullOut = agent(projectB, codexB, claudeB, ["pull"]);
assert.match(pullOut, /pruned 1 foreign project file\(s\), 1 binding\(s\), and 1 manifest entry/);
assert.match(pullOut, /3 session file\(s\) available for restore/);
const sparseConfig = run("git", ["config", "--get", "core.sparseCheckout"], join(projectB, ".agent-sync-store"));
const sparsePatterns = readFileSync(join(projectB, ".agent-sync-store", ".git", "info", "sparse-checkout"), "utf8");
assert.equal(sparseConfig, "true");
assert.match(sparsePatterns, /\/projects\/\*\/manifest\.json/);
assert.match(sparsePatterns, /\/projects\/agent-sync-e2e-project-/i);
assert.equal(existsSync(join(projectB, ".agent-sync-store", "projects", "ForeignProject-deadbeef00", "manifest.json")), true);
assert.equal(existsSync(join(projectB, ".agent-sync-store", "projects", "ForeignProject-deadbeef00", "codex", "codex-foreign.jsonl")), false);
assert.equal(existsSync(join(projectB, ".agent-sync-store", "projects", "ForeignProject-deadbeef00", "claude", "claude-foreign.jsonl")), false);
const projectConfigB = JSON.parse(readFileSync(join(projectB, ".agent-sync", "config.json"), "utf8"));
assert.equal(existsSync(join(projectB, ".agent-sync-store", "projects", projectConfigB.projectId, "claude", "claude-current-foreign.jsonl")), false);

const byLatest = JSON.parse(agent(projectB, codexB, claudeB, ["log", "--latest", "--json"]));
const byCurrent = JSON.parse(agent(projectB, codexB, claudeB, ["log", "--current", "--json"]));
const byBranch = JSON.parse(agent(projectB, codexB, claudeB, ["log", "--branch", "main", "--json"]));
const byCommit = JSON.parse(agent(projectB, codexB, claudeB, ["log", "--commit", currentCommit.slice(0, 8), "--json"]));
assert.equal(byLatest.length, 3);
assert.equal(byCurrent.length, 3);
assert.equal(byBranch.length, 3);
assert.equal(byCommit.length, 3);
assert.equal(existsSync(join(projectB, ".agent-sync-store", "projects", byCurrent[0].projectId, "bindings.idx.json")), true);
assert.equal(byCurrent[0].title, "Continue Claude e2e session");
assert.equal(byCurrent[0].agent, "claude");
assert.equal(byCurrent[1].title, "Continue e2e session");
assert.equal(byCurrent[2].title, "Older e2e session");
assert.equal(byCurrent[0].projectCommit, currentCommit);
assert.equal(byCurrent[0].commitMessage, pushMessage);
assert.equal(byCurrent[0].authorName, "Agent Sync Test");
assert.equal(byCurrent[0].authorEmail, "test@example.invalid");
assert.equal(byCurrent[0].conversationAt, "2026-05-23T03:14:00.000Z");
assert.equal(byCurrent[1].conversationAt, new Date(conversationAtMs).toISOString());
assert.equal(byCurrent[2].conversationAt, new Date(olderConversationAtMs).toISOString());
assert.match(readFileSync(join(projectB, ".agent-sync-store", byCurrent[1].storeRelativePath), "utf8"), /session-current/);
assert.match(readFileSync(join(projectB, ".agent-sync-store", byCurrent[0].storeRelativePath), "utf8"), /claude-current/);

const defaultLogOut = agent(projectB, codexB, claudeB, ["log"]);
assert.match(defaultLogOut, /Index: 1/);
assert.match(defaultLogOut, /Title: Continue Claude e2e session/);
assert.match(defaultLogOut, /Author: Agent Sync Test <test@example.invalid>/);
assert.match(defaultLogOut, /Date:\s+Sat May 23 10:14:00 2026 \+0800/);
assert.match(defaultLogOut, new RegExp(`\\s{4}${pushMessage}`));
assert.match(defaultLogOut, /restore:\s+git agent-sync restore --index <index>/);
assert.match(defaultLogOut, /Restore: git agent-sync restore --index 1/);
assert.match(defaultLogOut, /Index: 2/);
assert.match(defaultLogOut, /Title: Continue e2e session/);
assert.match(defaultLogOut, /Index: 3/);
assert.match(defaultLogOut, /Title: Older e2e session/);
const onelineOut = agent(projectB, codexB, claudeB, ["log", "--oneline"]);
assert.deepEqual(onelineOut.split(/\r?\n/), [
  `1  Continue Claude e2e session  ${pushMessage}`,
  `2  Continue e2e session  ${pushMessage}`,
  `3  Older e2e session  ${pushMessage}`
]);
assert.doesNotMatch(onelineOut, /bindings:/);
assert.match(agent(projectB, codexB, claudeB, ["log", "-n", "1"]), /Title: Continue Claude e2e session/);
assert.doesNotMatch(agent(projectB, codexB, claudeB, ["log", "-n", "1"]), /Title: Older e2e session/);
assert.equal(agent(projectB, codexB, claudeB, ["log", "-1", "--oneline"]), `1  Continue Claude e2e session  ${pushMessage}`);
assert.equal(agent(projectB, codexB, claudeB, ["log", "--max-count=1", "--oneline"]), `1  Continue Claude e2e session  ${pushMessage}`);
assert.equal(agent(projectB, codexB, claudeB, ["log", "--branch", "main", "-1", "--oneline"]), `1  Continue Claude e2e session  ${pushMessage}`);
const limitedJson = JSON.parse(agent(projectB, codexB, claudeB, ["log", "--json", "-1"]));
assert.equal(limitedJson.length, 1);
assert.equal(limitedJson[0].title, "Continue Claude e2e session");
const badLogCount = agentResult(projectB, codexB, claudeB, ["log", "-n", "0"]);
assert.notEqual(badLogCount.status, 0);
assert.match(badLogCount.stderr, /log count must be a positive number/);
const allJson = JSON.parse(agent(projectB, codexB, claudeB, ["log", "--json"]));
assert.equal(allJson.length, 3);
assert.equal(allJson[0].bundleId, byCurrent[0].bundleId);

const logOut = agent(projectB, codexB, claudeB, ["log", "--current"]);
assert.match(logOut, /Index: 1/);
assert.match(logOut, /Title: Continue Claude e2e session/);
assert.match(logOut, new RegExp(`\\s{4}${pushMessage}`));
assert.match(logOut, /restore:\s+git agent-sync restore --current <index>/);
assert.match(logOut, /show:\s+git agent-sync show --current <index>/);

const showOut = agent(projectB, codexB, claudeB, ["show", "--latest", "1"]);
assert.match(showOut, /title:\s+Continue Claude e2e session/);
assert.match(showOut, new RegExp(`project commit:\\s+${currentCommit}`));
assert.match(agent(projectB, codexB, claudeB, ["show", byCurrent[0].bundleId]), /bundle:/);

const restoreOut = agent(projectB, codexB, claudeB, ["restore", "--current"]);
assert.match(restoreOut, /restored claude:/);
assert.match(restoreOut, /registered claude session: claude-current/);
assert.match(restoreOut, /restored codex:/);
assert.match(restoreOut, /registered codex thread: session-current/);
assert.match(agent(projectB, codexB, claudeB, ["restore", "--latest", "1"]), /restored claude:/);
assert.match(agent(projectB, codexB, claudeB, ["restore", "--current", "2"]), /restored codex:/);
assert.match(agent(projectB, codexIndex, claudeB, ["restore", "--index", "2"]), /restored codex:/);
assert.match(agent(projectB, codexShortIndex, claudeB, ["restore", "--i", "2"]), /restored codex:/);
const badIndex = agentResult(projectB, codexB, claudeB, ["restore", "--index", "3"]);
assert.equal(badIndex.status, 0);
const outOfRange = agentResult(projectB, codexB, claudeB, ["restore", "--index", "4"]);
assert.notEqual(outOfRange.status, 0);
assert.match(outOfRange.stderr, /restore index 4 is out of range for log \(3 binding\(s\)\)/);
assert.match(agent(projectB, codexBranch, claudeB, ["restore", "--branch", "main"]), /restored codex:/);
assert.match(agent(projectB, codexCommit, claudeB, ["restore", "--commit", currentCommit.slice(0, 8)]), /restored codex:/);
const restored = parseJsonl(readFileSync(join(codexB, "2026", "05", "21", "session.jsonl"), "utf8"));
const args = JSON.parse(restored[2].payload.arguments);
assert.equal(restored[0].payload.cwd, projectB);
assert.equal(restored[1].payload.cwd, projectB);
assert.equal(args.workdir, projectB);
assert.equal(args.shell, process.env.SHELL || "/bin/sh");
assert.equal(args.cmd, `Get-ChildItem ${projectB}/src`);
assert.ok(restored[0].payload.agentSyncAdapted);
const restoredThread = readCodexThread(codexB, "session-current");
assert.equal(restoredThread.rollout_path, join(codexB, "2026", "05", "21", "session.jsonl").replaceAll("\\", "/"));
assert.equal(restoredThread.cwd, projectB);
assert.equal(restoredThread.title, "Continue e2e session");
assert.equal(restoredThread.git_sha, currentCommit);
assert.equal(restoredThread.git_branch, "main");
assert.equal(restoredThread.git_origin_url, bareProjectRemote);
assert.equal(restoredThread.archived, 0);
assert.equal(readCodexThreadCount(codexB, "session-current"), 1);
assert.match(readFileSync(join(codexB, "session_index.jsonl"), "utf8"), /Continue e2e session/);
const restoredClaudePath = join(claudeB, `-${projectB.replaceAll("\\", "/").slice(1).replaceAll("/", "-")}`, "claude-session.jsonl");
assert.equal(existsSync(restoredClaudePath), true);
const restoredClaude = parseJsonl(readFileSync(restoredClaudePath, "utf8"));
assert.equal(restoredClaude[0].cwd, projectB);
assert.equal(restoredClaude[1].message.content[0].input.cwd, projectB);
assert.equal(restoredClaude[1].message.content[0].input.command, `ls ${projectB}/src`);
assert.ok(restoredClaude[0].agentSyncAdapted);

const codexNoRegister = join(base, "codex-no-register");
mkdirSync(codexNoRegister, { recursive: true });
assert.match(agent(projectB, codexNoRegister, claudeB, ["restore", "--current", "2", "--no-register"]), /restored codex:/);
assert.equal(existsSync(join(codexNoRegister, "state_5.sqlite")), false);

const legacyCodex = join(base, "codex-legacy");
mkdirSync(legacyCodex, { recursive: true });
const legacyCodexBundle = `${byCurrent[1].bundleId}-legacy`;
const legacyProjectDir = join(projectB, ".agent-sync-store", "projects", byCurrent[1].projectId);
const legacyCodexStoreRelative = `projects/${byCurrent[1].projectId}/codex/${legacyCodexBundle}.jsonl`;
writeFileSync(join(projectB, ".agent-sync-store", legacyCodexStoreRelative), readFileSync(join(projectB, ".agent-sync-store", byCurrent[1].storeRelativePath), "utf8"));
const legacyManifestPath = join(legacyProjectDir, "manifest.json");
const legacyManifest = JSON.parse(readFileSync(legacyManifestPath, "utf8"));
legacyManifest.matches.push({
  ...byCurrent[1],
  bundleId: legacyCodexBundle,
  storeRelativePath: legacyCodexStoreRelative,
  originalPath: "~/.codex/sessions/2026/05/21/session.jsonl",
  agentRelativePath: undefined
});
writeFileSync(legacyManifestPath, `${JSON.stringify(legacyManifest, null, 2)}\n`);
writeFileSync(join(legacyProjectDir, "bindings.jsonl"), `${readFileSync(join(legacyProjectDir, "bindings.jsonl"), "utf8")}${JSON.stringify({
  ...byCurrent[1],
  bundleId: legacyCodexBundle,
  storeRelativePath: legacyCodexStoreRelative,
  originalPath: "~/.codex/sessions/2026/05/21/session.jsonl",
  agentRelativePath: undefined
})}\n`);
assert.match(agent(projectB, legacyCodex, claudeB, ["restore", legacyCodexBundle, "--no-register"]), /restored codex:/);
assert.equal(existsSync(join(legacyCodex, "2026", "05", "21", "session.jsonl")), true);

const doctor = agent(projectB, codexB, claudeB, ["doctor"]);
assert.match(doctor, /ok\s+manifest\s+4 match\(es\)/);
assert.match(doctor, /ok\s+bindings\s+4 valid, 0 invalid/);
assert.match(doctor, /ok\s+store sparse\s+enabled/);
assert.match(doctor, /archived skipped/);

const restoreForeignBundle = "claude-restore-foreign";
const restoreForeignStoreRelative = `projects/${projectConfigB.projectId}/claude/${restoreForeignBundle}.jsonl`;
writeJsonl(join(projectB, ".agent-sync-store", restoreForeignStoreRelative), makeClaudeSession({
  sessionId: "restore-foreign-claude",
  cwd: "/Users/woodq/FullStack/Agent-Sync",
  gitRemote: "https://github.com/Wood-Q/Agent-Sync.git",
  gitBranch: "main",
  timestamp: "2026-05-24T00:00:00.000Z",
  title: `Restore foreign Claude mentions ${projectName}`
}));
const restoreForeignManifest = JSON.parse(readFileSync(join(legacyProjectDir, "manifest.json"), "utf8"));
restoreForeignManifest.matches.push({
  agent: "claude",
  bundleId: restoreForeignBundle,
  storeRelativePath: restoreForeignStoreRelative,
  originalPath: "~/.claude/projects/-Users-woodq-FullStack-Agent-Sync/restore-foreign.jsonl",
  agentRelativePath: "-Users-woodq-FullStack-Agent-Sync/restore-foreign.jsonl"
});
writeFileSync(join(legacyProjectDir, "manifest.json"), `${JSON.stringify(restoreForeignManifest, null, 2)}\n`);
const skippedForeignRestore = agent(projectB, codexB, claudeB, ["restore", restoreForeignBundle]);
assert.match(skippedForeignRestore, /skipped claude:/);
assert.equal(existsSync(join(claudeB, `-${projectB.replaceAll("\\", "/").slice(1).replaceAll("/", "-")}`, "restore-foreign.jsonl")), false);

console.log(JSON.stringify({ base, currentCommit }, null, 2));

function agent(cwd, codexDir, claudeDir, args) {
  return run(process.execPath, [cli, ...args], cwd, agentEnv(codexDir, claudeDir));
}

function agentResult(cwd, codexDir, claudeDir, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, ...agentEnv(codexDir, claudeDir) },
    encoding: "utf8"
  });
}

function agentEnv(codexDir, claudeDir) {
  return {
    AGENT_SYNC_CODEX_DIR: codexDir,
    AGENT_SYNC_CLAUDE_DIR: claudeDir,
    TZ: "Asia/Shanghai"
  };
}

function run(command, args, cwd, env = {}) {
  const options = env && Object.prototype.hasOwnProperty.call(env, "allowFail")
    ? { allowFail: env.allowFail, env: {} }
    : { allowFail: false, env };
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...options.env },
    encoding: "utf8"
  });
  if ((result.error || result.status !== 0) && !options.allowFail) {
    console.error(`FAILED: ${command} ${args.join(" ")}`);
    if (result.error) {
      console.error(result.error.message);
    }
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`command failed: ${command} ${args.join(" ")}`);
  }
  return result.stdout.trim();
}

function writeJsonl(path, items) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${items.map((item) => JSON.stringify(item)).join("\n")}\n`);
}

function makeClaudeSession({ sessionId, cwd, gitRemote, gitBranch, timestamp, title }) {
  return [
    {
      type: "user",
      cwd,
      sessionId,
      gitBranch,
      gitRemote,
      timestamp,
      message: {
        role: "user",
        content: title
      }
    },
    {
      type: "assistant",
      cwd,
      sessionId,
      gitBranch,
      gitRemote,
      timestamp,
      message: {
        role: "assistant",
        content: [{
          type: "tool_use",
          name: "Bash",
          input: {
            command: `ls ${cwd}\\src`,
            cwd
          }
        }]
      }
    }
  ];
}

function seedForeignCurrentProjectEntry(baseDir, remote, projectId) {
  const seed = join(baseDir, "store-seed-current-foreign");
  run("git", ["clone", remote, seed], baseDir);
  run("git", ["config", "user.name", "Agent Sync Test"], seed);
  run("git", ["config", "user.email", "test@example.invalid"], seed);
  const projectDir = join(seed, "projects", projectId);
  const manifestPath = join(projectDir, "manifest.json");
  const bindingsPath = join(projectDir, "bindings.jsonl");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const foreignMatch = {
    agent: "claude",
    bundleId: "claude-current-foreign",
    storeRelativePath: `projects/${projectId}/claude/claude-current-foreign.jsonl`,
    originalPath: "~/.claude/projects/-Users-woodq-FullStack-Agent-Sync/current-foreign.jsonl",
    agentRelativePath: "-Users-woodq-FullStack-Agent-Sync/current-foreign.jsonl"
  };
  manifest.matches.push(foreignMatch);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(bindingsPath, `${readFileSync(bindingsPath, "utf8")}${JSON.stringify({
    version: 2,
    syncRunId: "current-foreign-run",
    syncedAt: "2026-05-22T00:00:00.000Z",
    projectId,
    projectIdentity: "git:current-project-with-foreign-claude",
    projectBranch: "main",
    projectCommit: "current-foreign-commit",
    bundleId: "claude-current-foreign",
    agent: "claude",
    sessionId: "current-foreign-claude",
    title: "Current bundle foreign Claude",
    storeRelativePath: foreignMatch.storeRelativePath,
    originalPath: foreignMatch.originalPath,
    agentRelativePath: foreignMatch.agentRelativePath
  })}\n`);
  writeJsonl(join(projectDir, "claude", "claude-current-foreign.jsonl"), makeClaudeSession({
    sessionId: "current-foreign-claude",
    cwd: "/Users/woodq/FullStack/Agent-Sync",
    gitRemote: "https://github.com/Wood-Q/Agent-Sync.git",
    gitBranch: "main",
    timestamp: "2026-05-22T00:00:00.000Z",
    title: `Foreign Claude mentions ${projectName}`
  }));
  run("git", ["add", `projects/${projectId}`], seed);
  run("git", ["commit", "-m", "seed current project foreign claude"], seed);
  run("git", ["push", "origin", "main"], seed);
}

function seedForeignStoreProject(baseDir, remote) {
  const seed = join(baseDir, "store-seed");
  run("git", ["clone", remote, seed], baseDir);
  run("git", ["config", "user.name", "Agent Sync Test"], seed);
  run("git", ["config", "user.email", "test@example.invalid"], seed);
  const projectDir = join(seed, "projects", "ForeignProject-deadbeef00");
  mkdirSync(join(projectDir, "codex"), { recursive: true });
  mkdirSync(join(projectDir, "claude"), { recursive: true });
  writeFileSync(join(projectDir, "manifest.json"), JSON.stringify({
    projectId: "ForeignProject-deadbeef00",
    projectName: "ForeignProject",
    projectIdentity: "git:example.com/foreign/project",
    matches: [
      {
        agent: "codex",
        bundleId: "codex-foreign",
        storeRelativePath: "projects/ForeignProject-deadbeef00/codex/codex-foreign.jsonl",
        originalPath: "~/.codex/sessions/foreign.jsonl"
      },
      {
        agent: "claude",
        bundleId: "claude-foreign",
        storeRelativePath: "projects/ForeignProject-deadbeef00/claude/claude-foreign.jsonl",
        originalPath: "~/.claude/projects/-tmp-foreign/claude-foreign.jsonl",
        agentRelativePath: "-tmp-foreign/claude-foreign.jsonl"
      }
    ]
  }, null, 2));
  writeFileSync(join(projectDir, "bindings.jsonl"), [
    JSON.stringify({
      version: 2,
      syncRunId: "foreign-run",
      syncedAt: "2026-05-20T00:00:00.000Z",
      projectId: "ForeignProject-deadbeef00",
      projectIdentity: "git:example.com/foreign/project",
      projectBranch: "main",
      projectCommit: "foreign-commit",
      bundleId: "codex-foreign",
      agent: "codex",
      sessionId: "foreign-session",
      title: "Foreign session",
      storeRelativePath: "projects/ForeignProject-deadbeef00/codex/codex-foreign.jsonl",
      originalPath: "~/.codex/sessions/foreign.jsonl"
    }),
    JSON.stringify({
      version: 2,
      syncRunId: "foreign-run",
      syncedAt: "2026-05-20T00:00:00.000Z",
      projectId: "ForeignProject-deadbeef00",
      projectIdentity: "git:example.com/foreign/project",
      projectBranch: "main",
      projectCommit: "foreign-commit",
      bundleId: "claude-foreign",
      agent: "claude",
      sessionId: "foreign-claude-session",
      title: "Foreign Claude session",
      storeRelativePath: "projects/ForeignProject-deadbeef00/claude/claude-foreign.jsonl",
      originalPath: "~/.claude/projects/-tmp-foreign/claude-foreign.jsonl",
      agentRelativePath: "-tmp-foreign/claude-foreign.jsonl"
    })
  ].join("\n") + "\n");
  writeJsonl(join(projectDir, "codex", "codex-foreign.jsonl"), [
    {
      type: "session_meta",
      payload: {
        id: "foreign-session",
        cwd: "/tmp/foreign",
        git: {
          commit_hash: "foreign-commit",
          branch: "main",
          repository_url: "https://example.com/foreign/project.git"
        }
      }
    }
  ]);
  writeJsonl(join(projectDir, "claude", "claude-foreign.jsonl"), makeClaudeSession({
    sessionId: "foreign-claude-session",
    cwd: "/tmp/foreign",
    gitRemote: "https://example.com/foreign/project.git",
    gitBranch: "main",
    timestamp: "2026-05-20T00:00:00.000Z",
    title: "Foreign Claude session"
  }));
  run("git", ["add", "projects/ForeignProject-deadbeef00"], seed);
  run("git", ["commit", "-m", "seed foreign project"], seed);
  run("git", ["push", "origin", "main"], seed);
}

function writeCodexState(codexHome, rows) {
  const db = new Database(join(codexHome, "state_5.sqlite"));
  db.exec("create table threads (id text primary key, title text not null, preview text not null, first_user_message text not null, created_at_ms integer, updated_at_ms integer)");
  const insert = db.prepare("insert into threads values (?, ?, ?, ?, ?, ?)");
  for (const row of rows) {
    insert.run(...row);
  }
  db.close();
}

function readCodexThread(codexHome, id) {
  const db = new Database(join(codexHome, "state_5.sqlite"), { readonly: true, fileMustExist: true });
  try {
    return db.prepare("select * from threads where id = ?").get(id) || {};
  } finally {
    db.close();
  }
}

function readCodexThreadCount(codexHome, id) {
  const db = new Database(join(codexHome, "state_5.sqlite"), { readonly: true, fileMustExist: true });
  try {
    return db.prepare("select count(*) as count from threads where id = ?").get(id).count;
  } finally {
    db.close();
  }
}

function parseJsonl(content) {
  return content.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
