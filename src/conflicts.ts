import { existsSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { readJson, toSlash, walk, writeJson } from "./utils.js";

export const CONFLICT_RESOLUTION_STRATEGIES = [
  "keep-all",
  "keep-latest",
  "keep-local",
  "keep-remote"
];

export function listConflicts(config, options: Record<string, any> = {}) {
  const root = getConflictRoot(config);
  if (!existsSync(root)) {
    return [];
  }

  const conflicts = walk(root)
    .filter((path) => path.endsWith(".json"))
    .map((path) => readConflictRecord(config, path))
    .filter(Boolean)
    .sort(sortConflicts);

  const visible = options.all
    ? conflicts
    : conflicts.filter((conflict) => isActiveConflict(conflict));

  return visible.map((conflict, index) => ({
    ...conflict,
    index: index + 1
  }));
}

export function showConflict(config, selector, options: Record<string, any> = {}) {
  return resolveConflictSelector(config, selector, options);
}

export function resolveConflict(config, selector, options: Record<string, any> = {}) {
  const conflict = resolveConflictSelector(config, selector, options);
  const strategy = normalizeConflictStrategy(options.strategy);
  const now = new Date().toISOString();
  const resolution = {
    strategy,
    notes: normalizeNotes(options.notes),
    resolvedBy: "git-agent-sync"
  };
  const next = {
    ...conflict.raw,
    status: "resolved",
    resolvedAt: now,
    resolution
  };

  if (!options.dryRun) {
    writeJson(conflict.path, next);
  }

  return {
    ...readConflictRecord(config, conflict.path, next),
    dryRun: Boolean(options.dryRun)
  };
}

export function normalizeConflictStrategy(value) {
  const strategy = String(value || "keep-all").trim();
  if (!CONFLICT_RESOLUTION_STRATEGIES.includes(strategy)) {
    throw new Error(`unknown conflict strategy "${strategy}". Use one of: ${CONFLICT_RESOLUTION_STRATEGIES.join(", ")}`);
  }
  return strategy;
}

function resolveConflictSelector(config, selector, options: Record<string, any> = {}) {
  const value = String(selector || "").trim();
  if (!value) {
    throw new Error("conflicts show/resolve requires a conflict id, path, or list index");
  }

  if (/^\d+$/.test(value)) {
    const conflicts = listConflicts(config, { all: Boolean(options.all) });
    const index = Number(value);
    const selected = conflicts[index - 1];
    if (!selected) {
      const scope = options.all ? "all conflicts" : "active conflicts";
      throw new Error(`conflict index ${index} is out of range for ${scope} (${conflicts.length} conflict(s))`);
    }
    return selected;
  }

  const matches = listConflicts(config, { all: true }).filter((conflict) => {
    return conflict.id === value ||
      conflict.id.startsWith(value) ||
      conflict.relativePath === value ||
      conflict.projectRelativePath === value ||
      basename(conflict.relativePath) === value;
  });

  if (!matches.length) {
    throw new Error(`no conflict found for "${value}"`);
  }
  if (matches.length > 1) {
    throw new Error(`conflict selector "${value}" is ambiguous (${matches.length} matches)`);
  }
  return matches[0];
}

function readConflictRecord(config, path, value: Record<string, any> | null = null) {
  let raw = value;
  if (!raw) {
    try {
      raw = readJson(path);
    } catch {
      return null;
    }
  }
  const root = getConflictRoot(config);
  const events = Array.isArray(raw.events) ? raw.events : [];
  const objectHashes = Array.isArray(raw.objectHashes) ? raw.objectHashes : [];
  const status = raw.status || "open";
  return {
    id: raw.id || basename(path, ".json"),
    type: raw.type || "unknown-conflict",
    status,
    agent: raw.agent || "unknown",
    sessionId: raw.sessionId || "unknown",
    bundleIds: Array.isArray(raw.bundleIds) ? raw.bundleIds : [],
    objectHashes,
    eventCount: events.length,
    events,
    resolvedAt: raw.resolvedAt || null,
    resolution: raw.resolution || null,
    relativePath: toSlash(relative(config.storePath, path)),
    projectRelativePath: toSlash(relative(root, path)),
    path,
    raw
  };
}

function sortConflicts(left, right) {
  return Number(isActiveConflict(right)) - Number(isActiveConflict(left)) ||
    String(left.agent || "").localeCompare(String(right.agent || "")) ||
    String(left.sessionId || "").localeCompare(String(right.sessionId || "")) ||
    String(left.id || "").localeCompare(String(right.id || ""));
}

function isActiveConflict(conflict) {
  return !conflict.status || conflict.status === "open" || conflict.status === "active";
}

function normalizeNotes(value) {
  const notes = String(value || "").trim();
  return notes || null;
}

function getConflictRoot(config) {
  return join(config.storePath, "conflicts", config.projectId);
}
