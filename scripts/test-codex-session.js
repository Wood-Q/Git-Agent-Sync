import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  adaptCodexSessionContent,
  cleanCodexTitle,
  extractCodexSessionMetadata,
  applyCodexThreadMetadata,
  getCodexContentProjectMatch,
  getCodexProjectMatch,
  isCodexSessionContentForProject,
  getCodexThreadArchiveInfo,
  loadCodexThreadIndex,
  loadCodexSessionTitles,
  registerRestoredCodexSession
} from "../dist/codex-session.js";

const targetRoot = "/tmp/test/workspace/SampleAgent";
const localShell = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : process.env.SHELL || "/bin/sh";

for (const fixture of [
  {
    name: "windows",
    root: "C:\\Users\\example\\FullStack\\SampleAgent",
    shell: "powershell.exe",
    cmd: "Get-ChildItem C:\\Users\\example\\FullStack\\SampleAgent\\src"
  },
  {
    name: "linux",
    root: "/home/example/FullStack/SampleAgent",
    shell: "bash",
    cmd: "ls /home/example/FullStack/SampleAgent/src"
  },
  {
    name: "macos",
    root: "/tmp/example/FullStack/SampleAgent",
    shell: "zsh",
    cmd: "ls /tmp/example/FullStack/SampleAgent/src"
  }
]) {
  const content = makeSession(fixture);
  const metadata = extractCodexSessionMetadata(content);
  assert.equal(metadata.sessionId, `${fixture.name}-session`);
  assert.equal(metadata.title, `Fix ${fixture.name} session`);
  assert.equal(metadata.projectRoots[0], fixture.root.replaceAll("\\", "/"));
  assert.equal(metadata.workdirs[0], fixture.root.replaceAll("\\", "/"));
  assert.equal(metadata.gitContexts[0].commit, `${fixture.name}-commit`);

  const result = adaptCodexSessionContent(content, {
    projectName: "SampleAgent",
    projectRoot: targetRoot
  });
  assert.equal(result.adapted, true);
  const lines = parseJsonl(result.content);
  const execLine = lines.find((line) => line.payload?.type === "function_call");
  const outputLine = lines.find((line) => line.payload?.type === "function_call_output");
  const args = JSON.parse(execLine.payload.arguments);
  assert.equal(lines[0].payload.cwd, targetRoot);
  assert.equal(lines[1].payload.cwd, targetRoot);
  assert.equal(args.workdir, targetRoot);
  assert.equal(args.cmd.endsWith(`${targetRoot}/src`), true);
  assert.equal(outputLine.payload.output.endsWith(`${targetRoot}/src/index.js`), true);
  assert.equal(outputLine.edited_files[0], `${targetRoot}/src/index.js`);
  assert.equal(outputLine.payload.encrypted_content, `keep ${fixture.root}\\secret.txt`);
  assert.ok(lines[0].payload.agentSyncAdapted);

  const shouldChangeShell = process.platform === "win32" ? fixture.name !== "windows" : fixture.name === "windows";
  assert.equal(args.shell, shouldChangeShell ? localShell : fixture.shell);
}

const mokioConfig = {
  projectIdentity: "git:github.com/example-org/sampleagent",
  projectName: "SampleAgent",
  projectRoot: targetRoot
};
const agentSyncContent = makeSession({
  name: "agent-sync",
  root: "/tmp/example/FullStack/Agent-Sync",
  shell: "zsh",
  cmd: "echo discussing SampleAgent from Agent-Sync"
}).replace("https://example.com/agent-sync/SampleAgent.git", "https://github.com/example-org/Agent-Sync.git");
const foreignMatch = getCodexContentProjectMatch(agentSyncContent, mokioConfig);
assert.equal(foreignMatch.matched, false);
assert.equal(foreignMatch.reason, "codex:foreign-git");
assert.equal(isCodexSessionContentForProject(agentSyncContent, mokioConfig), false);

