import { extractCodexSessionMetadata } from "./codex-session.js";
import { extractClaudeSessionMetadata } from "./claude-session.js";
import { extractSessionDependencies } from "./dependencies.js";

const IR_VERSION = 1;

export function convertSessionToIr(agent, content, context: Record<string, any> = {}) {
  if (agent === "codex") {
    return codexToIr(content, context);
  }
  if (agent === "claude") {
    return claudeToIr(content, context);
  }
  throw new Error(`unsupported agent for IR conversion: ${agent}`);
}

export function exportIrReadable(ir, options: Record<string, any> = {}) {
  const target = options.to || "ir";
  const lines = [
    {
      type: "agent_sync_ir_export",
      version: 1,
      target,
      sourceAgent: ir.conversation.sourceAgent,
      conversationId: ir.conversation.id,
      title: ir.conversation.title,
      exportedAt: new Date().toISOString(),
      mode: options.mode || "readable"
    },
    ...ir.events.map((event) => ({
      type: event.type,
      role: event.role || null,
      name: event.name || null,
      content: event.content || null,
      input: event.input || null,
      output: event.output || null,
      workdir: event.workdir || null,
      createdAt: event.createdAt || null,
      source: event.source
    }))
  ];
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

function codexToIr(content, context) {
  const metadata = extractCodexSessionMetadata(content);
  const events = [];
  const raw = readJsonlItems(content);
  for (const item of raw) {
    const payload = item.payload || {};
    if (item.type === "response_item" && payload.type === "message") {
      events.push({
        type: "message",
        role: payload.role || "assistant",
        content: normalizeMessageContent(payload.content),
        createdAt: payload.timestamp || null,
        source: "codex:response_item.message",
        vendor: item
      });
    } else if (item.type === "response_item" && payload.type === "function_call") {
      const input = parseMaybeJson(payload.arguments);
      events.push({
        type: "tool_call",
        id: payload.call_id || payload.id || null,
        name: payload.name || null,
        input,
        workdir: input?.workdir || input?.cwd || null,
        createdAt: payload.timestamp || null,
        source: "codex:response_item.function_call",
        vendor: item
      });
    } else if (item.type === "response_item" && (payload.type === "function_call_output" || payload.type === "tool_result")) {
      events.push({
        type: "tool_result",
        id: payload.call_id || payload.id || null,
        output: payload.output || payload.content || null,
        createdAt: payload.timestamp || null,
        source: "codex:response_item.tool_result",
        vendor: item
      });
    }
  }
  return createIr("codex", metadata, content, events, context, raw);
}

function claudeToIr(content, context) {
  const metadata = extractClaudeSessionMetadata(content);
  const events = [];
  const raw = readJsonlItems(content);
  for (const item of raw) {
    const role = item.message?.role || item.type || "assistant";
    const messageContent = item.message?.content ?? item.content;
    if (typeof messageContent === "string") {
      events.push({
        type: "message",
        role,
        content: messageContent,
        createdAt: item.timestamp || null,
        source: "claude:message.text",
        vendor: item
      });
      continue;
    }
    if (!Array.isArray(messageContent)) {
      continue;
    }
    for (const part of messageContent) {
      if (part?.type === "text") {
        events.push({
          type: "message",
          role,
          content: part.text || "",
          createdAt: item.timestamp || null,
          source: "claude:message.text",
          vendor: item
        });
      } else if (part?.type === "tool_use") {
        events.push({
          type: "tool_call",
          id: part.id || null,
          name: part.name || null,
          input: part.input || null,
          workdir: part.input?.workdir || part.input?.cwd || null,
          createdAt: item.timestamp || null,
          source: "claude:tool_use",
          vendor: item
        });
      } else if (part?.type === "tool_result") {
        events.push({
          type: "tool_result",
          id: part.tool_use_id || part.id || null,
          output: part.content || null,
          createdAt: item.timestamp || null,
          source: "claude:tool_result",
          vendor: item
        });
      }
    }
  }
  return createIr("claude", metadata, content, events, context, raw);
}

function createIr(agent, metadata, content, events, context, raw) {
  const firstGit = metadata.gitContexts?.[0] || {};
  return {
    version: IR_VERSION,
    conversation: {
      id: metadata.sessionId || context.bundleId || null,
      sourceAgent: agent,
      title: metadata.title || context.title || context.bundleId || null,
      createdAt: metadata.conversationAt || null,
      updatedAt: metadata.conversationAt || null
    },
    project: {
      cwd: metadata.projectRoots?.[0] || context.projectRoot || null,
      identity: context.projectIdentity || null,
      branch: firstGit.branch || context.projectBranch || null,
      commit: firstGit.commit || context.projectCommit || null,
      dirty: Boolean(context.projectDirty)
    },
    runtime: {
      provider: metadata.modelProvider || null,
      model: null,
      sandbox: null,
      approvalPolicy: null
    },
    events,
    dependencies: extractSessionDependencies(agent, content),
    provenance: {
      sourcePath: context.sourcePath || null,
      sourceHash: context.sha256 || null,
      adapter: `${agent}@1`
    },
    vendor: {
      eventCount: raw.length,
      raw
    }
  };
}

function readJsonlItems(content) {
  return String(content || "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { type: "invalid", raw: line };
      }
    });
}

function normalizeMessageContent(value) {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((part) => {
      if (typeof part === "string") {
        return part;
      }
      return part?.text || part?.content || JSON.stringify(part);
    }).join("");
  }
  if (value === null || value === undefined) {
    return "";
  }
  return JSON.stringify(value);
}

function parseMaybeJson(value) {
  if (typeof value !== "string") {
    return value || null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
}
