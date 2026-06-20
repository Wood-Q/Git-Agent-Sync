import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertSessionToIr, exportIrReadable } from "../dist/conversation-ir.js";

const repoRoot = process.cwd();
const cli = join(repoRoot, "bin", "git-agent-sync.js");

const codex = makeJsonl([
  {
    type: "session_meta",
    payload: {
      id: "codex-session",
      cwd: "/repo/app",
      model_provider: "openai",
      thread_name: "Debug login",
      git: {
        branch: "main",
        commit_hash: "abc123",
        repository_url: "https://github.com/example/app.git"
      }
    }
  },
  {
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: "Run tests"
    }
  },
  {
    type: "response_item",
    payload: {
      type: "function_call",
      call_id: "call-1",
      name: "exec_command",
      arguments: JSON.stringify({ cmd: "npm test", workdir: "/repo/app" })
    }
  },
  {
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: "call-1",
      output: "ok"
    }
  }
]);

const codexIr = convertSessionToIr("codex", codex, {
  bundleId: "codex-bundle",
  sourcePath: "/store/codex.jsonl",
  projectIdentity: "git:https://github.com/example/app"
});
assert.equal(codexIr.conversation.id, "codex-session");
assert.equal(codexIr.runtime.provider, "openai");
assert.equal(codexIr.events[0].type, "message");
assert.equal(codexIr.events[1].type, "tool_call");
assert.equal(codexIr.events[1].name, "exec_command");
assert.equal(codexIr.events[1].workdir, "/repo/app");
assert.equal(codexIr.events[2].type, "tool_result");
assert.equal(codexIr.vendor.raw.length, 4);

const claude = makeJsonl([
  {
    type: "assistant",
    sessionId: "claude-session",
    cwd: "/repo/app",
    timestamp: "2026-06-20T10:00:00.000Z",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "I will inspect it." },
        { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "npm test", cwd: "/repo/app" } }
      ]
    }
  },
  {
    type: "user",
    sessionId: "claude-session",
    cwd: "/repo/app",
    timestamp: "2026-06-20T10:01:00.000Z",
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tool-1", content: "ok" }
      ]
    }
  }
]);

const claudeIr = convertSessionToIr("claude", claude, {
  bundleId: "claude-bundle",
  sourcePath: "/store/claude.jsonl"
});
assert.equal(claudeIr.conversation.id, "claude-session");
assert.equal(claudeIr.events[0].type, "message");
assert.equal(claudeIr.events[1].type, "tool_call");
assert.equal(claudeIr.events[1].name, "Bash");
assert.equal(claudeIr.events[1].workdir, "/repo/app");
assert.equal(claudeIr.events[2].type, "tool_result");

const exported = exportIrReadable(claudeIr, { to: "codex", mode: "readable" });
assert.match(exported, /agent_sync_ir_export/);
assert.match(exported, /tool_call/);
assert.match(exported, /Bash/);
const requestedResumable = JSON.parse(exportIrReadable(claudeIr, { to: "codex", mode: "resumable" }).split(/\r?\n/)[0]);
assert.equal(requestedResumable.requestedMode, "resumable");
assert.equal(requestedResumable.mode, "readable");
assert.equal(requestedResumable.resumable, false);
assert.match(requestedResumable.readableOnlyReason, /not supported/);

const cliBase = realpathSync(mkdtempSync(join(tmpdir(), "agent-sync-ir-cli-")));
const cliProject = join(cliBase, "project");
const cliStore = join(cliProject, ".agent-sync-store");
const cliProjectId = "ir-project";
const cliBundleId = "codex-ir-bundle";
const cliSessionPath = join(cliStore, "projects", cliProjectId, "codex", `${cliBundleId}.jsonl`);
mkdirSync(join(cliProject, ".agent-sync"), { recursive: true });
mkdirSync(join(cliStore, "projects", cliProjectId, "codex"), { recursive: true });
run("git", ["init", "-b", "main"], cliProject);
writeFileSync(join(cliProject, ".agent-sync", "config.json"), JSON.stringify({
  version: 1,
  projectId: cliProjectId,
  projectIdentity: "git:github.com/example/ir-project",
  projectName: "project",
  storePath: cliStore,
  agents: ["codex", "claude"],
  createdAt: "2026-06-20T00:00:00.000Z"
}, null, 2));
writeFileSync(cliSessionPath, codex);
writeFileSync(join(cliStore, "projects", cliProjectId, "bindings.jsonl"), `${JSON.stringify({
  version: 2,
  syncRunId: "run-ir",
  syncedAt: "2026-06-20T00:00:00.000Z",
  boundAt: "2026-06-20T00:00:00.000Z",
  projectId: cliProjectId,
  projectIdentity: "git:github.com/example/ir-project",
  projectBranch: "main",
  projectCommit: "abc123",
  projectBaseCommit: "abc123",
  projectDirty: false,
  bundleId: cliBundleId,
  agent: "codex",
  sessionId: "codex-session",
  title: "Debug login",
  conversationAt: "2026-06-20T00:00:00.000Z",
  sha256: "sha256-test",
  storeRelativePath: `projects/${cliProjectId}/codex/${cliBundleId}.jsonl`,
  originalPath: "/codex/session.jsonl",
  agentRelativePath: "session.jsonl"
})}\n`);

const inspectOut = runCli(cliProject, ["tool", "inspect", "--session", cliBundleId]);
assert.match(inspectOut, /bundle: codex-ir-bundle/);
assert.match(inspectOut, /agent:  codex/);
assert.match(inspectOut, /events: 3/);

const converted = JSON.parse(runCli(cliProject, ["tool", "convert", "--session", cliBundleId, "--to", "ir"]));
assert.equal(converted.conversation.id, "codex-session");
assert.equal(converted.project.identity, "git:github.com/example/ir-project");
assert.equal(converted.events.some((event) => event.type === "tool_call" && event.name === "exec_command"), true);

const exportedCli = runCli(cliProject, ["tool", "export", "--session", cliBundleId, "--to", "claude", "--mode", "readable"]);
const exportedLines = exportedCli.trim().split(/\r?\n/).map((line) => JSON.parse(line));
assert.equal(exportedLines[0].type, "agent_sync_ir_export");
assert.equal(exportedLines[0].target, "claude");
assert.equal(exportedLines.some((line) => line.type === "tool_call" && line.name === "exec_command"), true);
const requestedResumableCli = runCli(cliProject, ["tool", "export", "--session", cliBundleId, "--to", "claude", "--mode", "resumable"]);
const requestedResumableHeader = JSON.parse(requestedResumableCli.trim().split(/\r?\n/)[0]);
assert.equal(requestedResumableHeader.requestedMode, "resumable");
assert.equal(requestedResumableHeader.mode, "readable");
assert.equal(requestedResumableHeader.resumable, false);
assert.match(requestedResumableHeader.readableOnlyReason, /not supported/);

console.log("conversation IR test passed");

function makeJsonl(items) {
  return `${items.map((item) => JSON.stringify(item)).join("\n")}\n`;
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

function runCli(cwd, args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_SYNC_CODEX_DIR: join(cwd, ".codex"),
      AGENT_SYNC_CLAUDE_DIR: join(cwd, ".claude")
    }
  });
  if (result.status !== 0) {
    throw new Error(`git-agent-sync ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}
