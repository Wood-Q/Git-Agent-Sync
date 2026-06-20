import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { BINDINGS_FILE, BINDINGS_INDEX_FILE, SUPPORTED_AGENTS } from "./constants.js";
import { normalizeDependencies } from "./dependencies.js";
import { getGitContext } from "./git.js";
import { readJson, writeJson } from "./utils.js";

const BINDINGS_INDEX_VERSION = 1;
const DEFAULT_AUTHOR_NAME = "agent-sync";
const DEFAULT_AUTHOR_EMAIL = "agent-sync@example.invalid";
type AnyRecord = Record<string, any>;

export function writeBindings(config, matches, gitContext, syncRunId = createSyncRunId(gitContext), commitInfo: AnyRecord = {}) {
  const agentMatches = matches.filter((match) => isSupportedAgent(match.agent));
  if (!agentMatches.length) {
    return 0;
  }

  const existing = readBindings(config);
  const seen = new Set(existing.map(bindingKey));
  const additions = [];
  const syncedAt = new Date().toISOString();

  for (const match of agentMatches) {
    const binding = {
      version: 2,
      syncRunId,
      syncedAt,
      boundAt: syncedAt,
      projectId: config.projectId,
      projectIdentity: config.projectIdentity,
      projectRemote: config.projectIdentity?.startsWith("git:") ? config.projectIdentity.slice("git:".length) : null,
      projectBranch: gitContext.branch,
      projectCommit: gitContext.headCommit,
      projectBaseCommit: gitContext.baseCommit,
      projectDirty: gitContext.dirty,
      bundleId: match.bundleId,
      agent: match.agent,
      sessionId: match.metadata?.sessionId || null,
      title: match.metadata?.title || null,
      conversationAt: match.metadata?.conversationAt || match.modifiedAt || syncedAt,
      commitMessage: commitInfo.message || defaultCommitMessage(config, gitContext),
      authorName: commitInfo.authorName || DEFAULT_AUTHOR_NAME,
      authorEmail: commitInfo.authorEmail || DEFAULT_AUTHOR_EMAIL,
      sha256: match.sha256,
      storeRelativePath: match.storeRelativePath,
      originalPath: match.originalPath,
      agentRelativePath: match.agentRelativePath,
      dependencies: match.dependencies?.skills?.length ? normalizeDependencies(match.dependencies, match.agent) : null
    };
    const key = bindingKey(binding);
    if (!seen.has(key)) {
      seen.add(key);
      additions.push(binding);
    }
  }

  if (!additions.length) {
    return 0;
  }

  const bindingsPath = getBindingsPath(config);
  mkdirSync(dirname(bindingsPath), { recursive: true });
  appendFileSync(bindingsPath, `${additions.map((item) => JSON.stringify(item)).join("\n")}\n`);
  writeBindingsIndex(config, [...existing, ...additions]);
  return additions.length;
}

export function inspectBindings(config) {
  const bindingsPath = getBindingsPath(config);
  const result = {
    path: bindingsPath,
    exists: existsSync(bindingsPath),
    totalLines: 0,
    valid: 0,
    invalid: 0,
    bindings: [],
    errors: []
  };

  if (!result.exists) {
    return result;
  }

  const lines = readFileSync(bindingsPath, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) {
      return;
    }
    result.totalLines += 1;
    let binding;
    try {
      binding = JSON.parse(line);
    } catch (error) {
      result.invalid += 1;
      result.errors.push(`line ${index + 1}: invalid JSON (${error.message})`);
      return;
    }

    const normalized = normalizeBinding(binding);
    if (!normalized) {
      result.invalid += 1;
      result.errors.push(`line ${index + 1}: missing required binding fields`);
      return;
    }

    result.valid += 1;
    result.bindings.push(normalized);
  });

  return result;
}

function readBindings(config) {
  const index = loadBindingsIndex(config);
  if (index) {
    return index.bindings;
  }
  return inspectBindings(config).bindings;
}

export function readAllBindings(config) {
  return dedupeBindings(readBindings(config).filter((binding) => isSupportedAgent(binding.agent)), "all");
}

