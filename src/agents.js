import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getCodexArchiveInfo, isArchivedCodexSessionPath, summarizeCodexArchiveInfo } from "./codex-archive.js";
import { getProjectRemote, normalizeRemoteUrl } from "./git.js";
import {
  applyCodexThreadMetadata,
  createCodexThreadMetadata,
  extractCodexSessionMetadata,
  getCodexProjectMatch,
  loadCodexThreadIndex,
  loadCodexSessionIndexTitles,
  resolveCodexHome
} from "./codex-session.js";
import {
  extractClaudeSessionMetadata,
  findClaudeSessionCandidates,
  getClaudeProjectMatch
} from "./claude-session.js";
import {
  buildMatchBase,
  createScanCacheEntry,
  getCandidateStat,
  loadScanCache,
  pruneScanCacheFiles,
  restoreCachedScanEntry,
  writeScanCache
} from "./scan-cache.js";
import { normalizePath, safeRead, sha256, walk } from "./utils.js";

export function scanSessions(gitRoot, config, archiveInfo = null) {
  const projectRemote = normalizeRemoteUrl(getProjectRemote(gitRoot) || "");
  const codexRoot = getAgentRoot("codex");
  const codexArchiveInfo = archiveInfo || getCodexArchiveInfo(codexRoot, { gitRoot });
  const codexThreadIndex = loadCodexThreadIndex(codexRoot);
  const codexTitles = getCodexTitleMap(codexRoot, codexThreadIndex);
  const codexTitleSignature = getCodexTitleSourceSignature(codexRoot);
  const claudeRoot = getAgentRoot("claude");

  const codexCandidates = findCodexCandidates(codexRoot, codexThreadIndex, codexArchiveInfo, config, projectRemote);
  const claudeCandidates = findClaudeSessionCandidates(claudeRoot);
  const candidates = [...codexCandidates, ...claudeCandidates];

  const cache = prepareScanCache(gitRoot, config, projectRemote, candidates, codexTitleSignature, claudeRoot);
  const stats = {
    cached: 0,
    refreshed: 0,
    skipped: 0
  };
  const matches = candidates
    .map((candidate) => scanCandidate(candidate, cache, stats, config, projectRemote, codexTitles, codexThreadIndex))
    .filter((match) => match)
    .sort((a, b) => a.agent.localeCompare(b.agent) || a.originalPath.localeCompare(b.originalPath));
  writeScanCache(gitRoot, cache);

  return {
    version: 1,
    scannedAt: new Date().toISOString(),
    projectId: config.projectId,
    projectIdentity: config.projectIdentity,
    projectName: config.projectName,
    projectRoot: gitRoot,
    candidates: candidates.length,
    agents: {
      codex: { candidates: codexCandidates.length },
      claude: { candidates: claudeCandidates.length }
    },
    cache: stats,
    matches,
    archive: summarizeCodexArchiveInfo(codexArchiveInfo)
  };
}

function prepareScanCache(gitRoot, config, projectRemote, candidates, codexTitleSignature, claudeRoot) {
  const cache = loadScanCache(gitRoot);
  const contextKey = JSON.stringify({
    providerVersion: 2,
    projectId: config.projectId,
    projectIdentity: config.projectIdentity,
    projectRoot: normalizePath(gitRoot),
    projectName: config.projectName,
    projectRemote,
    codexTitleSignature,
    claudeRoot: normalizePath(claudeRoot)
  });
  if (cache.contextKey !== contextKey) {
    cache.files = {};
    cache.contextKey = contextKey;
  }
  return pruneScanCacheFiles(cache, candidates);
}

function findCodexCandidates(codexRoot, codexThreadIndex, codexArchiveInfo, config, projectRemote) {
  const indexed = findCodexThreadCandidates(codexRoot, codexThreadIndex, codexArchiveInfo, config, projectRemote);
  if (indexed.length || hasUsableCodexThreadIndex(codexThreadIndex)) {
    return indexed;
  }

  return findAgentFiles("codex", codexRoot)
    .filter((candidate) => !isArchivedCodexSessionPath(candidate.path, codexArchiveInfo));
}

function getCodexTitleMap(codexRoot, codexThreadIndex) {
  const titles = new Map();
  for (const thread of codexThreadIndex.threads) {
    if (thread.id && thread.title) {
      titles.set(thread.id, thread.title);
    }
  }
  return loadCodexSessionIndexTitles(codexRoot, titles);
}

function hasUsableCodexThreadIndex(codexThreadIndex) {
  return codexThreadIndex.threads.some((thread) => {
    return thread.rolloutPath && (thread.cwd || thread.gitOriginUrl || thread.gitBranch || thread.gitSha);
  });
}

