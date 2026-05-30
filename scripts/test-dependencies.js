import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  aggregateDependencies,
  checkSkillDependencies,
  extractSessionDependencies,
  getMissingSkillWarnings,
  normalizeDependencies
} from "../src/dependencies.js";

const base = mkdtempSync(join(tmpdir(), "agent-sync-dependencies-"));
const codexSkills = join(base, "codex-skills");
const claudeSkills = join(base, "claude-skills");
mkdirSync(join(codexSkills, "capacity"), { recursive: true });
mkdirSync(join(claudeSkills, "review"), { recursive: true });

process.env.AGENT_SYNC_CODEX_SKILLS_DIR = codexSkills;
process.env.AGENT_SYNC_CLAUDE_SKILLS_DIR = claudeSkills;

const codex = extractSessionDependencies("codex", makeJsonl([
  {
    type: "session_meta",
    payload: {
      instructions: "<skills_instructions>\n- name: capacity\n- skill: missing-codex\n</skills_instructions>"
    }
  },
  {
    type: "response_item",
    payload: {
      type: "function_call",
      name: "skill",
      arguments: JSON.stringify({ skill: "capacity" })
    }
  }
]));
assert.deepEqual(codex.skills.map((skill) => `${skill.agent}:${skill.name}:${skill.source}`), [
  "codex:capacity:skills_instructions",
  "codex:missing-codex:skills_instructions"
]);

const claude = extractSessionDependencies("claude", makeJsonl([
  {
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        name: "SkillTool",
        input: { name: "review" }
      }]
    }
  },
  {
    type: "user",
    message: {
      content: "<skills_instructions><skill name=\"missing-claude\" /></skills_instructions>"
    }
  }
]));
assert.deepEqual(claude.skills.map((skill) => `${skill.agent}:${skill.name}:${skill.source}`), [
  "claude:review:tool_use",
  "claude:missing-claude:skills_instructions"
]);

const normalized = normalizeDependencies({ skills: [{ name: "Review" }] }, "claude");
assert.deepEqual(normalized.skills.map((skill) => `${skill.agent}:${skill.name}`), ["claude:Review"]);

const aggregated = aggregateDependencies([{ agent: "codex", dependencies: codex }, { agent: "claude", dependencies: claude }]);
assert.deepEqual(aggregated.skills.map((skill) => `${skill.agent}:${skill.name}`), [
  "codex:capacity",
  "codex:missing-codex",
  "claude:review",
  "claude:missing-claude"
]);

const availability = checkSkillDependencies(aggregated);
assert.equal(availability.skills.find((skill) => skill.name === "capacity").available, true);
assert.equal(availability.skills.find((skill) => skill.name === "review").available, true);
assert.equal(availability.skills.find((skill) => skill.name === "missing-codex").available, false);
assert.equal(availability.skills.find((skill) => skill.name === "missing-claude").available, false);

const warnings = getMissingSkillWarnings(aggregated, "bundle-123");
assert.deepEqual(warnings.map((warning) => warning.message), [
  "missing codex skill \"missing-codex\" required by bundle-123",
  "missing claude skill \"missing-claude\" required by bundle-123"
]);

rmSync(base, { recursive: true, force: true });
console.log("dependency metadata test passed");

function makeJsonl(items) {
  return `${items.map((item) => JSON.stringify(item)).join("\n")}\n`;
}
