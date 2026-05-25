import { existsSync } from "node:fs";
import { basename } from "node:path";
import { getProjectRemote, normalizeRemoteUrl } from "./git.js";
import { normalizePath, toSlash, unique, walk } from "./utils.js";

export function findClaudeSessionCandidates(claudeRoot) {
  if (!existsSync(claudeRoot)) {
    return [];
  }

  const root = normalizePath(claudeRoot);
  return walk(claudeRoot)
    .filter((file) => file.endsWith(".jsonl"))
    .map((path) => ({
      agent: "claude",
      path: normalizePath(path),
      root,
      claudeProjectSlug: getClaudeProjectSlug(root, path)
    }));
}

export function extractClaudeSessionMetadata(content, candidate = {}) {
  const metadata = {
    sessionId: null,
    title: null,
    conversationAt: null,
    projectRoots: [],
    workdirs: [],
    gitContexts: [],
    isSidechain: false,
    claudeProjectSlug: candidate.claudeProjectSlug || null
  };
  const projectRoots = new Set();
  const workdirs = new Set();
  const gitContexts = [];
  const titleCandidates = [];
  let latestTimestamp = null;

  for (const item of readJsonlItems(content)) {
    metadata.sessionId ||= stringOrNull(item.sessionId) || stringOrNull(item.session_id);
    metadata.isSidechain = metadata.isSidechain || item.isSidechain === true;
    addPath(projectRoots, item.cwd);
    collectStructuredPathFields(item, workdirs);

    const gitContext = extractClaudeGitContext(item);
    if (gitContext.branch || gitContext.commit || gitContext.repositoryUrl || gitContext.cwd) {
      gitContexts.push(gitContext);
    }

    const timestamp = parseTimestamp(item.timestamp);
    if (timestamp && (!latestTimestamp || timestamp > latestTimestamp)) {
      latestTimestamp = timestamp;
    }

    const title = getClaudeItemTitle(item);
    if (title) {
      titleCandidates.push(title);
    }
  }

  metadata.projectRoots = [...projectRoots];
  metadata.workdirs = [...workdirs];
  metadata.gitContexts = dedupeGitContexts(gitContexts);
  metadata.title = chooseFirstTitle(titleCandidates);
  metadata.conversationAt = latestTimestamp ? new Date(latestTimestamp).toISOString() : null;
  return metadata;
}

export function getClaudeProjectMatch(metadata, config, projectRemote = getConfigRemoteIdentity(config)) {
  const remoteMatch = matchClaudeRemote(metadata, projectRemote);
  if (hasKnownDifferentRemote(metadata, projectRemote)) {
    return { matched: false, reason: "claude:foreign-git" };
  }

  const pathOwnership = getClaudePathOwnership(metadata, config);
  if (pathOwnership.foreign.length) {
    return {
      matched: false,
      reason: pathOwnership.matched.length ? "claude:mixed-cwd" : "claude:foreign-cwd"
    };
  }

  if (remoteMatch) {
    return remoteMatch;
  }

  if (pathOwnership.matched.length) {
    return { matched: true, matchedBy: ["claude:cwd"] };
  }

  if (hasStructuredProjectIdentity(metadata)) {
    return { matched: false, reason: "claude:structured-no-match" };
  }

  return { matched: false, reason: "claude:missing-project-metadata" };
}

export function getClaudeContentProjectMatch(content, config, projectRemote = getConfigRemoteIdentity(config)) {
  return getClaudeProjectMatch(extractClaudeSessionMetadata(content), config, projectRemote);
}

export function isClaudeSessionContentForProject(content, config, projectRemote = getConfigRemoteIdentity(config)) {
  return getClaudeContentProjectMatch(content, config, projectRemote).matched;
}

export function cleanClaudeTitle(value) {
  return cleanTitle(value);
}

