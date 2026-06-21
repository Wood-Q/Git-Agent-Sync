import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentRoot } from "./agents.js";
import { filterBindings, queryBindings, readAllBindings } from "./bindings.js";
import { hasActiveBindingFilters, parseBindingFilters, parseSelector, formatSelector } from "./args.js";
import { findProjectBundle } from "./store.js";
import { adaptCodexSessionContent, getCodexContentProjectMatch, registerRestoredCodexSession } from "./codex-session.js";
import {
  adaptClaudeSessionContent,
  getClaudeContentProjectMatch,
  getClaudeRestoreRelativePath,
  registerRestoredClaudeSession
} from "./claude-session.js";
import { getMissingSkillWarnings } from "./dependencies.js";
import { expandHome, normalizePath, readJson, toSlash, writeFileAtomic } from "./utils.js";

export function restoreCommand(gitRoot, args, options, config) {
  const bundleId = args[0];
  const selector = parseSelector(options, { requireSelector: false });
  const filters = parseBindingFilters(options, selector);
  const scoped = Boolean(selector) || hasActiveBindingFilters(filters);
  const selectorIndex = parseRestoreIndex(args, options, scoped);
  const logIndex = parseRestoreIndex([], options, false);
  const restoreModes = [Boolean(bundleId && !scoped), Boolean(options.all), scoped, Boolean(logIndex && !scoped)].filter(Boolean).length;
  if (restoreModes !== 1) {
    throw new Error("restore requires exactly one of a bundle id, --all, --index, --latest, --current, --branch, --commit, or filters");
  }

  if (scoped) {
    const allMatches = getFilteredBindings(config, selector, filters, gitRoot);
    const matches = selectRestoreMatches(allMatches, selectorIndex, selector, filters);
    if (!matches.length) {
      throw new Error(`no bindings found for ${formatQueryScope(selector, filters)}`);
    }
    printJsonResult(options, restoreMatches(config, matches, options));
    return;
  }

  if (logIndex) {
    const matches = selectRestoreMatches(readAllBindings(config), logIndex, null);
    if (!matches.length) {
      throw new Error("no bindings found for log");
    }
    printJsonResult(options, restoreMatches(config, matches, options));
    return;
  }

  const bundle = findProjectBundle(config);
  if (!bundle) {
    throw new Error("no manifest found in sidecar store. Run pull first.");
  }

  const manifest = readJson(bundle.manifestPath);
  const matches = options.all ? manifest.matches : manifest.matches.filter((item) => item.bundleId === bundleId);
  if (!matches.length) {
    throw new Error(`no bundle found for "${bundleId}"`);
  }

  printJsonResult(options, restoreMatches(config, matches, options));
}

export function parseRestoreIndex(args, options, hasSelector) {
  const value = options.index ?? (hasSelector ? args[0] : null);
  if (value === null || value === undefined) {
    return null;
  }
  if (!/^\d+$/.test(String(value))) {
    throw new Error("restore index must be a positive number");
  }
  const index = Number(value);
  if (index < 1) {
    throw new Error("restore index must be a positive number");
  }
  return index;
}

export function selectRestoreMatches(matches, index, selector, filters = {}) {
  if (!index) {
    return matches;
  }
  if (index > matches.length) {
    const scope = formatQueryScope(selector, filters);
    throw new Error(`restore index ${index} is out of range for ${scope} (${matches.length} binding(s))`);
  }
  return matches[index - 1] ? [matches[index - 1]] : [];
}

function getFilteredBindings(config, selector, filters, gitRoot) {
  const bindings = selector ? queryBindings(config, selector, gitRoot) : readAllBindings(config);
  return hasActiveBindingFilters(filters) ? filterBindings(bindings, filters) : bindings;
}