const mixedContent = makeSession({
  name: "mixed",
  root: targetRoot,
  shell: "zsh",
  cmd: "ls /tmp/example/FullStack/Agent-Sync"
}).replace("https://example.com/mixed/SampleAgent.git", "https://github.com/example-org/SampleAgent.git");
const mixedLines = parseJsonl(mixedContent);
mixedLines.push({
  type: "response_item",
  payload: {
    type: "function_call",
    name: "exec_command",
    arguments: JSON.stringify({
      cmd: "pwd",
      workdir: "/tmp/example/FullStack/Agent-Sync",
      shell: "zsh"
    })
  }
});
const mixedMatch = getCodexContentProjectMatch(`${mixedLines.map((line) => JSON.stringify(line)).join("\n")}\n`, mokioConfig);
assert.equal(mixedMatch.matched, false);
assert.equal(mixedMatch.reason, "codex:mixed-cwd");

const unstructuredContent = `${JSON.stringify({
  type: "response_item",
  payload: {
    type: "message",
    role: "user",
    content: "This mentions SampleAgent but has no Codex project metadata."
  }
})}\n`;
const unstructuredMatch = getCodexContentProjectMatch(unstructuredContent, mokioConfig);
assert.equal(unstructuredMatch.matched, false);
assert.equal(unstructuredMatch.reason, "codex:missing-project-metadata");

const codexHome = mkdtempSync(join(tmpdir(), "agent-sync-codex-home-"));
writeFileSync(join(codexHome, "session_index.jsonl"), `${JSON.stringify({
  id: "index-session",
  thread_name: "Index title"
})}\n`);
const statePath = join(codexHome, "state_5.sqlite");
{
  const db = new Database(statePath);
  db.exec(`create table threads (
    id text primary key,
    rollout_path text not null,
    title text not null,
    preview text not null,
    first_user_message text not null,
    cwd text not null,
    git_sha text,
    git_branch text,
    git_origin_url text,
    archived integer not null default 0,
    archived_at integer
)`);
  const insert = db.prepare("insert into threads values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  insert.run("state-session", "/tmp/state-session.jsonl", "State title", "Preview fallback", "First fallback", "/tmp/SampleAgent", "state-sha", "main", "https://github.com/example-org/SampleAgent.git", 0, null);
  insert.run("preview-session", "/tmp/preview-session.jsonl", "", "Preview title", "First fallback", "/tmp/SampleAgent", null, null, null, 0, null);
  insert.run("first-session", "/tmp/first-session.jsonl", "", "", "Traceback (most recent call last):\\nFile \"bad.py\"\\n修改一下报错", "/tmp/SampleAgent", null, null, null, 0, null);
  insert.run("state-wins-session", "/tmp/state-wins-session.jsonl", "State wins", "Index should not overwrite", "First fallback", "/tmp/SampleAgent", null, null, null, 0, null);
  insert.run("foreign-state-session", "/tmp/foreign-state-session.jsonl", "Foreign state", "", "", "/tmp/Agent-Sync", "foreign-sha", "main", "https://github.com/example-org/Agent-Sync.git", 0, null);
  insert.run("archived-session", "/tmp/archived-session.jsonl", "Archived", "", "", "/tmp/SampleAgent", null, null, null, 1, 123);
  db.close();
}
writeFileSync(join(codexHome, "session_index.jsonl"), `${JSON.stringify({
  id: "state-wins-session",
  thread_name: "Index should not overwrite"
})}\n${readFileSync(join(codexHome, "session_index.jsonl"), "utf8")}`);
const titles = loadCodexSessionTitles(codexHome);
assert.equal(titles.get("state-session"), "State title");
assert.equal(titles.get("preview-session"), "Preview title");
assert.equal(titles.get("first-session"), "修改一下报错");
assert.equal(titles.get("state-wins-session"), "State wins");
assert.equal(titles.get("index-session"), "Index title");

const threadIndex = loadCodexThreadIndex(codexHome);
const stateThread = threadIndex.byId.get("state-session");
assert.equal(stateThread.title, "State title");
assert.equal(stateThread.cwd, "/tmp/SampleAgent");
assert.equal(stateThread.gitSha, "state-sha");
assert.equal(stateThread.gitOriginUrl, "https://github.com/example-org/SampleAgent.git");
const archiveInfo = getCodexThreadArchiveInfo(codexHome);
assert.equal(archiveInfo.status, "ok");
assert.deepEqual(archiveInfo.paths, ["/tmp/archived-session.jsonl"]);

const foreignStateMetadata = extractCodexSessionMetadata(makeSession({
  name: "foreign-state",
  root: targetRoot,
  shell: "zsh",
  cmd: "pwd"
}));
foreignStateMetadata.sessionId = "foreign-state-session";
applyCodexThreadMetadata(foreignStateMetadata, threadIndex.byId.get("foreign-state-session"));
const stateMatch = getCodexProjectMatch(foreignStateMetadata, mokioConfig);
assert.equal(stateMatch.matched, false);
assert.equal(stateMatch.reason, "codex:foreign-git");

const fallbackMetadata = extractCodexSessionMetadata([
  {
    type: "session_meta",
    payload: {
      id: "jsonl-fallback-session",
      cwd: targetRoot,
      thread_name: "<environment_context><cwd>/tmp</cwd></environment_context>"
    }
  },
  {
    type: "event_msg",
    payload: {
      type: "thread_name_updated",
      thread_name: "Updated JSONL title"
    }
  },
  {
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: "First user fallback title"
    }
  }
].map((line) => JSON.stringify(line)).join("\n"));
assert.equal(fallbackMetadata.title, "Updated JSONL title");
assert.equal(cleanCodexTitle("</environment_context>"), null);