export function adaptClaudeSessionContent(content, config) {
  const metadata = extractClaudeSessionMetadata(content);
  const pathMappings = inferProjectPathMappings(metadata, config);
  if (!pathMappings.length) {
    return { adapted: false, content };
  }

  let adapted = false;
  let marked = false;
  const adaptedLines = content.split(/\r?\n/).map((line) => {
    if (!line) {
      return line;
    }
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      return line;
    }

    let lineAdapted = replaceProjectPathReferences(item, pathMappings);
    if (!marked && item && typeof item === "object") {
      item.agentSyncAdapted = {
        version: 1,
        restoredAt: new Date().toISOString(),
        strategy: "claude-project-paths",
        projectRoot: normalizePath(config.projectRoot),
        projectPathMappingCount: pathMappings.length
      };
      marked = true;
      lineAdapted = true;
    }
    adapted = adapted || lineAdapted;
    return lineAdapted ? JSON.stringify(item) : line;
  });

  return {
    adapted,
    content: adaptedLines.join("\n"),
    pathMappings
  };
}

export function getClaudeRestoreRelativePath(agentRelativePath, config) {
  const currentProjectSlug = encodeClaudeProjectPath(config.projectRoot);
  const parts = toSlash(agentRelativePath || "").split("/").filter(Boolean);
  if (!parts.length) {
    return currentProjectSlug;
  }
  if (looksLikeClaudeProjectSlug(parts[0]) && !parts[0].endsWith(".jsonl")) {
    parts[0] = currentProjectSlug;
    return parts.join("/");
  }
  return [currentProjectSlug, ...parts].join("/");
}

export function registerRestoredClaudeSession(content, targetPath, config, match = {}) {
  const metadata = extractClaudeSessionMetadata(content);
  return {
    registered: true,
    sessionId: metadata.sessionId || match.sessionId || null,
    title: cleanTitle(match.title) || metadata.title || null,
    targetPath: normalizePath(targetPath),
    projectRoot: normalizePath(config.projectRoot),
    method: "project-jsonl"
  };
}

function getClaudeProjectSlug(root, filePath) {
  const relativePath = toSlash(normalizePath(filePath).slice(root.length).replace(/^\/+/, ""));
  const first = relativePath.split("/").filter(Boolean)[0];
  return first || null;
}

function getClaudeItemTitle(item) {
  if (item?.type !== "user" && item?.message?.role !== "user") {
    return null;
  }
  const content = item?.message?.content;
  if (typeof content === "string") {
    return cleanTitle(content);
  }
  if (!Array.isArray(content)) {
    return null;
  }
  for (const entry of content) {
    const title = cleanTitle(entry?.text);
    if (title) {
      return title;
    }
  }
  return null;
}

function extractClaudeGitContext(item) {
  const git = item.git && typeof item.git === "object" ? item.git : {};
  return {
    branch: stringOrNull(item.gitBranch) || stringOrNull(item.branch) || stringOrNull(git.branch),
    commit: stringOrNull(item.gitCommit) ||
      stringOrNull(item.gitCommitHash) ||
      stringOrNull(item.gitHead) ||
      stringOrNull(item.gitSha) ||
      stringOrNull(git.commit) ||
      stringOrNull(git.commit_hash) ||
      stringOrNull(git.sha),
    repositoryUrl: stringOrNull(item.gitRemote) ||
      stringOrNull(item.gitRemoteUrl) ||
      stringOrNull(item.gitOriginUrl) ||
      stringOrNull(item.repositoryUrl) ||
      stringOrNull(item.repoUrl) ||
      stringOrNull(git.repository_url) ||
      stringOrNull(git.remote_url) ||
      stringOrNull(git.origin_url),
    cwd: typeof item.cwd === "string" ? normalizeSessionPathReference(item.cwd) : null
  };
}

