import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentRoot, scanSessions } from "./agents.js";
import { extractCodexSessionMetadata, registerRestoredCodexSession } from "./codex-session.js";
import { extractClaudeSessionMetadata, getClaudeRestoreRelativePath, registerRestoredClaudeSession } from "./claude-session.js";
import { getGitContext, getProjectRemote } from "./git.js";
import { normalizePath, sha256, writeFileAtomic } from "./utils.js";

export const LOCAL_TRANSFER_AGENTS = ["codex", "claude"];
export const DEFAULT_LOCAL_WATCH_INTERVAL_SECONDS = 2;

const TRANSFER_MARKER = "agentSyncLocalTransfer";

type LocalAgent = "codex" | "claude";
type LocalTransferMode = "clone" | "copy";
type PortableMessage = {
  role: "user" | "assistant";
  text: string;
  timestamp?: string | null;
};

type LocalTransferOptions = {
  mode: LocalTransferMode;
  from: LocalAgent;
  to: LocalAgent;
  dryRun: boolean;
};

type WatchOptions = LocalTransferOptions & {
  intervalSeconds: number;
  once: boolean;
  syncOnStart: boolean;
};

export function runLocalTransfer(gitRoot, config, rawOptions) {
  const options = normalizeLocalTransferOptions(rawOptions);
  const scan = scanSessions(gitRoot, config);
  const matches = scan.matches.filter((match) => match.agent === options.from);
  const stats = createTransferStats();
  const results = [];

  for (const match of matches) {
    const result = transferLocalMatch(gitRoot, config, match, options);
    stats[result.action] = (stats[result.action] || 0) + 1;
    results.push(result);
  }

  return {
    version: 1,
    mode: options.mode,
    from: options.from,
    to: options.to,
    dryRun: options.dryRun,
    scannedAt: new Date().toISOString(),
    candidates: matches.length,
    stats,
    results
  };
}

export function checkLocalTransferWatch(gitRoot, config, rawOptions, previousSignature = "") {
  const options = normalizeWatchOptions(rawOptions);
  const signature = getLocalTransferSignature(gitRoot, config, options);
  const isFirstCheck = !previousSignature;
  const changed = Boolean(previousSignature) && signature !== previousSignature;
  const shouldTransfer = changed || (isFirstCheck && options.syncOnStart);
  const result = shouldTransfer ? runLocalTransfer(gitRoot, config, options) : null;

  return {
    version: 1,
    checkedAt: new Date().toISOString(),
    mode: options.mode,
    from: options.from,
    to: options.to,
    dryRun: options.dryRun,
    changed,
    signature,
    result
  };
}

export function normalizeWatchOptions(rawOptions) {
  const options = normalizeLocalTransferOptions({
    ...rawOptions,
    mode: rawOptions.mode || "copy"
  }) as WatchOptions;
  options.intervalSeconds = normalizeWatchInterval(rawOptions.interval ?? rawOptions.intervalSeconds ?? DEFAULT_LOCAL_WATCH_INTERVAL_SECONDS);
  options.once = Boolean(rawOptions.once);
  options.syncOnStart = !rawOptions.noInitialSync;
  return options;
}

export function normalizeWatchInterval(value) {
  const interval = Number(value);
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new Error("watch --interval must be greater than 0 seconds");
  }
  return interval;
}

function normalizeLocalTransferOptions(rawOptions): LocalTransferOptions {
  const mode = rawOptions.mode === "clone" || rawOptions.mode === "copy" ? rawOptions.mode : null;
  if (!mode) {
    throw new Error("local transfer mode must be clone or copy");
  }
  const from = normalizeAgent(rawOptions.from);
  const to = normalizeAgent(rawOptions.to);
  if (!from || !to) {
    throw new Error("local transfer requires --from and --to as codex or claude");
  }
  if (from === to) {
    throw new Error("local transfer --from and --to must be different agents");
  }
  return {
    mode,
    from,
    to,
    dryRun: Boolean(rawOptions.dryRun)
  };
}

function normalizeAgent(value): LocalAgent | null {
  return value === "codex" || value === "claude" ? value : null;
}

