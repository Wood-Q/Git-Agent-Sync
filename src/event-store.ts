import { existsSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { TOOL_VERSION } from "./constants.js";
import { aggregateDependencies } from "./dependencies.js";
import { expandHome, sha256, toSlash, walk, writeFileAtomic, writeJson } from "./utils.js";

const EVENT_STORE_VERSION = 1;
const EVENT_INDEX_VERSION = 1;
const EVENT_TYPE_SESSION_SNAPSHOT = "session-snapshot";
const SUPPORTED_EVENT_AGENTS = new Set(["codex", "claude"]);

export function writeEventStoreSnapshot(config, matches, gitContext, syncRunId, commitInfo = {}) {
  const machineId = getMachineId(config);
  const eventPath = getSyncEventPath(config, machineId, syncRunId);
  const syncedAt = new Date().toISOString();
  const events = [];
  let objectsWritten = 0;
  let objectsReused = 0;
  let skipped = 0;

  for (const match of matches.filter((item) => SUPPORTED_EVENT_AGENTS.has(item.agent))) {
    const source = readMatchContent(config, match, commitInfo);
    if (!source) {
      skipped += 1;
      continue;
    }

    const objectHash = sha256(source.content);
    const objectRelativePath = getObjectRelativePath(match, objectHash, source.path);
    const objectPath = join(config.storePath, objectRelativePath);
    if (existsSync(objectPath)) {
      objectsReused += 1;
    } else {
      writeFileAtomic(objectPath, source.content);
      objectsWritten += 1;
    }

    events.push(createSnapshotEvent({
      config,
      match,
      gitContext,
      syncRunId,
      commitInfo,
      syncedAt,
      machineId,
      objectHash,
      objectRelativePath,
      bytes: Buffer.byteLength(source.content)
    }));
  }

  if (events.length) {
    writeFileAtomic(eventPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  }
  const indexes = events.length ? rebuildEventIndexes(config) : null;

  return {
    version: EVENT_STORE_VERSION,
    machineId,
    eventPath: events.length ? toSlash(relative(config.storePath, eventPath)) : null,
    eventsWritten: events.length,
    objectsWritten,
    objectsReused,
    skipped,
    indexes
  };
}

export function rebuildEventIndexes(config) {
  const projectDir = join(config.storePath, "projects", config.projectId);
  const events = readSessionEvents(config).filter((event) => eventMatchesProject(config, event));
  const bindings = events.map((event) => eventToBinding(config, event));
  const matches = latestMatchesFromEvents(events);
  const rebuiltAt = new Date().toISOString();

  const manifest = {
    version: EVENT_INDEX_VERSION,
    generatedFrom: "events",
    rebuiltAt,
    tool: "git-agent-sync",
    toolVersion: TOOL_VERSION,
    projectId: config.projectId,
    projectIdentity: config.projectIdentity,
    projectName: config.projectName,
    events: events.length,
    dependencies: aggregateDependencies(matches),
    matches
  };
  const bindingsIndex = {
    version: EVENT_INDEX_VERSION,
    generatedFrom: "events",
    updatedAt: rebuiltAt,
    total: bindings.length,
    keys: bindings.map(bindingKey),
    bindings
  };

  const manifestPath = join(projectDir, "manifest.events.json");
  const bindingsIndexPath = join(projectDir, "bindings.events.idx.json");
  writeJson(manifestPath, manifest);
  writeJson(bindingsIndexPath, bindingsIndex);
  return {
    events: events.length,
    matches: matches.length,
    manifestPath: toSlash(relative(config.storePath, manifestPath)),
    bindingsIndexPath: toSlash(relative(config.storePath, bindingsIndexPath))
  };
}

export function readSessionEvents(config) {
  const eventsRoot = join(config.storePath, "events");
  if (!existsSync(eventsRoot)) {
    return [];
  }
  const events = [];
  const files = walk(eventsRoot).filter((file) => file.endsWith(".jsonl")).sort();
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      try {
        const event = JSON.parse(line);
        if (event?.version === EVENT_STORE_VERSION && event?.type === EVENT_TYPE_SESSION_SNAPSHOT) {
          events.push(event);
        }
      } catch {
        // Ignore corrupt event lines here. A later conflict/review phase can surface
        // them without blocking healthy event shards from rebuilding indexes.
      }
    }
  }
  return events.sort((a, b) => {
    return String(a.syncedAt || "").localeCompare(String(b.syncedAt || "")) ||
      String(a.syncRunId || "").localeCompare(String(b.syncRunId || "")) ||
      String(a.session?.bundleId || "").localeCompare(String(b.session?.bundleId || ""));
  });
}

export function getMachineId(config) {
  if (config.machineId) {
    return String(config.machineId);
  }
  return `machine-${sha256(`${config.projectRoot || ""}|${config.storePath || ""}`).slice(0, 12)}`;
}