function dedupeGitContexts(contexts) {
  const seen = new Set();
  const result = [];
  for (const context of contexts) {
    const normalized = {
      branch: context.branch || null,
      commit: context.commit || null,
      repositoryUrl: context.repositoryUrl || null,
      cwd: context.cwd || null
    };
    const key = JSON.stringify(normalized);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return result;
}

function collectStructuredPathFields(value, paths) {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStructuredPathFields(item, paths);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if ((key === "cwd" || key === "workdir") && typeof child === "string") {
      addPath(paths, child);
      continue;
    }
    if (key === "text" || key === "content" && typeof child === "string") {
      continue;
    }
    collectStructuredPathFields(child, paths);
  }
}

function matchClaudeRemote(metadata, projectRemote) {
  if (!projectRemote) {
    return null;
  }
  const metadataRemotes = getMetadataRemotes(metadata);
  return metadataRemotes.includes(projectRemote)
    ? { matched: true, matchedBy: [`git:${projectRemote}`] }
    : null;
}

function hasKnownDifferentRemote(metadata, projectRemote) {
  if (!projectRemote) {
    return false;
  }
  const metadataRemotes = getMetadataRemotes(metadata);
  return metadataRemotes.length > 0 && !metadataRemotes.includes(projectRemote);
}

function getMetadataRemotes(metadata) {
  return unique(
    (metadata.gitContexts || [])
      .map((item) => normalizeRemoteUrl(item.repositoryUrl || ""))
      .filter(Boolean)
  );
}

function getClaudePathOwnership(metadata, config) {
  const matched = [];
  const foreign = [];
  for (const path of getStructuredProjectPaths(metadata)) {
    if (isProjectPathReference(path, config)) {
      matched.push(path);
    } else {
      foreign.push(path);
    }
  }
  return { matched, foreign };
}

function getStructuredProjectPaths(metadata) {
  return unique([...(metadata.projectRoots || []), ...(metadata.workdirs || [])].filter(Boolean));
}

function hasStructuredProjectIdentity(metadata) {
  return getMetadataRemotes(metadata).length > 0 ||
    getStructuredProjectPaths(metadata).length > 0 ||
    (metadata.gitContexts || []).some((context) => context.branch || context.commit);
}

function isProjectPathReference(value, config) {
  const path = normalizeSessionPathReference(value).toLowerCase();
  const projectRoot = normalizeSessionPathReference(config.projectRoot).toLowerCase();
  if (path === projectRoot || path.startsWith(`${projectRoot}/`)) {
    return true;
  }
  const projectName = basename(config.projectRoot).toLowerCase();
  return path.split("/").some((part) => cleanPathSegment(part).toLowerCase() === projectName);
}

function inferProjectPathMappings(metadata, config) {
  const target = normalizePath(config.projectRoot);
  return getStructuredProjectPaths(metadata)
    .map((source) => truncatePathAtProjectName(source, config.projectName || basename(config.projectRoot)) || source)
    .map((source) => buildProjectPathMapping(source, target))
    .filter(Boolean)
    .sort((a, b) => b.source.length - a.source.length);
}

function truncatePathAtProjectName(value, projectName) {
  if (!projectName) {
    return null;
  }
  const separatorMatch = value.match(/[\\/]/);
  const separator = separatorMatch?.[0] || "/";
  const isAbsolutePosix = value.startsWith("/");
  const rawParts = value.split(/[\\/]+/);
  const parts = rawParts.filter(Boolean);
  const index = parts.findIndex((part) => cleanPathSegment(part).toLowerCase() === projectName.toLowerCase());
  if (index < 0) {
    return null;
  }
  const rootParts = parts.slice(0, index + 1);
  const root = isAbsolutePosix ? `${separator}${rootParts.join(separator)}` : rootParts.join(separator);
  return trimTrailingPathSeparators(root);
}

