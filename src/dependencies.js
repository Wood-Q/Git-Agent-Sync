import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { normalizePath } from "./utils.js";

const DEPENDENCIES_VERSION = 1;
const SKILL_TOOL_NAMES = new Set(["skill", "skilltool"]);
const SKILL_NAME_FIELDS = ["skill", "name", "skillName", "skill_name"];

export function extractSessionDependencies(agent, content) {
  const skills = new Map();
  for (const item of readJsonlItems(content)) {
    collectInstructionBlocks(agent, item, skills);
    if (agent === "claude") {
      collectClaudeToolSkills(item, skills);
    } else if (agent === "codex") {
      collectCodexToolSkills(item, skills);
    }
  }
  collectInstructionBlocks(agent, content, skills);
  return {
    version: DEPENDENCIES_VERSION,
    skills: [...skills.values()]
  };
}

export function normalizeDependencies(dependencies, fallbackAgent = null) {
  const skills = new Map();
  for (const skill of dependencies?.skills || []) {
    const agent = normalizeAgent(skill?.agent || fallbackAgent);
    if (!agent) {
      continue;
    }
    addSkill(skills, agent, skill.name, skill.source || "metadata");
  }
  return {
    version: DEPENDENCIES_VERSION,
    skills: [...skills.values()]
  };
}

export function aggregateDependencies(items) {
  const skills = new Map();
  for (const item of items || []) {
    const dependencies = normalizeDependencies(item?.dependencies, item?.agent);
    for (const skill of dependencies.skills) {
      addSkill(skills, skill.agent, skill.name, skill.source);
    }
  }
  return {
    version: DEPENDENCIES_VERSION,
    skills: [...skills.values()]
  };
}

export function checkSkillDependencies(dependencies) {
  const normalized = normalizeDependencies(dependencies);
  const skills = normalized.skills.map((skill) => {
    const availability = checkSkillAvailability(skill.agent, skill.name);
    return {
      ...skill,
      ...availability
    };
  });
  return {
    version: DEPENDENCIES_VERSION,
    skills,
    missing: skills.filter((skill) => !skill.available)
  };
}

export function getMissingSkillWarnings(dependencies, bundleId = null) {
  return checkSkillDependencies(dependencies).missing.map((skill) => ({
    code: "missing-skill",
    agent: skill.agent,
    name: skill.name,
    bundleId,
    message: formatMissingSkillMessage(skill, bundleId)
  }));
}

export function getSkillRoot(agent) {
  if (agent === "claude") {
    return process.env.AGENT_SYNC_CLAUDE_SKILLS_DIR || siblingSkillRoot(process.env.AGENT_SYNC_CLAUDE_DIR, "projects") || join(homedir(), ".claude", "skills");
  }
  if (agent === "codex") {
    return process.env.AGENT_SYNC_CODEX_SKILLS_DIR || siblingSkillRoot(process.env.AGENT_SYNC_CODEX_DIR, "sessions") || join(homedir(), ".codex", "skills");
  }
  return null;
}

function siblingSkillRoot(agentRoot, expectedLeaf) {
  if (!agentRoot) {
    return null;
  }
  const normalized = normalizePath(agentRoot);
  return basename(normalized) === expectedLeaf ? join(dirname(normalized), "skills") : null;
}

function collectClaudeToolSkills(item, skills) {
  const content = item?.message?.content;
  if (!Array.isArray(content)) {
    return;
  }
  for (const entry of content) {
    if (entry?.type === "tool_use" && isSkillToolName(entry.name)) {
      addSkill(skills, "claude", getSkillNameFromObject(entry.input), "tool_use");
    }
  }
}

function collectCodexToolSkills(item, skills) {
  const payload = item?.payload;
  if (item?.type !== "response_item" || payload?.type !== "function_call" || !isSkillToolName(payload.name)) {
    return;
  }
  addSkill(skills, "codex", getSkillNameFromObject(parseJsonObject(payload.arguments)), "function_call");
}