function transferLocalMatch(gitRoot, config, match, options: LocalTransferOptions) {
  const sourcePath = match.absolutePath || match.originalPath;
  const content = readFileSync(sourcePath, "utf8");
  if (isGeneratedLocalTransfer(content)) {
    return createTransferResult("skipped_generated", match, null, "generated local transfer sessions are skipped");
  }

  const source = buildSourceSession(match, content);
  const targetId = getTargetSessionId(source, options);
  const targetPath = getTargetPath(options.to, config, targetId);
  const marker = createTransferMarker(options, match, source, targetId);
  const targetContent = renderTargetContent(options.to, config, gitRoot, source, targetId, marker);
  const existingContent = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : null;
  const hasExisting = existingContent !== null;

  if (hasExisting && !isSameTransferTarget(existingContent, marker)) {
    return createTransferResult("skipped_collision", match, targetPath, "target file exists and was not created for this source session");
  }
  if (options.mode === "clone" && hasExisting) {
    const registered = options.dryRun ? null : registerTargetSession(options.to, targetContent, targetPath, config, source);
    return createTransferResult("skipped_exists", match, targetPath, "clone already exists", registered);
  }
  if (hasExisting && existingContent === targetContent) {
    const registered = options.dryRun ? null : registerTargetSession(options.to, targetContent, targetPath, config, source);
    return createTransferResult("skipped_exists", match, targetPath, "target already up to date", registered);
  }

  const action = options.mode === "clone"
    ? "cloned"
    : hasExisting ? "updated" : "copied";
  if (!options.dryRun) {
    writeFileAtomic(targetPath, targetContent);
  }
  const registered = options.dryRun ? null : registerTargetSession(options.to, targetContent, targetPath, config, source);
  return createTransferResult(action, match, targetPath, `${options.mode}d ${source.agent} session to ${options.to}`, registered);
}

function buildSourceSession(match, content) {
  const metadata = match.metadata || (match.agent === "codex"
    ? extractCodexSessionMetadata(content)
    : extractClaudeSessionMetadata(content));
  const sessionId = metadata.sessionId || match.bundleId || sha256(content).slice(0, 32);
  const title = metadata.title || match.title || match.bundleId || sessionId;
  const messages = extractPortableMessages(match.agent, content, title);
  return {
    agent: match.agent,
    sessionId,
    title,
    content,
    messages,
    bundleId: match.bundleId,
    sha256: match.sha256,
    originalPath: match.originalPath,
    absolutePath: match.absolutePath,
    modifiedAt: match.modifiedAt,
    conversationAt: metadata.conversationAt || match.modifiedAt || null
  };
}

function getTargetSessionId(source, options: LocalTransferOptions) {
  if (options.mode === "copy" && source.sessionId && isPortableSessionId(source.sessionId)) {
    return source.sessionId;
  }
  return stableUuid(`agent-sync:${options.mode}:${source.agent}:${source.sessionId}:${options.to}`);
}

function getTargetPath(agent: LocalAgent, config, targetId: string) {
  const fileName = `${safeFileName(targetId)}.jsonl`;
  if (agent === "codex") {
    return join(getAgentRoot("codex"), "agent-sync", fileName);
  }
  return join(getAgentRoot("claude"), getClaudeRestoreRelativePath(join("agent-sync", fileName), config));
}

function renderTargetContent(agent: LocalAgent, config, gitRoot, source, targetId: string, marker) {
  const gitContext = getGitContext(gitRoot);
  const timestamp = new Date().toISOString();
  const projectRemote = getProjectRemote(gitRoot);
  if (agent === "codex") {
    return renderCodexTargetContent(config, gitContext, projectRemote, source, targetId, marker, timestamp);
  }
  return renderClaudeTargetContent(config, gitContext, projectRemote, source, targetId, marker, timestamp);
}