function formatQueryScope(selector, filters = {}) {
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

function restoreMatches(config, matches, options: Record<string, any> = {}) {
  const results = [];
  for (const match of matches) {
    const source = join(config.storePath, match.storeRelativePath);
    const projectMatch = getRestoreProjectMatch(config, match, source);
    if (!projectMatch.matched) {
      const skipped = {
        status: "skipped",
        agent: match.agent,
        bundleId: match.bundleId,
        source,
        reason: projectMatch.reason
      };
      results.push(skipped);
      printRestoreLine(options, `skipped ${match.agent}: ${source} (${projectMatch.reason})`);
      continue;
    }
    const warnings = getRestoreWarnings(match);
    printRestoreWarnings(options, warnings);
    const target = getRestoreTarget(config, match);
    mkdirSync(dirname(target), { recursive: true });
    const result: any = restoreSessionFile(config, match, source, target, options);
    const suffix = formatRestoreSuffix(result);
    printRestoreLine(options, `restored ${match.agent}: ${target}${suffix}`);
    const registered = registerRestoredSession(config, match, target, result.content, options);
    results.push({
      status: "restored",
      agent: match.agent,
      bundleId: match.bundleId,
      source,
      target,
      adapted: Boolean(result.adapted),
      fromPlatform: result.fromPlatform || null,
      toPlatform: result.toPlatform || null,
      shell: result.shell || null,
      registered,
      warnings
    });
  }
  return results;
}

function getRestoreWarnings(match) {
  return getMissingSkillWarnings(match.dependencies, match.bundleId);
}

function printRestoreWarnings(options, warnings) {
  for (const warning of warnings) {
    printRestoreLine(options, `warn: ${warning.message}`);
  }
}

function printJsonResult(options, results) {
  if (!options.json) {
    return;
  }
  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

function printRestoreLine(options, line) {
  if (!options.json) {
    console.log(line);
  }
}

function getRestoreTarget(config, match) {
  const agentRelativePath = match.agentRelativePath || inferLegacyAgentRelativePath(match);
  if (!agentRelativePath) {
    throw new Error(`cannot restore ${match.bundleId}: missing agentRelativePath`);
  }
  const relativePath = match.agent === "claude"
    ? getClaudeRestoreRelativePath(agentRelativePath, config)
    : agentRelativePath;
  const target = join(getAgentRoot(match.agent), relativePath);
  assertTargetInsideAgentRoot(match.agent, target);
  return target;
}

function assertTargetInsideAgentRoot(agent, target) {
  const root = normalizePath(getAgentRoot(agent));
  const normalizedTarget = normalizePath(target);
  if (normalizedTarget !== root && !normalizedTarget.startsWith(`${root}/`)) {
    throw new Error(`refusing to restore outside ${agent} root: ${target}`);
  }
}

function inferLegacyAgentRelativePath(match) {
  const originalPath = toSlash(expandHome(match.originalPath || ""));
  if (!originalPath) {
    return null;
  }
  if (match.agent === "codex") {
    return inferRelativeAfterMarker(originalPath, "/.codex/sessions/") ||
      inferRelativeAfterMarker(originalPath, "/sessions/");
  }
  if (match.agent === "claude") {
    return inferRelativeAfterMarker(originalPath, "/.claude/projects/") ||
      inferRelativeAfterMarker(originalPath, "/projects/");
  }
  return null;
}

function inferRelativeAfterMarker(path, marker) {
  const index = path.indexOf(marker);
  if (index < 0) {
    return null;
  }
  return path.slice(index + marker.length) || null;
}

function restoreSessionFile(config, match, source, target, options) {
  const originalContent = shouldAdaptSessionFile(match, source) ? readFileSync(source, "utf8") : null;
  if (options.noAdapt || !shouldAdaptSessionFile(match, source)) {
    copyFileSync(source, target);
    return { adapted: false, content: originalContent };
  }

  const result = match.agent === "claude"
    ? adaptClaudeSessionContent(originalContent, config)
    : adaptCodexSessionContent(originalContent, config);
  if (!result.adapted) {
    copyFileSync(source, target);
    return { adapted: false, content: originalContent };
  }

  writeFileAtomic(target, result.content);
  return result;
}

function formatRestoreSuffix(result) {
  if (!result.adapted) {
    return "";
  }
  if (result.fromPlatform || result.toPlatform || result.shell) {
    return ` (adapted ${result.fromPlatform || "unknown"} -> ${result.toPlatform || "unknown"}, shell ${result.shell || "unknown"})`;
  }
  return " (adapted project paths)";
}

function shouldAdaptSessionFile(match, source) {
  return (match.agent === "codex" || match.agent === "claude") && (source.endsWith(".jsonl") || source.endsWith(".json"));
}

function getRestoreProjectMatch(config, match, source) {
  try {
    const content = readFileSync(source, "utf8");
    if (match.agent === "codex") {
      return getCodexContentProjectMatch(content, config);
    }
    if (match.agent === "claude") {
      return getClaudeContentProjectMatch(content, config);
    }
    return { matched: false, reason: `unsupported agent ${match.agent}` };
  } catch (error) {
    return { matched: false, reason: `unreadable session (${error.message})` };
  }
}

function registerRestoredSession(config, match, target, content, options) {
  if (options.noRegister || !content) {
    return {
      ok: false,
      skipped: true,
      reason: options.noRegister ? "registration disabled" : "missing restored content"
    };
  }
  if (match.agent === "claude") {
    const result: any = registerRestoredClaudeSession(content, target, config, match);
    if (result.registered) {
      printRestoreLine(options, `registered claude session: ${result.sessionId || match.bundleId}`);
      return {
        ok: true,
        kind: "claude",
        sessionId: result.sessionId || match.bundleId
      };
    }
    return {
      ok: false,
      kind: "claude",
      reason: result.reason || "not registered"
    };
  }
  if (match.agent !== "codex") {
    return {
      ok: false,
      reason: `unsupported agent ${match.agent}`
    };
  }
  const result = registerRestoredCodexSession(content, target, config, match, getAgentRoot("codex"));
  if (result.registered) {
    printRestoreLine(options, `registered codex thread: ${result.sessionId}`);
    return {
      ok: true,
      kind: "codex",
      sessionId: result.sessionId
    };
  }
  printRestoreLine(options, `warn: restored file but failed to register Codex thread (${result.reason})`);
  return {
    ok: false,
    kind: "codex",
    reason: result.reason || "not registered"
  };
}