function createSnapshotEvent({
  config,
  match,
  gitContext,
  syncRunId,
  commitInfo,
  syncedAt,
  machineId,
  objectHash,
  objectRelativePath,
  bytes
}) {
  return {
    version: EVENT_STORE_VERSION,
    type: EVENT_TYPE_SESSION_SNAPSHOT,
    syncRunId,
    machineId,
    syncedAt,
    tool: "git-agent-sync",
    toolVersion: TOOL_VERSION,
    project: {
      id: config.projectId,
      identity: config.projectIdentity,
      name: config.projectName
    },
    git: {
      branch: gitContext?.branch || null,
      commit: gitContext?.headCommit || null,
      baseCommit: gitContext?.baseCommit || gitContext?.headCommit || null,
      dirty: Boolean(gitContext?.dirty)
    },
    commit: {
      message: commitInfo.message || null,
      authorName: commitInfo.authorName || null,
      authorEmail: commitInfo.authorEmail || null
    },
    session: {
      agent: match.agent,
      bundleId: match.bundleId,
      sessionId: match.metadata?.sessionId || null,
      title: match.metadata?.title || null,
      conversationAt: match.metadata?.conversationAt || match.modifiedAt || syncedAt,
      metadata: match.metadata || null,
      matchedBy: match.matchedBy || [],
      dependencies: match.dependencies || null
    },
    object: {
      sha256: objectHash,
      relativePath: objectRelativePath,
      bytes
    },
    source: {
      originalPath: match.originalPath || null,
      storeRelativePath: match.storeRelativePath || null,
      agentRelativePath: match.agentRelativePath || null
    }
  };
}

function readMatchContent(config, match, options: Record<string, any> = {}) {
  const originalPath = match.originalPath ? expandHome(match.originalPath) : "";
  const storePath = match.storeRelativePath ? join(config.storePath, match.storeRelativePath) : "";
  const candidates = options.preferStoreContent
    ? [storePath, originalPath].filter(Boolean)
    : [originalPath, storePath].filter(Boolean);

  for (const path of candidates) {
    if (existsSync(path)) {
      return { path, content: readFileSync(path, "utf8") };
    }
  }
  return null;
}

function getObjectRelativePath(match, objectHash, sourcePath) {
  const extension = extname(sourcePath) === ".json" ? ".json" : ".jsonl";
  return toSlash(join("objects", match.agent, "sha256", `${objectHash}${extension}`));
}

function getSyncEventPath(config, machineId, syncRunId) {
  const stamp = String(syncRunId || new Date().toISOString()).split(":").slice(0, 3).join(":");
  const safeStamp = stamp.replace(/[^0-9A-Za-z._-]/g, "_");
  return join(config.storePath, "events", sanitizePathPart(machineId), `${safeStamp}-${sha256(syncRunId).slice(0, 12)}.jsonl`);
}

function sanitizePathPart(value) {
  return String(value || "unknown").replace(/[^0-9A-Za-z._-]/g, "_");
}

function eventMatchesProject(config, event) {
  const eventProjectId = event.project?.id;
  const eventIdentity = event.project?.identity;
  return eventProjectId === config.projectId ||
    config.legacyProjectIds?.includes(eventProjectId) ||
    (eventIdentity && eventIdentity === config.projectIdentity);
}

function latestMatchesFromEvents(events) {
  const byBundle = new Map();
  for (const event of events) {
    const key = `${event.session?.agent || ""}:${event.session?.bundleId || ""}`;
    byBundle.set(key, eventToMatch(event));
  }
  return [...byBundle.values()].sort((a, b) => {
    return String(a.agent || "").localeCompare(String(b.agent || "")) ||
      String(a.bundleId || "").localeCompare(String(b.bundleId || ""));
  });
}

function eventToMatch(event) {
  return {
    agent: event.session?.agent || null,
    bundleId: event.session?.bundleId || null,
    sha256: event.object?.sha256 || null,
    objectRelativePath: event.object?.relativePath || null,
    storeRelativePath: event.source?.storeRelativePath || null,
    originalPath: event.source?.originalPath || null,
    agentRelativePath: event.source?.agentRelativePath || null,
    matchedBy: event.session?.matchedBy || [],
    metadata: event.session?.metadata || null,
    dependencies: event.session?.dependencies || null
  };
}

function eventToBinding(config, event) {
  return {
    version: 2,
    syncRunId: event.syncRunId,
    syncedAt: event.syncedAt,
    boundAt: event.syncedAt,
    projectId: config.projectId,
    projectIdentity: config.projectIdentity,
    projectRemote: config.projectIdentity?.startsWith("git:") ? config.projectIdentity.slice("git:".length) : null,
    projectBranch: event.git?.branch || null,
    projectCommit: event.git?.commit || null,
    projectBaseCommit: event.git?.baseCommit || event.git?.commit || null,
    projectDirty: Boolean(event.git?.dirty),
    bundleId: event.session?.bundleId || null,
    agent: event.session?.agent || null,
    sessionId: event.session?.sessionId || null,
    title: event.session?.title || null,
    conversationAt: event.session?.conversationAt || event.syncedAt,
    commitMessage: event.commit?.message || null,
    authorName: event.commit?.authorName || "agent-sync",
    authorEmail: event.commit?.authorEmail || "agent-sync@example.invalid",
    sha256: event.object?.sha256 || null,
    objectRelativePath: event.object?.relativePath || null,
    storeRelativePath: event.source?.storeRelativePath || event.object?.relativePath || null,
    originalPath: event.source?.originalPath || null,
    agentRelativePath: event.source?.agentRelativePath || null,
    dependencies: event.session?.dependencies || null
  };
}

function bindingKey(binding) {
  return [
    binding.syncRunId,
    binding.projectCommit || binding.projectBranch || "",
    binding.agent,
    binding.bundleId,
    binding.sha256
  ].join(":");
}
