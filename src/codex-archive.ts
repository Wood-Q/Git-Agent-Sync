import { existsSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { ARCHIVE_CACHE_FILE } from "./constants.js";
import { getCodexThreadArchiveInfo } from "./codex-session.js";
import { expandHome, normalizePath, readJson, shrinkHome, walk, writeJson } from "./utils.js";

const CACHE_VERSION = 1;

export function getCodexArchiveInfo(codexRoot, options: { cachePath?: string; gitRoot?: string } = {}) {
  const codexHome = resolveCodexHome(codexRoot);
  const statePath = join(codexHome, "state_5.sqlite");
  const archivedSessionsDir = join(codexHome, "archived_sessions");
  const cachePath = options.cachePath || (options.gitRoot ? join(options.gitRoot, ARCHIVE_CACHE_FILE) : null);
  const signature = archiveSignature(codexHome, statePath, archivedSessionsDir);
  const cached = cachePath ? readArchiveCache(cachePath, signature) : null;
  if (cached) {
    return {
      codexHome: normalizePath(codexHome),
      statePath: normalizePath(statePath),
      archivedSessionsDir: normalizePath(archivedSessionsDir),
      archivedPaths: new Set(cached.archivedPaths),
      sourceSummary: cached.sourceSummary,
      stateStatus: cached.stateStatus,
      cacheStatus: "hit"
    };
  }

  const archivedPaths = new Set();
  const sources = [];

  if (existsSync(archivedSessionsDir)) {
    const files = walk(archivedSessionsDir);
    for (const file of files) {
      addArchivedPath(archivedPaths, file);
    }
    sources.push(`dir:${files.length}`);
  }

  const state = getCodexThreadArchiveInfo(codexRoot);
  if (state.ok) {
    for (const path of state.paths) {
      addArchivedPath(archivedPaths, path);
    }
    sources.push(`state:${state.paths.length}`);
  }

  const info = {
    codexHome: normalizePath(codexHome),
    statePath: normalizePath(statePath),
    archivedSessionsDir: normalizePath(archivedSessionsDir),
    archivedPaths,
    sourceSummary: sources.join(",") || "none",
    stateStatus: state.status,
    cacheStatus: cachePath ? "miss" : "off"
  };

  if (cachePath) {
    writeArchiveCache(cachePath, signature, info);
  }
  return info;
}

export function summarizeCodexArchiveInfo(info) {
  return {
    codexHome: shrinkHome(info.codexHome),
    statePath: shrinkHome(info.statePath),
    archivedSessionsDir: shrinkHome(info.archivedSessionsDir),
    archivedCount: info.archivedPaths.size,
    stateStatus: info.stateStatus,
    sourceSummary: info.sourceSummary,
    cacheStatus: info.cacheStatus || "off"
  };
}

export function isArchivedCodexSessionPath(path, archiveInfo) {
  if (!archiveInfo || !path) {
    return false;
  }

  const normalized = normalizeArchivePath(path);
  if (!normalized) {
    return false;
  }
  if (archiveInfo.archivedPaths.has(normalized)) {
    return true;
  }
  if (normalized.includes("/archived_sessions/")) {
    return true;
  }
  return false;
}

function resolveCodexHome(codexRoot) {
  const normalized = normalizePath(codexRoot);
  const leaf = basename(normalized);
  if (leaf === "sessions" || leaf === "archived_sessions") {
    return dirname(normalized);
  }
  if (existsSync(join(normalized, "state_5.sqlite"))) {
    return normalized;
  }
  const parent = dirname(normalized);
  if (existsSync(join(parent, "state_5.sqlite"))) {
    return parent;
  }
  return normalized;
}

function readArchiveCache(cachePath, signature) {
  if (!existsSync(cachePath)) {
    return null;
  }
  try {
    const cache = readJson(cachePath);
    if (cache.version !== CACHE_VERSION) {
      return null;
    }
    if (!sameSignature(cache.signature, signature)) {
      return null;
    }
    if (!Array.isArray(cache.archivedPaths)) {
      return null;
    }
    return cache;
  } catch {
    return null;
  }
}

function writeArchiveCache(cachePath, signature, info) {
  writeJson(cachePath, {
    version: CACHE_VERSION,
    updatedAt: new Date().toISOString(),
    signature,
    stateStatus: info.stateStatus,
    sourceSummary: info.sourceSummary,
    archivedPaths: [...info.archivedPaths].sort()
  });
}

function archiveSignature(codexHome, statePath, archivedSessionsDir) {
  return {
    codexHome: normalizePath(codexHome),
    state: fileSignature(statePath),
    archivedDir: directorySignature(archivedSessionsDir)
  };
}

function directorySignature(path) {
  const signature = fileSignature(path);
  if (!signature.exists) {
    return signature;
  }
  const files = walk(path).sort();
  return {
    ...signature,
    files: files.map((file) => [normalizePath(file), fileSignature(file)])
  };
}

function fileSignature(path) {
  try {
    const stat = statSync(path);
    return {
      exists: true,
      size: stat.size,
      mtimeMs: stat.mtimeMs
    };
  } catch {
    return { exists: false };
  }
}

function sameSignature(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function addArchivedPath(archivedPaths, path) {
  const normalized = normalizeArchivePath(path);
  if (!normalized) {
    return;
  }
  archivedPaths.add(normalized);
}

function normalizeArchivePath(path) {
  if (!path) {
    return "";
  }
  return normalizePath(expandHome(path));
}