function collectInstructionBlocks(agent, value, skills) {
  if (typeof value === "string") {
    for (const block of extractSkillInstructionBlocks(value)) {
      for (const name of extractStructuredSkillNames(block)) {
        addSkill(skills, agent, name, "skills_instructions");
      }
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectInstructionBlocks(agent, item, skills);
    }
    return;
  }
  for (const child of Object.values(value)) {
    collectInstructionBlocks(agent, child, skills);
  }
}

function extractSkillInstructionBlocks(text) {
  const blocks = [];
  const closedBlock = /<skills_instructions\b[^>]*>([\s\S]*?)<\/skills_instructions>/gi;
  for (const match of text.matchAll(closedBlock)) {
    blocks.push(match[1]);
  }
  if (blocks.length) {
    return blocks;
  }
  const start = text.toLowerCase().indexOf("<skills_instructions");
  if (start < 0) {
    return blocks;
  }
  const tagEnd = text.indexOf(">", start);
  if (tagEnd >= 0) {
    blocks.push(text.slice(tagEnd + 1));
  }
  return blocks;
}

function extractStructuredSkillNames(block) {
  const names = [];
  const attrPattern = /\b(?:name|skill)=["']([^"']+)["']/gi;
  for (const match of block.matchAll(attrPattern)) {
    names.push(match[1]);
  }
  for (const line of block.split(/\r?\n|\\n/)) {
    const match = line.match(/^\s*(?:[-*]\s*)?(?:name|skill)\s*[:=]\s*["']?([^"',<>{}\]\s]+)["']?/i);
    if (match) {
      names.push(match[1]);
    }
  }
  return names;
}

function getSkillNameFromObject(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  for (const field of SKILL_NAME_FIELDS) {
    if (typeof value[field] === "string") {
      return value[field];
    }
  }
  return null;
}

function addSkill(skills, agent, rawName, source) {
  const normalized = normalizeSkillName(rawName);
  const normalizedAgent = normalizeAgent(agent);
  if (!normalized || !normalizedAgent) {
    return;
  }
  const key = `${normalizedAgent}:${normalized.key}`;
  if (skills.has(key)) {
    return;
  }
  skills.set(key, {
    agent: normalizedAgent,
    name: normalized.name,
    key: normalized.key,
    source
  });
}

function normalizeSkillName(value) {
  if (typeof value !== "string") {
    return null;
  }
  const name = value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^\/+/, "")
    .replace(/[),.;:]+$/g, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    return null;
  }
  return {
    name,
    key: name.toLowerCase()
  };
}

function normalizeAgent(agent) {
  return agent === "claude" || agent === "codex" ? agent : null;
}

function isSkillToolName(value) {
  return typeof value === "string" && SKILL_TOOL_NAMES.has(value.toLowerCase());
}

function parseJsonObject(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function checkSkillAvailability(agent, name) {
  const root = getSkillRoot(agent);
  if (!root) {
    return { available: false, root: null, rootMissing: true };
  }
  const normalizedRoot = normalizePath(root);
  if (!existsSync(root)) {
    return { available: false, root: normalizedRoot, rootMissing: true };
  }
  if (existsSync(join(root, name)) || existsSync(join(root, `${name}.md`))) {
    return { available: true, root: normalizedRoot, rootMissing: false };
  }
  const expectedDir = name.toLowerCase();
  const expectedFile = `${expectedDir}.md`;
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const entryName = entry.name.toLowerCase();
      if ((entry.isDirectory() && entryName === expectedDir) || (entry.isFile() && entryName === expectedFile)) {
        return { available: true, root: normalizedRoot, rootMissing: false };
      }
    }
  } catch {
    return { available: false, root: normalizedRoot, rootMissing: true };
  }
  return { available: false, root: normalizedRoot, rootMissing: false };
}

function formatMissingSkillMessage(skill, bundleId) {
  const owner = skill.agent || "agent";
  const requiredBy = bundleId ? ` required by ${bundleId}` : "";
  const rootDetail = skill.rootMissing && skill.root ? ` (skill root missing: ${skill.root})` : "";
  return `missing ${owner} skill "${skill.name}"${requiredBy}${rootDetail}`;
}

function readJsonlItems(content) {
  const items = [];
  for (const line of String(content || "").split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      items.push(JSON.parse(line));
    } catch {
      // Ignore partial transcript lines.
    }
  }
  return items;
}
