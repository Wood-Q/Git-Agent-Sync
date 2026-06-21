import assert from "node:assert/strict";
import { join } from "node:path";
import { homedir } from "node:os";
import { getAgentRoot } from "../dist/agents.js";

// --- getAgentRoot: env override wins -------------------------------------
const savedCodex = process.env.AGENT_SYNC_CODEX_DIR;
const savedClaude = process.env.AGENT_SYNC_CLAUDE_DIR;

try {
  delete process.env.AGENT_SYNC_CODEX_DIR;
  delete process.env.AGENT_SYNC_CLAUDE_DIR;

  // Defaults point at the conventional agent session roots.
  assert.equal(getAgentRoot("codex"), join(homedir(), ".codex", "sessions"));
  assert.equal(getAgentRoot("claude"), join(homedir(), ".claude", "projects"));

  // Env vars override the defaults (used by every test to point at temp dirs).
  process.env.AGENT_SYNC_CODEX_DIR = "/tmp/codex-sessions";
  process.env.AGENT_SYNC_CLAUDE_DIR = "/tmp/claude-projects";
  assert.equal(getAgentRoot("codex"), "/tmp/codex-sessions");
  assert.equal(getAgentRoot("claude"), "/tmp/claude-projects");

  // Unknown agent throws (defensive — callers must pass codex|claude).
  assert.throws(() => getAgentRoot("gemini"), /unsupported agent/);
  assert.throws(() => getAgentRoot(""), /unsupported agent/);
} finally {
  if (savedCodex === undefined) {
    delete process.env.AGENT_SYNC_CODEX_DIR;
  } else {
    process.env.AGENT_SYNC_CODEX_DIR = savedCodex;
  }
  if (savedClaude === undefined) {
    delete process.env.AGENT_SYNC_CLAUDE_DIR;
  } else {
    process.env.AGENT_SYNC_CLAUDE_DIR = savedClaude;
  }
}

console.log("agents root test passed");
