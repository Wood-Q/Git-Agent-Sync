import { basename, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { getAgentRoot, scanSessions } from "./agents.js";
import { extractCodexSessionMetadata, registerRestoredCodexSession, resolveCodexHome } from "./codex-session.js";
import { normalizePath, sha256, walk, writeFileAtomic } from "./utils.js";

export const DEFAULT_LOCAL_WATCH_INTERVAL_SECONDS = 2;
export const DEFAULT_CODEX_MODEL_PROVIDER = "openai";

const TRANSFER_MARKER = "agentSyncLocalTransfer";

type LocalTransferOptions = {
  targetProvider: string;
  dryRun: boolean;
  register: boolean;
};

type WatchOptions = LocalTransferOptions & {
  intervalSeconds: number;
  once: boolean;
  syncOnStart: boolean;
};

type CloneIndexEntry = {
  path: string;
  content: string;
};

export function runLocalTransfer(gitRoot, config, rawOptions) {
  const options = normalizeLocalTransferOptions(rawOptions);
  const scan = scanSessions(gitRoot, config);
  const matches = scan.matches.filter((match) => match.agent === "codex");
  const cloneIndex = buildCloneIndex(matches, options.targetProvider);
  const stats = createTransferStats();
  const results = [];

  for (const match of matches) {
    const result = cloneCodexProviderMatch(config, match, options, cloneIndex);
    stats[result.action] = (stats[result.action] || 0) + 1;
    results.push(result);
  }

  return {
    version: 1,
    mode: "clone",
    provider: options.targetProvider,
    dryRun: options.dryRun,
    scannedAt: new Date().toISOString(),
    candidates: matches.length,
    stats,
    results
  };
}

export function runLocalRepair(gitRoot, config, rawOptions: Record<string, any> = {}) {
  const options = normalizeRepairOptions(rawOptions);
  const codexRoot = getAgentRoot("codex");
  const results = [];
  const stats = {
    repaired: 0,
    dry_run: 0,
    skipped_foreign: 0,
    skipped_unmarked: 0,
    error: 0
  };

  for (const path of walk(codexRoot).filter((file) => file.endsWith(".jsonl"))) {
    try {
      const content = readFileSync(path, "utf8");
      const meta = getFirstSessionMeta(content);
      const marker = meta.payload?.[TRANSFER_MARKER];
      if (!marker || marker.type !== "codex-provider-clone") {
        stats.skipped_unmarked += 1;
        continue;
      }
      if (!isCurrentProjectClone(config, meta.payload)) {
        stats.skipped_foreign += 1;
        continue;
      }
      const match = buildRegistrationMatch({ bundleId: marker.sourceSessionId || meta.payload.id }, content);
      const registered = options.dryRun
        ? { registered: false, reason: "dry-run", sessionId: meta.payload.id }
        : registerRestoredCodexSession(content, path, config, match, codexRoot);
      stats[options.dryRun ? "dry_run" : "repaired"] += 1;
      results.push({
        action: options.dryRun ? "dry_run" : "repaired",
        path: normalizePath(path),
        sessionId: meta.payload.id,
        provider: meta.payload.model_provider || null,
        registered
      });
    } catch (error) {
      stats.error += 1;
      results.push({
        action: "error",
        path: normalizePath(path),
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    version: 1,
    mode: "repair",
    dryRun: options.dryRun,
    scannedAt: new Date().toISOString(),
    stats,
    results
  };
}

export function checkLocalTransferWatch(gitRoot, config, rawOptions, previousProvider = "") {
  const options = normalizeWatchOptions(rawOptions);
  const provider = detectCodexModelProvider(options.targetProvider);
  const isFirstCheck = !previousProvider;
  const changed = Boolean(previousProvider) && provider !== previousProvider;
  const shouldTransfer = changed || (isFirstCheck && options.syncOnStart);
  const result = shouldTransfer
    ? runLocalTransfer(gitRoot, config, { ...options, targetProvider: provider })
    : null;

  return {
    version: 1,
    checkedAt: new Date().toISOString(),
    provider,
    previousProvider,
    dryRun: options.dryRun,
    changed,
    result
  };
}

export function normalizeWatchOptions(rawOptions) {
  const options = normalizeLocalTransferOptions(rawOptions) as WatchOptions;
  options.intervalSeconds = normalizeWatchInterval(rawOptions.interval ?? rawOptions.intervalSeconds ?? DEFAULT_LOCAL_WATCH_INTERVAL_SECONDS);
  options.once = Boolean(rawOptions.once);
  options.syncOnStart = !rawOptions.noInitialSync;
  return options;
}

export function normalizeWatchInterval(value) {
  const interval = Number(value);
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new Error("--interval must be a positive number of seconds");
  }
  return interval;
}

function normalizeLocalTransferOptions(rawOptions): LocalTransferOptions {
  if (rawOptions.from || rawOptions.to || rawOptions.mode) {
    throw new Error("local Codex provider sync uses an optional target provider argument; --from, --to, and --mode are not supported");
  }
  return {
    targetProvider: detectCodexModelProvider(rawOptions.targetProvider || rawOptions.provider || ""),
    dryRun: Boolean(rawOptions.dryRun),
    register: !rawOptions.noRegister
  };
}

function normalizeRepairOptions(rawOptions) {
  return {
    dryRun: Boolean(rawOptions.dryRun)
  };
}

function detectCodexModelProvider(explicit = "") {
  const normalized = String(explicit || "").trim();
  if (normalized) {
    return normalized;
  }

  const codexHome = resolveCodexHome(getAgentRoot("codex"));
  const configPath = join(codexHome, "config.toml");
  if (!existsSync(configPath)) {
    throw new Error(`missing Codex config file: ${configPath}`);
  }

  const text = readFileSync(configPath, "utf8");
  const quoted = text.match(/^\s*model_provider\s*=\s*"([^"]+)"/m);
  if (quoted?.[1]) {
    return quoted[1];
  }
  const singleQuoted = text.match(/^\s*model_provider\s*=\s*'([^']+)'/m);
  if (singleQuoted?.[1]) {
    return singleQuoted[1];
  }
  return DEFAULT_CODEX_MODEL_PROVIDER;
}

function buildCloneIndex(matches, targetProvider: string) {
  const index = new Map<string, CloneIndexEntry>();
  for (const match of matches) {
    const path = match.absolutePath || match.originalPath;
    try {
      const content = readFileSync(path, "utf8");
      const meta = getFirstSessionMeta(content);
      const payload = meta.payload;
      const clonedFrom = payload.cloned_from;
      if (payload.model_provider === targetProvider && typeof clonedFrom === "string" && clonedFrom) {
        index.set(clonedFrom, { path, content });
      }
    } catch {
      // Ignore malformed sessions when building the duplicate guard.
    }
  }
  return index;
}

function cloneCodexProviderMatch(config, match, options: LocalTransferOptions, cloneIndex: Map<string, CloneIndexEntry>) {
  const sourcePath = match.absolutePath || match.originalPath;
  let content = "";
  try {
    content = readFileSync(sourcePath, "utf8");
    const meta = getFirstSessionMeta(content);
    const payload = meta.payload;
    const currentProvider = payload.model_provider || payload.modelProvider || "";
    const sourceId = payload.id;

    if (typeof sourceId !== "string" || !sourceId) {
      return createTransferResult("error", match, null, "session id missing from session_meta");
    }
    if (currentProvider === options.targetProvider) {
      return createTransferResult("skipped_target", match, null, "already on target provider");
    }

    const existingClone = cloneIndex.get(sourceId);
    if (existingClone) {
      const registered = registerLocalClone(config, match, existingClone.content, existingClone.path, options);
      return createTransferResult("skipped_exists", match, existingClone.path, "already cloned for target provider", registered);
    }

    const targetId = stableUuid(`agent-sync:codex-provider:${sourceId}:${options.targetProvider}`);
    const targetPath = getTargetPath(sourcePath, payload, targetId);
    const targetContent = renderCodexProviderClone(content, meta.index, payload, {
      sourceId,
      targetId,
      sourceProvider: currentProvider,
      targetProvider: options.targetProvider,
      sourcePath,
      sourceSha256: match.sha256 || sha256(content)
    });

    if (existsSync(targetPath)) {
      const existingContent = readFileSync(targetPath, "utf8");
      if (isSameCodexProviderClone(existingContent, sourceId, options.targetProvider)) {
        cloneIndex.set(sourceId, { path: targetPath, content: existingContent });
        const registered = registerLocalClone(config, match, existingContent, targetPath, options);
        return createTransferResult("skipped_exists", match, targetPath, "already cloned for target provider", registered);
      }
      return createTransferResult("skipped_collision", match, targetPath, "target rollout file exists for a different session");
    }

    if (!options.dryRun) {
      writeFileAtomic(targetPath, targetContent);
    }
    cloneIndex.set(sourceId, { path: targetPath, content: targetContent });
    const registered = registerLocalClone(config, match, targetContent, targetPath, options);
    return createTransferResult("cloned", match, targetPath, `cloned Codex session to provider ${options.targetProvider}`, registered);
  } catch (error) {
    return createTransferResult("error", match, null, error instanceof Error ? error.message : String(error));
  }
}

function registerLocalClone(config, match, content, targetPath, options: LocalTransferOptions) {
  if (options.dryRun) {
    return { registered: false, reason: "dry-run" };
  }
  if (!options.register) {
    return { registered: false, reason: "disabled" };
  }
  return registerRestoredCodexSession(content, targetPath, config, buildRegistrationMatch(match, content), getAgentRoot("codex"));
}

function getFirstSessionMeta(content: string) {
  const records = parseJsonlRecords(content);
  for (let index = 0; index < records.length; index += 1) {
    const item = records[index].value;
    if (item?.type === "session_meta" && item.payload && typeof item.payload === "object") {
      return { index, item, payload: { ...item.payload }, records };
    }
  }
  throw new Error("session_meta not found");
}

function renderCodexProviderClone(content: string, metaIndex: number, payload, marker) {
  const records = parseJsonlRecords(content);
  const now = new Date().toISOString();
  const clonedPayload = {
    ...payload,
    id: marker.targetId,
    model_provider: marker.targetProvider,
    cloned_from: marker.sourceId,
    original_provider: marker.sourceProvider,
    clone_timestamp: now,
    [TRANSFER_MARKER]: {
      version: 1,
      type: "codex-provider-clone",
      sourceSessionId: marker.sourceId,
      targetSessionId: marker.targetId,
      sourceProvider: marker.sourceProvider || null,
      targetProvider: marker.targetProvider,
      sourcePath: normalizePath(marker.sourcePath),
      sourceSha256: marker.sourceSha256,
      createdAt: now
    }
  };

  return records.map((record, index) => {
    if (index !== metaIndex) {
      return record.raw;
    }
    return JSON.stringify({
      ...record.value,
      payload: clonedPayload
    });
  }).join("\n") + "\n";
}

function getTargetPath(sourcePath: string, payload, targetId: string) {
  const timestamp = getCodexTimestampToken(sourcePath, payload);
  const [year, month, day] = timestamp.split("T", 1)[0].split("-");
  return join(getAgentRoot("codex"), year, month, day, `rollout-${timestamp}-${targetId}.jsonl`);
}

function getCodexTimestampToken(sourcePath: string, payload) {
  const filename = basename(sourcePath);
  const match = filename.match(/^rollout-(.+)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i);
  if (match?.[1]) {
    return match[1];
  }

  const parsed = Date.parse(payload.timestamp || "");
  const date = Number.isNaN(parsed) ? new Date() : new Date(parsed);
  return date.toISOString().slice(0, 19).replace(/:/g, "-");
}

function isSameCodexProviderClone(content: string, sourceId: string, targetProvider: string) {
  try {
    const payload = getFirstSessionMeta(content).payload;
    return payload.cloned_from === sourceId && payload.model_provider === targetProvider;
  } catch {
    return false;
  }
}

function buildRegistrationMatch(match, content: string) {
  const metadata = extractCodexSessionMetadata(content);
  return {
    bundleId: match.bundleId,
    title: metadata.title || match.title || match.bundleId,
    sessionId: metadata.sessionId
  };
}

function isCurrentProjectClone(config, payload) {
  const cwd = payload.cwd || payload.projectRoot || "";
  if (!cwd) {
    return false;
  }
  return normalizePath(cwd) === normalizePath(config.projectRoot);
}

function createTransferResult(action: string, match, targetPath, message: string, registered = null) {
  return {
    action,
    sourceAgent: "codex",
    sourceBundleId: match.bundleId || null,
    sourcePath: match.originalPath || match.absolutePath || null,
    targetPath: targetPath ? normalizePath(targetPath) : null,
    message,
    registered
  };
}

function createTransferStats() {
  return {
    cloned: 0,
    skipped_exists: 0,
    skipped_target: 0,
    skipped_collision: 0,
    error: 0
  };
}

function parseJsonlRecords(content: string) {
  return String(content || "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((raw) => {
      try {
        return { raw, value: JSON.parse(raw) };
      } catch {
        return { raw, value: null };
      }
    });
}

function stableUuid(value: string) {
  const hex = sha256(value).slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}
