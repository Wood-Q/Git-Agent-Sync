import assert from "node:assert/strict";
import { join } from "node:path";
import {
  adaptClaudeSessionContent,
  extractClaudeSessionMetadata,
  getClaudeContentProjectMatch,
  getClaudeRestoreRelativePath,
  isClaudeSessionContentForProject
} from "../src/claude-session.js";

const projectRoot = "/Users/test/workspace/MokioAgent";
const config = {
  projectIdentity: "git:github.com/wood-q/mokioagent",
  projectName: "MokioAgent",
  projectRoot
};

const content = makeClaudeSession({
  sessionId: "claude-session",
  cwd: "C:\\Users\\woodq\\FullStack\\MokioAgent",
  gitRemote: "https://github.com/Wood-Q/MokioAgent.git",
  title: "Fix Claude session restore",
  timestamp: "2026-05-23T02:14:00.000Z"
});

const metadata = extractClaudeSessionMetadata(content);
assert.equal(metadata.sessionId, "claude-session");
assert.equal(metadata.title, "Fix Claude session restore");
assert.equal(metadata.conversationAt, "2026-05-23T02:14:00.000Z");
assert.equal(metadata.projectRoots[0], "C:/Users/woodq/FullStack/MokioAgent");
assert.equal(metadata.workdirs.includes("C:/Users/woodq/FullStack/MokioAgent"), true);
assert.equal(metadata.gitContexts[0].repositoryUrl, "https://github.com/Wood-Q/MokioAgent.git");
assert.equal(isClaudeSessionContentForProject(content, config), true);

const adapted = adaptClaudeSessionContent(content, config);
assert.equal(adapted.adapted, true);
const adaptedLines = parseJsonl(adapted.content);
assert.equal(adaptedLines[0].cwd, projectRoot);
assert.equal(adaptedLines[1].message.content[0].input.cwd, projectRoot);
assert.equal(adaptedLines[1].message.content[0].input.command, `ls ${projectRoot}/src`);
assert.equal(adaptedLines[0].agentSyncAdapted.projectRoot, projectRoot);

const foreign = makeClaudeSession({
  sessionId: "foreign-claude",
  cwd: "/Users/woodq/FullStack/Agent-Sync",
  gitRemote: "https://github.com/Wood-Q/Agent-Sync.git",
  title: "This mentions MokioAgent in body",
  timestamp: "2026-05-23T02:14:00.000Z"
});
const foreignMatch = getClaudeContentProjectMatch(foreign, config);
assert.equal(foreignMatch.matched, false);
assert.equal(foreignMatch.reason, "claude:foreign-git");

const mixed = [
  ...parseJsonl(content),
  {
    type: "assistant",
    cwd: projectRoot,
    sessionId: "mixed-claude",
    gitRemote: "https://github.com/Wood-Q/MokioAgent.git",
    message: {
      role: "assistant",
      content: [{
        type: "tool_use",
        name: "Bash",
        input: {
          command: "pwd",
          cwd: "/Users/woodq/FullStack/Agent-Sync"
        }
      }]
    }
  }
].map((line) => JSON.stringify(line)).join("\n") + "\n";
const mixedMatch = getClaudeContentProjectMatch(mixed, config);
assert.equal(mixedMatch.matched, false);
assert.equal(mixedMatch.reason, "claude:mixed-cwd");

const unstructured = `${JSON.stringify({
  type: "user",
  sessionId: "unstructured",
  message: {
    role: "user",
    content: `Please work on MokioAgent from this transcript body only.`
  }
})}\n`;
const unstructuredMatch = getClaudeContentProjectMatch(unstructured, config);
assert.equal(unstructuredMatch.matched, false);
assert.equal(unstructuredMatch.reason, "claude:missing-project-metadata");

const relative = getClaudeRestoreRelativePath("-Users-woodq-FullStack-MokioAgent/claude-session.jsonl", {
  projectRoot: join("/home/test/workspace", "MokioAgent")
});
assert.equal(relative, "-home-test-workspace-MokioAgent/claude-session.jsonl");

console.log("claude session test passed");

function makeClaudeSession({ sessionId, cwd, gitRemote, title, timestamp }) {
  return [
    {
      type: "user",
      cwd,
      sessionId,
      gitBranch: "main",
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
      gitBranch: "main",
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
  ].map((line) => JSON.stringify(line)).join("\n") + "\n";
}

function parseJsonl(value) {
  return value.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
