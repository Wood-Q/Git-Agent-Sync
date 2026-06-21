// Rendering, formatting, and index-selection helpers for the CLI.
//
// These are pure presentation/query helpers that the command layer in cli.ts
// used to keep inline. They have no command-specific side effects and depend
// only on the low-level agent/args modules, so they lift out cleanly into a
// single module. Extracting them shrinks cli.ts and makes the log/show/restore
// display logic unit-testable in isolation.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  formatBindingFiltersForCommand,
  formatSelector,
  hasActiveBindingFilters
} from "./args.js";
import { cleanClaudeTitle, extractClaudeSessionMetadata } from "./claude-session.js";
import { cleanCodexTitle, extractCodexSessionMetadata, loadCodexSessionTitles } from "./codex-session.js";
import { readAllBindings } from "./bindings.js";

// --- log count limiting --------------------------------------------------

export function limitBindings(bindings, options) {
  const maxCount = parseMaxCount(options);
  return maxCount ? bindings.slice(0, maxCount) : bindings;
}

export function parseMaxCount(options) {
  const value = options.maxCount;
  if (value === null || value === undefined) {
    return null;
  }
  if (!/^\d+$/.test(String(value)) || Number(value) < 1) {
    throw new Error("log count must be a positive number");
  }
  return Number(value);
}

// --- index selection (show / restore) ------------------------------------

export function selectBindingByIndex(bindings, index, selector, filters = {}) {
  if (!bindings.length) {
    return null;
  }
  if (index > bindings.length) {
    throw new Error(`show index ${index} is out of range for ${formatQueryScope(selector, filters)} (${bindings.length} binding(s))`);
  }
  return bindings[index - 1] || null;
}

export function parseRequiredIndex(args, options, selector, filters = {}) {
  const value = options.index ?? args[0];
  if (value === null || value === undefined) {
    throw new Error(`show ${formatQueryScope(selector, filters)} requires an index`);
  }
  if (!/^\d+$/.test(String(value)) || Number(value) < 1) {
    throw new Error("show index must be a positive number");
  }
  return Number(value);
}

export function findBindingByBundleId(config, bundleId) {
  if (!bundleId) {
    throw new Error("show requires a bundle id or selector index");
  }
  return readAllBindings(config).find((binding) => binding.bundleId === bundleId) || null;
}

// --- title resolution ----------------------------------------------------

export function getBindingTitle(config, binding, titles) {
  const bindingTitle = binding.agent === "codex"
    ? cleanCodexTitle(binding.title)
    : cleanClaudeTitle(binding.title);
  if (bindingTitle) {
    return compactTitle(bindingTitle);
  }
  if (binding.agent === "codex") {
    const title = titles.get(binding.sessionId) || getStoredSessionTitle(config, binding);
    if (title) {
      return compactTitle(title);
    }
  }
  const storedTitle = getStoredSessionTitle(config, binding);
  if (storedTitle) {
    return compactTitle(storedTitle);
  }
  return binding.bundleId;
}

export function getStoredSessionTitle(config, binding) {
  if (!binding.storeRelativePath) {
    return null;
  }
  try {
    const content = readFileSync(join(config.storePath, binding.storeRelativePath), "utf8");
    if (binding.agent === "codex") {
      return extractCodexSessionMetadata(content).title || null;
    }
    if (binding.agent === "claude") {
      return extractClaudeSessionMetadata(content).title || null;
    }
  } catch {
    return null;
  }
  return null;
}

export function compactTitle(value) {
  return value.replace(/\s+/g, " ").trim().slice(0, 96);
}

export function fallbackBindingCommitMessage(config, binding) {
  const shortCommit = binding.projectCommit ? binding.projectCommit.slice(0, 12) : "no-head";
  const branch = binding.projectBranch || "detached";
  return `sync ${config.projectName || "project"} agent sessions at ${shortCommit} (${branch})`;
}

// --- scope formatting ----------------------------------------------------

export function formatSelectorForCommand(selector) {
  if (selector.type === "latest") {
    return "--latest";
  }
  if (selector.type === "current") {
    return "--current";
  }
  return `--${selector.type} ${selector.value}`;
}

export function formatQueryScope(selector, filters = {}) {
  const parts = [];
  if (selector) {
    parts.push(formatSelector(selector));
  }
  const filterEntries = Object.entries(filters || {});
  if (filterEntries.length) {
    parts.push(filterEntries.map(([name, value]) => `${name} ${value}`).join(", "));
  }
  return parts.length ? parts.join(", ") : "log";
}

export function formatQueryScopeForCommand(selector, filters = {}) {
  const parts = [];
  if (selector) {
    parts.push(formatSelectorForCommand(selector));
  }
  const filterCommand = formatBindingFiltersForCommand(filters);
  if (filterCommand) {
    parts.push(filterCommand);
  }
  return parts.join(" ");
}

// --- date formatting (git-log style) -------------------------------------