const restoreHome = mkdtempSync(join(tmpdir(), "agent-sync-codex-restore-"));
const restoreTarget = join(restoreHome, "sessions", "2026", "05", "21", "restore.jsonl");
const restoreContent = makeSession({
  name: "restore",
  root: targetRoot,
  shell: "zsh",
  cmd: "pwd"
});
const restoreConfig = {
  projectRoot: targetRoot,
  projectName: "SampleAgent",
  projectIdentity: "name:SampleAgent"
};
const restoreRegister = registerRestoredCodexSession(restoreContent, restoreTarget, restoreConfig, {
  bundleId: "codex-restore",
  title: "Restored title"
}, join(restoreHome, "sessions"));
assert.equal(restoreRegister.registered, true);
const registeredThread = readCodexThread(restoreHome, "restore-session");
assert.equal(registeredThread.rollout_path, restoreTarget.replaceAll("\\", "/"));
assert.equal(registeredThread.cwd, targetRoot);
assert.equal(registeredThread.title, "Restored title");
assert.equal(registeredThread.archived, 0);
assert.match(readFileSync(join(restoreHome, "session_index.jsonl"), "utf8"), /Restored title/);

const minimalHome = mkdtempSync(join(tmpdir(), "agent-sync-codex-minimal-"));
const minimalState = join(minimalHome, "state_5.sqlite");
{
  const db = new Database(minimalState);
  db.exec("create table threads (id text primary key, rollout_path text not null, title text not null)");
  db.close();
}
const minimalRegister = registerRestoredCodexSession(restoreContent, join(minimalHome, "sessions", "restore.jsonl"), restoreConfig, {}, join(minimalHome, "sessions"));
assert.equal(minimalRegister.registered, true);
const minimalThread = readCodexThread(minimalHome, "restore-session");
assert.equal(minimalThread.title, "Fix restore session");

console.log("codex session path adaptation test passed");

function makeSession({ name, root, shell, cmd }) {
  return [
    {
      type: "session_meta",
      payload: {
        id: `${name}-session`,
        cwd: root,
        git: {
          commit_hash: `${name}-commit`,
          branch: name,
          repository_url: `https://example.com/${name}/SampleAgent.git`
        }
      }
    },
    { type: "turn_context", payload: { cwd: root } },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: `<environment_context><cwd>${root}</cwd></environment_context>`
      }
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: `Fix ${name} session`
      }
    },
    {
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({ cmd, workdir: root, shell })
      }
    },
    {
      type: "response_item",
      payload: {
        type: "function_call_output",
        output: `opened ${root}\\src\\index.js`,
        encrypted_content: `keep ${root}\\secret.txt`
      },
      edited_files: [`${root}\\src\\index.js`]
    }
  ].map((line) => JSON.stringify(line)).join("\n") + "\n";
}

function parseJsonl(content) {
  return content.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function readCodexThread(codexHome, id) {
  const db = new Database(join(codexHome, "state_5.sqlite"), { readonly: true, fileMustExist: true });
  try {
    return db.prepare("select * from threads where id = ?").get(id) || {};
  } finally {
    db.close();
  }
}
