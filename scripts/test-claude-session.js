import assert from "node:assert/strict";
import { join } from "node:path";
import {
  adaptClaudeSessionContent,
  extractClaudeSessionMetadata,
  getClaudeContentProjectMatch,
  getClaudeRestoreRelativePath,
  isClaudeSessionContentForProject
} from "../src/claude-session.js";

const projectRoot = "/tmp/test/workspace/SampleAgent";
const config = {
  projectIdentity: "git:github.com/example-org/sampleagent",
  projectName: "SampleAgent",
  projectRoot
};

const content = makeClaudeSession({
  sessionId: "claude-session",
  cwd: "C:\\Users\\example\\FullStack\\SampleAgent",
  gitRemote: "https://github.com/example-org/SampleAgent.git",
  title: "Fix Claude session restore",
  timestamp: "2026-05-23T02:14:00.000Z"
});

const metadata = extractClaudeSessionMetadata(content);
assert.equal(metadata.sessionId, "claude-session");
assert.equal(metadata.title, "Fix Claude session restore");
assert.equal(metadata.conversationAt, "2026-05-23T02:14:00.000Z");
assert.equal(metadata.projectRoots[0], "C:/Users/example/FullStack/SampleAgent");
assert.equal(metadata.workdirs.includes("C:/Users/example/FullStack/SampleAgent"), true);
assert.equal(metadata.gitContexts[0].repositoryUrl, "https://github.com/example-org/SampleAgent.git");
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
  cwd: "/tmp/example/FullStack/Agent-Sync",
  gitRemote: "https://github.com/example-org/Agent-Sync.git",
  title: "This mentions SampleAgent in body",
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
    gitRemote: "https://github.com/example-org/SampleAgent.git",
    message: {
      role: "assistant",
      content: [{
        type: "tool_use",
        name: "Bash",
        input: {
          command: "pwd",
          cwd: "/tmp/example/FullStack/Agent-Sync"
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
    content: `Please work on SampleAgent from this transcript body only.`
  }
})}\n`;
const unstructuredMatch = getClaudeContentProjectMatch(unstructured, config);
assert.equal(unstructuredMatch.matched, false);
assert.equal(unstructuredMatch.reason, "claude:missing-project-metadata");

const relative = getClaudeRestoreRelativePath("-Users-example-FullStack-SampleAgent/claude-session.jsonl", {
  projectRoot: join("/home/test/workspace", "SampleAgent")
});
assert.equal(relative, "-home-test-workspace-SampleAgent/claude-session.jsonl");

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