function buildProjectPathMapping(source, target) {
  const cleanSource = trimTrailingPathSeparators(source);
  if (!cleanSource || samePathReference(cleanSource, target)) {
    return null;
  }
  const variants = unique([
    cleanSource,
    cleanSource.replaceAll("\\", "/"),
    cleanSource.replaceAll("/", "\\"),
    cleanSource.replaceAll("\\", "\\\\")
  ]).filter((variant) => variant && !samePathReference(variant, target));

  return {
    source: cleanSource,
    target,
    variants: variants.sort((a, b) => b.length - a.length)
  };
}

function replaceProjectPathReferences(value, mappings) {
  if (!mappings?.length || !value || typeof value !== "object") {
    return false;
  }

  let changed = false;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      if (typeof value[i] === "string") {
        const next = replaceProjectPathString(value[i], mappings);
        if (next !== value[i]) {
          value[i] = next;
          changed = true;
        }
      } else if (replaceProjectPathReferences(value[i], mappings)) {
        changed = true;
      }
    }
    return changed;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "encrypted_content") {
      continue;
    }
    if (typeof child === "string") {
      const next = replaceProjectPathString(child, mappings);
      if (next !== child) {
        value[key] = next;
        changed = true;
      }
    } else if (replaceProjectPathReferences(child, mappings)) {
      changed = true;
    }
  }
  return changed;
}

function replaceProjectPathString(value, mappings) {
  let result = value;
  for (const mapping of mappings) {
    for (const variant of mapping.variants) {
      const pattern = new RegExp(`${escapeRegExp(variant)}((?:[\\\\/][^\\s"'<>|]*)*)`, "g");
      result = result.replace(pattern, (_match, suffix = "") => `${mapping.target}${normalizePathSuffix(suffix)}`);
    }
  }
  return result;
}

function encodeClaudeProjectPath(projectRoot) {
  return normalizeSessionPathReference(projectRoot).replace(/:/g, "").replaceAll("/", "-");
}

function looksLikeClaudeProjectSlug(value) {
  return value.startsWith("-") || /^[A-Za-z]-/.test(value);
}

function addPath(paths, value) {
  if (typeof value === "string" && (isWindowsPath(value) || isPosixPath(value))) {
    paths.add(normalizeSessionPathReference(value));
  }
}

function getConfigRemoteIdentity(config) {
  return config?.projectIdentity?.startsWith("git:") ? config.projectIdentity.slice("git:".length) : normalizeRemoteUrl(getProjectRemote(config.projectRoot) || "");
}

function cleanTitle(value) {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  if (!text || isLowSignalTitle(text)) {
    return null;
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 96);
}

function isLowSignalTitle(value) {
  return value.startsWith("<ide_") ||
    value.startsWith("<environment_context>") ||
    value.startsWith("Base directory for this skill:") ||
    value.startsWith("We need ") ||
    value.startsWith("You are ");
}

function chooseFirstTitle(values) {
  for (const value of values) {
    const title = cleanTitle(value);
    if (title) {
      return title;
    }
  }
  return null;
}

function parseTimestamp(value) {
  if (typeof value !== "string") {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function* readJsonlItems(content) {
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      yield JSON.parse(line);
    } catch {
      // Ignore partial JSONL lines.
    }
  }
}

function normalizeSessionPathReference(value) {
  return trimTrailingPathSeparators(String(value).replaceAll("\\", "/"));
}

function isWindowsPath(value) {
  return typeof value === "string" && /^[A-Za-z]:[\\/]/.test(value);
}

function isPosixPath(value) {
  return typeof value === "string" && /^\//.test(value);
}

function cleanPathSegment(value) {
  return value.replace(/[),.:;\]}]+$/g, "");
}

function trimTrailingPathSeparators(value) {
  return value.replace(/[\\/]+$/g, "");
}

function samePathReference(left, right) {
  const normalize = (value) => trimTrailingPathSeparators(value).replaceAll("\\", "/").toLowerCase();
  return normalize(left) === normalize(right);
}

function normalizePathSuffix(value) {
  return value.replace(/[\\/]+/g, "/");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