export function queryBindings(config, selector, gitRoot) {
  const bindings = readBindings(config).filter((binding) => isSupportedAgent(binding.agent));
  if (selector.type === "latest") {
    return dedupeBindings(filterBindingsByLatestSync(bindings), "latest");
  }
  if (selector.type === "current") {
    const context = getGitContext(gitRoot);
    const commitMatches = filterBindingsByCommit(bindings, context.headCommit);
    if (commitMatches.length || !context.branch) {
      return dedupeBindings(commitMatches, "commit");
    }
    return dedupeBindings(filterBindingsByBranch(bindings, context.branch), "branch");
  }
  if (selector.type === "commit") {
    return dedupeBindings(filterBindingsByCommit(bindings, selector.value), "commit");
  }
  if (selector.type === "branch") {
    return dedupeBindings(filterBindingsByBranch(bindings, selector.value), "branch");
  }
  throw new Error(`unsupported selector "${selector.type}"`);
}

export function filterBindings(bindings, filters: AnyRecord = {}, options: AnyRecord = {}) {
  const getTitle = options.getTitle || ((binding) => binding.title || binding.bundleId || "");
  return bindings.filter((binding) => {
    return matchesAgent(binding, filters.agent) &&
      matchesAuthor(binding, filters.author) &&
      matchesBranch(binding, filters.branch) &&
      matchesCommitFilter(binding, filters.commit) &&
      matchesBundle(binding, filters.bundle) &&
      matchesDate(binding, filters.date) &&
      matchesTitle(binding, filters.title, getTitle);
  });
}

function filterBindingsByCommit(bindings, commit) {
  return bindings.filter((binding) => {
    return matchesCommit(binding.projectCommit, commit) ||
      matchesCommit(binding.projectBaseCommit, commit);
  });
}

function filterBindingsByBranch(bindings, branch) {
  return bindings.filter((binding) => matchesBranch(binding, branch));
}

function filterBindingsByLatestSync(bindings) {
  const latest = bindings
    .map((binding) => binding.syncRunId || binding.syncedAt || binding.boundAt || "")
    .filter(Boolean)
    .sort()
    .at(-1);
  if (!latest) {
    return [];
  }
  return bindings.filter((binding) => {
    return binding.syncRunId === latest || (!binding.syncRunId && (binding.syncedAt || binding.boundAt) === latest);
  });
}