function findCodexThreadCandidates(codexRoot, codexThreadIndex, codexArchiveInfo, config, projectRemote) {
  const candidates = [];
  const seen = new Set();
  for (const thread of codexThreadIndex.threads) {
    if (thread.archived || !thread.rolloutPath || seen.has(thread.rolloutPath)) {
      continue;
    }
    if (isArchivedCodexSessionPath(thread.rolloutPath, codexArchiveInfo)) {
      continue;
    }
    if (!existsSync(thread.rolloutPath)) {
      continue;
    }
    const metadata = createCodexThreadMetadata(thread);
    const projectMatch = getCodexProjectMatch(metadata, config, projectRemote);
    if (!projectMatch.matched) {
      continue;
    }
    seen.add(thread.rolloutPath);
    candidates.push({
      agent: "codex",
      path: thread.rolloutPath,
      root: normalizePath(codexRoot),
      thread,
      matchedBy: projectMatch.matchedBy
    });
  }
  return candidates;
}

function getCodexTitleSourceSignature(codexRoot) {
  const codexHome = resolveCodexHome(codexRoot);
  return {
    codexHome,
    files: ["state_5.sqlite", "state_5.sqlite-wal", "state_5.sqlite-shm", "session_index.jsonl"]
      .map((file) => [file, fileSignature(join(codexHome, file))])
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

function scanCandidate(candidate, cache, stats, config, projectRemote, codexTitles, codexThreadIndex) {
  const stat = getCandidateStat(candidate);
  if (!stat) {
    return null;
  }

  const cached = restoreCachedScanEntry(candidate, stat, cache);
  if (cached) {
    stats.cached += 1;
    if (cached.skipped) {
      stats.skipped += 1;
    }
    return cached.match;
  }

  stats.refreshed += 1;
  const content = safeRead(candidate.path);
  const metadata = getCandidateMetadata(candidate, content, codexTitles, codexThreadIndex);
  if (metadata && !metadata.title && metadata.sessionId && codexTitles.has(metadata.sessionId)) {
    metadata.title = codexTitles.get(metadata.sessionId);
  }
  const matchedBy = matchAgentSession(candidate, metadata, config, projectRemote);
  const hash = sha256(content);
  const match = matchedBy.length
    ? {
        ...buildMatchBase(candidate, content, hash, stat),
        matchedBy: matchedBy.slice(0, 3),
        metadata: metadata || undefined
      }
    : null;

  cache.files[normalizePath(candidate.path)] = createScanCacheEntry(candidate, stat, {
    bytes: Buffer.byteLength(content),
    sha256: hash,
    match
  });
  return match;
}

function getCandidateMetadata(candidate, content, codexTitles, codexThreadIndex) {
  if (candidate.agent === "codex") {
    return getCodexCandidateMetadata(candidate, content, codexTitles, codexThreadIndex);
  }
  if (candidate.agent === "claude") {
    return extractClaudeSessionMetadata(content, candidate);
  }
  return null;
}

function getCodexCandidateMetadata(candidate, content, codexTitles, codexThreadIndex) {
  if (!candidate.thread) {
    const metadata = extractCodexSessionMetadata(content);
    const thread = metadata.sessionId ? codexThreadIndex.byId.get(metadata.sessionId) : null;
    return thread ? applyCodexThreadMetadata(metadata, thread) : metadata;
  }
  const metadata = createCodexThreadMetadata(candidate.thread);
  if (!metadata.title) {
    metadata.title = codexTitles.get(metadata.sessionId) || extractCodexSessionMetadata(content).title || null;
  }
  return metadata;
}

function matchAgentSession(candidate, metadata, config, projectRemote) {
  if (candidate.agent === "codex") {
    return matchCodexSession(metadata, candidate.matchedBy, config, projectRemote);
  }
  if (candidate.agent === "claude") {
    const projectMatch = getClaudeProjectMatch(metadata, config, projectRemote);
    return projectMatch.matched ? projectMatch.matchedBy : [];
  }
  return [];
}

function matchCodexSession(metadata, preMatchedBy, config, projectRemote) {
  if (preMatchedBy?.length) {
    return preMatchedBy;
  }
  const projectMatch = getCodexProjectMatch(metadata, config, projectRemote);
  if (projectMatch.matched) {
    return projectMatch.matchedBy;
  }
  return [];
}

function findAgentFiles(agent, root) {
  if (!existsSync(root)) {
    return [];
  }
  return walk(root)
    .filter((file) => file.endsWith(".jsonl") || file.endsWith(".json"))
    .map((path) => ({ agent, path: normalizePath(path), root: normalizePath(root) }));
}

export function getAgentRoot(agent) {
  if (agent === "codex") {
    return process.env.AGENT_SYNC_CODEX_DIR || join(homedir(), ".codex", "sessions");
  }
  if (agent === "claude") {
    return process.env.AGENT_SYNC_CLAUDE_DIR || join(homedir(), ".claude", "projects");
  }
  throw new Error(`unsupported agent "${agent}"`);
}