function renderCodexTargetContent(config, gitContext, projectRemote, source, targetId: string, marker, timestamp: string) {
  const lines = [
    {
      type: "session_meta",
      payload: {
        id: targetId,
        timestamp: source.conversationAt || timestamp,
        cwd: normalizePath(config.projectRoot),
        source: "agent-sync",
        model_provider: "OpenAI",
        thread_name: source.title,
        git: {
          branch: gitContext.branch || null,
          commit_hash: gitContext.headCommit || null,
          repository_url: projectRemote || null
        },
        [TRANSFER_MARKER]: marker
      }
    },
    {
      type: "turn_context",
      payload: {
        cwd: normalizePath(config.projectRoot)
      }
    },
    ...source.messages.map((message) => ({
      type: "response_item",
      payload: {
        type: "message",
        role: message.role,
        content: message.text
      }
    }))
  ];
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

function renderClaudeTargetContent(config, gitContext, projectRemote, source, targetId: string, marker, timestamp: string) {
  const base = {
    sessionId: targetId,
    cwd: normalizePath(config.projectRoot),
    gitBranch: gitContext.branch || null,
    gitCommit: gitContext.headCommit || null,
    gitRemote: projectRemote || null
  };
  const messages = source.messages.length
    ? source.messages
    : [{ role: "user" as const, text: source.title, timestamp: source.conversationAt }];
  return `${messages.map((message, index) => JSON.stringify({
    type: message.role,
    ...base,
    timestamp: message.timestamp || source.conversationAt || timestamp,
    message: {
      role: message.role,
      content: message.text
    },
    ...(index === 0 ? { [TRANSFER_MARKER]: marker } : {})
  })).join("\n")}\n`;
}

function registerTargetSession(agent: LocalAgent, content: string, targetPath: string, config, source) {
  const match = {
    bundleId: source.bundleId,
    title: source.title,
    sessionId: extractTargetSessionId(agent, content)
  };
  return agent === "codex"
    ? registerRestoredCodexSession(content, targetPath, config, match, getAgentRoot("codex"))
    : registerRestoredClaudeSession(content, targetPath, config, match);
}

function extractTargetSessionId(agent: LocalAgent, content: string) {
  const metadata = agent === "codex"
    ? extractCodexSessionMetadata(content)
    : extractClaudeSessionMetadata(content);
  return metadata.sessionId || null;
}

function createTransferMarker(options: LocalTransferOptions, match, source, targetId: string) {
  return {
    version: 1,
    mode: options.mode,
    from: options.from,
    to: options.to,
    sourceSessionId: source.sessionId,
    targetSessionId: targetId,
    sourceBundleId: source.bundleId || match.bundleId || null,
    sourceSha256: source.sha256 || match.sha256 || null,
    sourcePath: source.originalPath || match.originalPath || null,
    createdAt: source.conversationAt || source.modifiedAt || null
  };
}

function createTransferResult(action: string, match, targetPath, message: string, registered = null) {
  return {
    action,
    sourceAgent: match.agent,
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
    copied: 0,
    updated: 0,
    skipped_exists: 0,
    skipped_generated: 0,
    skipped_collision: 0,
    error: 0
  };
}

function getLocalTransferSignature(gitRoot, config, options: LocalTransferOptions) {
  const scan = scanSessions(gitRoot, config);
  const entries = [];
  for (const match of scan.matches.filter((item) => item.agent === options.from)) {
    let generated = false;
    try {
      generated = isGeneratedLocalTransfer(readFileSync(match.absolutePath || match.originalPath, "utf8"));
    } catch {
      generated = false;
    }
    if (!generated) {
      entries.push(`${match.bundleId}:${match.sha256}:${match.modifiedAt}`);
    }
  }
  return sha256(entries.sort().join("\n"));
}

function isSameTransferTarget(content: string, marker) {
  const existing = findTransferMarker(content);
  return Boolean(existing &&
    existing.mode === marker.mode &&
    existing.from === marker.from &&
    existing.to === marker.to &&
    existing.sourceSessionId === marker.sourceSessionId &&
    existing.targetSessionId === marker.targetSessionId);
}

function isGeneratedLocalTransfer(content: string) {
  return Boolean(findTransferMarker(content));
}

function findTransferMarker(content: string) {
  for (const item of readJsonlItems(content)) {
    const direct = item?.[TRANSFER_MARKER];
    if (direct && typeof direct === "object") {
      return direct;
    }
    const payloadMarker = item?.payload?.[TRANSFER_MARKER];
    if (payloadMarker && typeof payloadMarker === "object") {
      return payloadMarker;
    }
  }
  return null;
}

function extractPortableMessages(agent, content: string, fallbackTitle: string): PortableMessage[] {
  const messages = [];
  for (const item of readJsonlItems(content)) {
    if (agent === "codex") {
      const payload = item?.payload;
      if (item?.type === "response_item" && payload?.type === "message" && isMessageRole(payload.role)) {
        addPortableMessage(messages, payload.role, extractText(payload.content));
      } else if (item?.type === "event_msg" && payload?.type === "user_message") {
        addPortableMessage(messages, "user", extractText(payload.message || payload.text));
      }
    } else if (agent === "claude") {
      const role = item?.message?.role || item?.type;
      if (isMessageRole(role)) {
        addPortableMessage(messages, role, extractText(item?.message?.content));
      }
    }
  }
  if (!messages.length && fallbackTitle) {
    addPortableMessage(messages, "user", fallbackTitle);
  }
  return messages;
}

function addPortableMessage(messages: PortableMessage[], role: "user" | "assistant", text: string) {
  const normalized = text.trim();
  if (normalized) {
    messages.push({ role, text: normalized });
  }
}

function extractText(value): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(extractText).filter(Boolean).join("\n");
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  if (typeof value.text === "string") {
    return value.text;
  }
  if (typeof value.message === "string") {
    return value.message;
  }
  if (typeof value.content === "string" || Array.isArray(value.content)) {
    return extractText(value.content);
  }
  if (value.type === "tool_use" && value.name) {
    return `[tool_use ${value.name}] ${JSON.stringify(value.input || {})}`;
  }
  return "";
}

function isMessageRole(value): value is "user" | "assistant" {
  return value === "user" || value === "assistant";
}

function readJsonlItems(content: string) {
  const items = [];
  for (const line of String(content || "").split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      items.push(JSON.parse(line));
    } catch {
      // Ignore partial session lines.
    }
  }
  return items;
}

function isPortableSessionId(value: string) {
  return /^[A-Za-z0-9._:-]{1,120}$/.test(value);
}

function safeFileName(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 160) || stableUuid(value);
}

function stableUuid(value: string) {
  const hex = sha256(value).slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}