function dedupeBindings(bindings, mode) {
  const seen = new Set();
  const result = [];
  const sortedBindings = [...bindings].sort(compareBindingsByConversationTime);
  for (const binding of sortedBindings) {
    const key = mode === "commit"
      ? `${binding.agent}:${binding.sessionId || binding.bundleId}:${binding.projectCommit}:${binding.bundleId}`
      : `${binding.agent}:${binding.sessionId || binding.bundleId}:${binding.bundleId}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(binding);
    }
  }
  return result;
}

function compareBindingsByConversationTime(a, b) {
  const time = String(b.conversationAt || b.syncedAt || b.boundAt || "").localeCompare(String(a.conversationAt || a.syncedAt || a.boundAt || ""));
  return time || a.bundleId.localeCompare(b.bundleId);
}

function matchesCommit(value, query) {
  return Boolean(value && query && value.startsWith(query));
}

function matchesAgent(binding, agent) {
  return !agent || binding.agent === agent;
}

function matchesAuthor(binding, author) {
  if (!author) {
    return true;
  }
  const query = author.toLowerCase();
  return String(binding.authorName || "").toLowerCase().includes(query) ||
    String(binding.authorEmail || "").toLowerCase().includes(query);
}

function matchesBranch(binding, branch) {
  if (!branch) {
    return true;
  }
  const value = binding.projectBranch || "detached";
  return value === branch;
}

function matchesCommitFilter(binding, commit) {
  if (!commit) {
    return true;
  }
  return matchesCommit(binding.projectCommit, commit) ||
    matchesCommit(binding.projectBaseCommit, commit);
}

function matchesBundle(binding, bundle) {
  return !bundle || Boolean(binding.bundleId && binding.bundleId.startsWith(bundle));
}

function matchesDate(binding, date) {
  return !date || formatBindingDate(binding.conversationAt || binding.syncedAt || binding.boundAt) === date;
}

function matchesTitle(binding, title, getTitle) {
  if (!title) {
    return true;
  }
  return String(getTitle(binding) || "").toLowerCase().includes(title.toLowerCase());
}

function formatBindingDate(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return String(value).slice(0, 10);
  }
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function bindingKey(binding) {
  return `${binding.syncRunId || ""}:${binding.bundleId}:${binding.projectCommit || ""}:${binding.projectBranch || ""}`;
}

export function getBindingsPath(config) {
  return join(config.storePath, "projects", config.projectId, BINDINGS_FILE);
}

export function getBindingsIndexPath(config) {
  return join(config.storePath, "projects", config.projectId, BINDINGS_INDEX_FILE);
}

function loadBindingsIndex(config) {
  const indexPath = getBindingsIndexPath(config);
  if (!existsSync(indexPath)) {
    return null;
  }

  try {
    const index = readJson(indexPath);
    if (index.version !== BINDINGS_INDEX_VERSION || !Array.isArray(index.bindings)) {
      return null;
    }
    const source = bindingsSourceSignature(getBindingsPath(config));
    if (!sameBindingsSource(index.source, source)) {
      return null;
    }
    const bindings = index.bindings.map(normalizeBinding).filter(Boolean);
    return {
      bindings
    };
  } catch {
    return null;
  }
}

function writeBindingsIndex(config, bindings) {
  const indexPath = getBindingsIndexPath(config);
  mkdirSync(dirname(indexPath), { recursive: true });
  const normalized = bindings.map(normalizeBinding).filter(Boolean);
  writeJson(indexPath, {
    version: BINDINGS_INDEX_VERSION,
    updatedAt: new Date().toISOString(),
    source: bindingsSourceSignature(getBindingsPath(config)),
    total: normalized.length,
    keys: normalized.map(bindingKey),
    bindings: normalized
  });
}

function bindingsSourceSignature(path) {
  try {
    const stat = statSync(path);
    return {
      exists: true,
      size: stat.size
    };
  } catch {
    return {
      exists: false,
      size: 0
    };
  }
}

function sameBindingsSource(left, right) {
  return Boolean(left && right && left.exists === right.exists && left.size === right.size);
}

function normalizeBinding(binding) {
  if (!binding || typeof binding !== "object") {
    return null;
  }
  if (binding.version !== 2 || !binding.syncRunId || !binding.syncedAt) {
    return null;
  }
  const projectCommit = binding.projectCommit || null;
  const projectBaseCommit = binding.projectBaseCommit || projectCommit;
  const projectBranch = binding.projectBranch ?? null;
  const normalized = {
    version: binding.version,
    syncRunId: binding.syncRunId,
    syncedAt: binding.syncedAt,
    boundAt: binding.boundAt || binding.syncedAt,
    projectId: binding.projectId || null,
    projectIdentity: binding.projectIdentity || null,
    projectRemote: binding.projectRemote || null,
    projectBranch,
    projectCommit,
    projectBaseCommit,
    projectDirty: Boolean(binding.projectDirty),
    bundleId: binding.bundleId || null,
    agent: binding.agent || null,
    sessionId: binding.sessionId || null,
    title: binding.title || null,
    conversationAt: binding.conversationAt || binding.modifiedAt || binding.syncedAt || binding.boundAt || null,
    commitMessage: binding.commitMessage || null,
    authorName: binding.authorName || DEFAULT_AUTHOR_NAME,
    authorEmail: binding.authorEmail || DEFAULT_AUTHOR_EMAIL,
    sha256: binding.sha256 || null,
    storeRelativePath: binding.storeRelativePath || null,
    originalPath: binding.originalPath || null,
    agentRelativePath: binding.agentRelativePath || null,
    dependencies: binding.dependencies ? normalizeDependencies(binding.dependencies, binding.agent) : null
  };
  if (!normalized.bundleId || !normalized.agent || !normalized.storeRelativePath) {
    return null;
  }
  if (!isSupportedAgent(normalized.agent)) {
    return null;
  }
  if (!normalized.projectCommit && !normalized.projectBaseCommit && !normalized.projectBranch) {
    return null;
  }
  return normalized;
}

function createSyncRunId(gitContext) {
  return `${new Date().toISOString()}:${gitContext.headCommit || "no-head"}`;
}

function defaultCommitMessage(config, gitContext) {
  const shortCommit = gitContext.headCommit ? gitContext.headCommit.slice(0, 12) : "no-head";
  const branch = gitContext.branch || "detached";
  return `sync ${config.projectName || "project"} agent sessions at ${shortCommit} (${branch})`;
}

function isSupportedAgent(agent) {
  return SUPPORTED_AGENTS.includes(agent);
}