export function formatGitDate(value) {
  const date = value ? new Date(value) : new Date(0);
  if (!Number.isFinite(date.getTime())) {
    return "unknown";
  }
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(absOffset / 60)).padStart(2, "0")}${String(absOffset % 60).padStart(2, "0")}`;
  return `${weekdays[date.getDay()]} ${months[date.getMonth()]} ${String(date.getDate()).padStart(2, " ")} ${formatTimePart(date)} ${date.getFullYear()} ${offset}`;
}

export function formatTimePart(date) {
  return [
    date.getHours(),
    date.getMinutes(),
    date.getSeconds()
  ].map((value) => String(value).padStart(2, "0")).join(":");
}

// --- binding list rendering ----------------------------------------------

export function renderBindings(config, bindings, selector, filters, options: Record<string, any> = {}) {
  return options.oneline
    ? renderBindingsOneline(config, bindings)
    : renderBindingsFull(config, bindings, selector, filters);
}

export function renderBindingsOneline(config, bindings) {
  const titles = loadCodexSessionTitles();
  return bindings.map((binding, index) => {
    const title = getBindingTitle(config, binding, titles);
    const message = binding.commitMessage || fallbackBindingCommitMessage(config, binding);
    return `${index + 1}  ${title}  ${message}`;
  }).join("\n");
}

export function renderBindingsFull(config, bindings, selector, filters = {}) {
  const titles = loadCodexSessionTitles();
  const lines = [];
  const scoped = selector || hasActiveBindingFilters(filters);
  const commandScope = formatQueryScopeForCommand(selector, filters);
  if (scoped) {
    lines.push(`${selector ? "selector" : "filters"}: ${formatQueryScope(selector, filters)}`);
    lines.push(`bindings: ${bindings.length}`);
    lines.push(`restore:  git agent-sync restore ${commandScope} <index>`);
    lines.push(`show:     git agent-sync show ${commandScope} <index>`);
    lines.push("");
  } else {
    lines.push(`bindings: ${bindings.length}`);
    lines.push("restore:  git agent-sync restore --index <index>");
    lines.push("show:     git agent-sync show <bundle-id>");
    lines.push("");
  }
  bindings.forEach((binding, index) => {
    const title = getBindingTitle(config, binding, titles);
    if (index > 0) {
      lines.push("");
    }
    lines.push(`Index: ${index + 1}`);
    lines.push(`Title: ${title}`);
    lines.push(`Author: ${binding.authorName || "agent-sync"} <${binding.authorEmail || "agent-sync@example.invalid"}>`);
    lines.push(`Date:   ${formatGitDate(binding.conversationAt || binding.syncedAt || binding.boundAt)}`);
    lines.push("");
    lines.push(`    ${binding.commitMessage || fallbackBindingCommitMessage(config, binding)}`);
    lines.push("");
    lines.push(`    Bundle: ${binding.bundleId}`);
    if (!scoped) {
      lines.push(`    Restore: git agent-sync restore --index ${index + 1}`);
      lines.push(`    Show:    git agent-sync show ${binding.bundleId}`);
    }
  });
  return lines.join("\n");
}

export function printBindingDetail(config, binding) {
  const title = getBindingTitle(config, binding, loadCodexSessionTitles());
  console.log(`title:          ${title}`);
  console.log(`agent:          ${binding.agent}`);
  console.log(`bundle:         ${binding.bundleId}`);
  console.log(`session:        ${binding.sessionId || "unknown"}`);
  console.log(`project commit: ${binding.projectCommit || "unknown"}`);
  console.log(`project branch: ${binding.projectBranch || "detached"}`);
  console.log(`project dirty:  ${binding.projectDirty ? "true" : "false"}`);
  console.log(`synced at:      ${binding.syncedAt || binding.boundAt || "unknown"}`);
  console.log(`sync run:       ${binding.syncRunId || "unknown"}`);
  console.log(`sha256:         ${binding.sha256 || "unknown"}`);
  console.log(`store path:     ${binding.storeRelativePath}`);
  console.log(`original path:  ${binding.originalPath}`);
  console.log(`restore:        git agent-sync restore ${binding.bundleId}`);
}

// --- pager ----------------------------------------------------------------

export function pageOrPrint(text) {
  if (!text) {
    console.log("");
    return;
  }
  if (!shouldUsePager(text)) {
    console.log(text);
    return;
  }
  const pager = process.env.GIT_PAGER || process.env.PAGER || "less";
  const result = spawnSync(pager, ["-R"], {
    input: text,
    stdio: ["pipe", "inherit", "inherit"],
    shell: true
  });
  if (result.error || result.status !== 0) {
    console.log(text);
  }
}

export function shouldUsePager(text) {
  if (!process.stdout.isTTY) {
    return false;
  }
  const rows = process.stdout.rows || 24;
  return text.split(/\r?\n/).length > rows;
}
