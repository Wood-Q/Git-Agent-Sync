import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanSessions } from "../src/agents.js";
import { getCodexArchiveInfo } from "../src/codex-archive.js";
import { SCAN_CACHE_FILE } from "../src/constants.js";

const base = mkdtempSync(join(tmpdir(), "agent-sync-scan-cache-"));
const project = join(base, "MokioAgent");
const codexRoot = join(base, "codex", "sessions");
const claudeRoot = join(base, "claude", "projects");
mkdirSync(project, { recursive: true });
mkdirSync(join(codexRoot, "2026", "05", "21"), { recursive: true });
mkdirSync(join(claudeRoot, "-tmp-MokioAgent"), { recursive: true });
mkdirSync(join(claudeRoot, "-tmp-Agent-Sync"), { recursive: true });

process.env.AGENT_SYNC_CODEX_DIR = codexRoot;
process.env.AGENT_SYNC_CLAUDE_DIR = claudeRoot;

const config = {
  projectId: "MokioAgent-cache-test",
  projectIdentity: "name:MokioAgent",
  projectName: "MokioAgent",
  projectRoot: project
};

const sessionPath = join(codexRoot, "2026", "05", "21", "session.jsonl");
const claudePath = join(claudeRoot, "-tmp-MokioAgent", "claude-session.jsonl");
const foreignClaudePath = join(claudeRoot, "-tmp-Agent-Sync", "foreign-claude.jsonl");
writeFileSync(sessionPath, makeSession("first"));
writeFileSync(claudePath, makeClaudeSession("first", project));
writeFileSync(foreignClaudePath, makeClaudeSession("foreign", "/tmp/Agent-Sync", "This mentions MokioAgent but is foreign."));

const first = scanSessions(project, config, getCodexArchiveInfo(codexRoot, { gitRoot: project }));
assert.equal(first.candidates, 3);
assert.equal(first.agents.codex.candidates, 1);
assert.equal(first.agents.claude.candidates, 2);
assert.equal(first.matches.length, 2);
assert.equal(first.matches.some((match) => match.agent === "codex"), true);
assert.equal(first.matches.some((match) => match.agent === "claude"), true);
assert.equal(first.cache.refreshed, 3);
assert.equal(first.cache.cached, 0);

const second = scanSessions(project, config, getCodexArchiveInfo(codexRoot, { gitRoot: project }));
assert.equal(second.matches.length, 2);
assert.equal(second.cache.refreshed, 0);
assert.equal(second.cache.cached, 3);
assert.equal(second.cache.skipped, 3);

writeFileSync(sessionPath, makeSession("second-with-new-content"));
const third = scanSessions(project, config, getCodexArchiveInfo(codexRoot, { gitRoot: project }));
assert.equal(third.matches.length, 2);
assert.equal(third.cache.refreshed, 1);
assert.equal(third.cache.cached, 2);
const thirdCodex = third.matches.find((match) => match.agent === "codex");
const secondCodex = second.matches.find((match) => match.agent === "codex");
assert.notEqual(thirdCodex.sha256, secondCodex.sha256);

const scanCache = JSON.parse(readFileSync(join(project, SCAN_CACHE_FILE), "utf8"));
assert.equal(Object.keys(scanCache.files).length, 3);
assert.equal(scanCache.files[sessionPath.replaceAll("\\", "/")].matched, true);
assert.equal(scanCache.files[claudePath.replaceAll("\\", "/")].matched, true);
assert.equal(scanCache.files[foreignClaudePath.replaceAll("\\", "/")].matched, false);

console.log("scan cache test passed");

function makeSession(marker) {
  return [
    {
      type: "session_meta",
      payload: {
        id: `cache-${marker}`,
        cwd: project,
        git: {
          commit_hash: marker,
          branch: "main",
          repository_url: null
        }
      }
    },
    { type: "turn_context", payload: { cwd: project } }
  ].map((item) => JSON.stringify(item)).join("\n") + "\n";
}

function makeClaudeSession(marker, cwd, title = `Fix ${marker} Claude session`) {
  return [
    {
      type: "user",
      sessionId: `claude-${marker}`,
      cwd,
      gitBranch: "main",
      timestamp: "2026-05-25T01:00:00.000Z",
      message: {
        role: "user",
        content: title
      }
    },
    {
      type: "assistant",
      sessionId: `claude-${marker}`,
      cwd,
      gitBranch: "main",
      timestamp: "2026-05-25T01:01:00.000Z",
      message: {
        role: "assistant",
        content: [{
          type: "tool_use",
          name: "Bash",
          input: {
            command: "pwd",
            cwd
          }
        }]
      }
    }
  ].map((item) => JSON.stringify(item)).join("\n") + "\n";
}
