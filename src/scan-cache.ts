import { existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { SCAN_CACHE_FILE } from "./constants.js";
import { normalizePath, readJson, shrinkHome, toSlash, writeJson } from "./utils.js";

const CACHE_VERSION = 3;

export function getScanCachePath(gitRoot) {
  return join(gitRoot, SCAN_CACHE_FILE);
}

export function loadScanCache(gitRoot, cachePath = getScanCachePath(gitRoot)) {
  if (!existsSync(cachePath)) {
    return emptyScanCache(gitRoot);
  }

  try {
    const cache = readJson(cachePath);
    if (cache.version !== CACHE_VERSION || cache.projectRoot !== normalizePath(gitRoot)) {
      return emptyScanCache(gitRoot);
    }
    return {
      ...cache,
      files: cache.files && typeof cache.files === "object" ? cache.files : {}
    };
  } catch {
    return emptyScanCache(gitRoot);
  }
}

export function writeScanCache(gitRoot, cache, cachePath = getScanCachePath(gitRoot)) {
  writeJson(cachePath, {
    version: CACHE_VERSION,
    updatedAt: new Date().toISOString(),
    projectRoot: normalizePath(gitRoot),
    contextKey: cache.contextKey || null,
    files: cache.files || {}
  });
}

export function createScanCacheEntry(candidate, stat, result) {
  const match = result?.match || null;
  return {
    agent: candidate.agent,
    path: normalizePath(candidate.path),
    root: normalizePath(candidate.root),
    signature: fileSignature(stat),
    bytes: result?.bytes || match?.bytes || 0,
    sha256: result?.sha256 || match?.sha256 || null,
    matched: Boolean(match),
    match: match ? { ...match, absolutePath: normalizePath(candidate.path) } : null
  };
}

export function restoreCachedScanEntry(candidate, stat, cache) {
  const entry = cache?.files?.[normalizePath(candidate.path)];
  if (!entry || entry.agent !== candidate.agent || entry.root !== normalizePath(candidate.root)) {
    return null;
  }
  if (!sameSignature(entry.signature, fileSignature(stat))) {
    return null;
  }
  if (!entry.matched || !entry.match) {
    return { skipped: true, match: null };
  }
  return {
    skipped: true,
    match: {
      ...entry.match,
      absolutePath: normalizePath(candidate.path)
    }
  };
}

export function pruneScanCacheFiles(cache, candidates) {
  const livePaths = new Set(candidates.map((candidate) => normalizePath(candidate.path)));
  const files = {};
  for (const [path, entry] of Object.entries(cache.files || {})) {
    if (livePaths.has(path)) {
      files[path] = entry;
    }
  }
  cache.files = files;
  return cache;
}

export function getCandidateStat(candidate) {
  try {
    return statSync(candidate.path);
  } catch {
    return null;
  }
}

export function buildMatchBase(candidate, content, hash, stat) {
  return {
    agent: candidate.agent,
    originalPath: shrinkHome(candidate.path),
    absolutePath: normalizePath(candidate.path),
    agentRelativePath: toSlash(relative(candidate.root, candidate.path)),
    bytes: Buffer.byteLength(content),
    sha256: hash,
    bundleId: `${candidate.agent}-${hash.slice(0, 12)}`,
    modifiedAt: stat.mtime.toISOString()
  };
}

function emptyScanCache(gitRoot) {
  return {
    version: CACHE_VERSION,
    projectRoot: normalizePath(gitRoot),
    contextKey: null,
    files: {}
  };
}

function fileSignature(stat) {
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs
  };
}

function sameSignature(a, b) {
  return Boolean(a && b && a.size === b.size && a.mtimeMs === b.mtimeMs);
}
