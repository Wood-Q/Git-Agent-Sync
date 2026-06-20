import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "./constants.js";
import { expandHome, writeFileAtomic, writeJson } from "./utils.js";

const PRIVACY_POLICY_FILE = join(CONFIG_DIR, "privacy.json");
const DEFAULT_REPLACEMENT = "[REDACTED:$name]";

const DEFAULT_RULES = [
  { name: "openai_api_key", pattern: "\\bsk-[A-Za-z0-9_-]{20,}\\b" },
  { name: "anthropic_api_key", pattern: "\\bsk-ant-[A-Za-z0-9_-]{20,}\\b" },
  { name: "github_token", pattern: "\\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\\b" },
  { name: "github_pat", pattern: "\\bgithub_pat_[A-Za-z0-9_]{20,}\\b" },
  { name: "aws_access_key", pattern: "\\bAKIA[0-9A-Z]{16}\\b" },
  { name: "private_key", pattern: "-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----" },
  { name: "bearer_token", pattern: "\\bBearer\\s+[A-Za-z0-9._~+/=-]{20,}\\b" },
  { name: "named_secret", pattern: "\\b(?:api[_-]?key|token|secret|password)\\b\\s*[:=]\\s*['\\\"]?[A-Za-z0-9_./+=-]{16,}", flags: "gi" }
];

export function normalizePrivacyMode(value) {
  const mode = String(value || "review").trim().toLowerCase();
  if (mode === "allow") {
    return "allow";
  }
  if (["off", "review", "redact"].includes(mode)) {
    return mode;
  }
  throw new Error("--privacy must be one of review, redact, allow, or off");
}

export function loadPrivacyPolicy(gitRoot) {
  const path = join(gitRoot, PRIVACY_POLICY_FILE);
  if (!existsSync(path)) {
    return normalizePolicy({});
  }
  return normalizePolicy(JSON.parse(readFileSync(path, "utf8")));
}

export function scanPrivacyMatches(matches, policy = normalizePolicy({})) {
  const compiled = compileRules(policy);
  const allowRules = compileAllowRules(policy);
  const findings = [];
  for (const match of matches) {
    const sourcePath = match.originalPath ? expandHome(match.originalPath) : "";
    if (!sourcePath || !existsSync(sourcePath)) {
      continue;
    }
    const content = readFileSync(sourcePath, "utf8");
    findings.push(...scanText(content, compiled, {
      agent: match.agent,
      bundleId: match.bundleId,
      path: match.originalPath
    }, allowRules));
  }
  return createPrivacyReport(findings, policy, { redacted: false });
}

export function scanText(content, compiledRules, context: Record<string, any> = {}, allowRules = []) {
  const findings = [];
  for (const rule of compiledRules) {
    rule.regex.lastIndex = 0;
    let match;
    while ((match = rule.regex.exec(content))) {
      const value = match[0];
      const start = match.index;
      const end = start + value.length;
      if (isAllowedSpan(content, start, end, allowRules)) {
        if (value.length === 0) {
          rule.regex.lastIndex += 1;
        }
        continue;
      }
      const position = positionForOffset(content, match.index);
      findings.push({
        rule: rule.name,
        severity: rule.severity || "high",
        agent: context.agent || null,
        bundleId: context.bundleId || null,
        path: context.path || null,
        line: position.line,
        column: position.column,
        start,
        end,
        preview: maskSecret(value),
        replacement: replacementForRule(rule)
      });
      if (value.length === 0) {
        rule.regex.lastIndex += 1;
      }
    }
  }
  return findings;
}

export function redactText(content, policy = normalizePolicy({})) {
  let redacted = content;
  const allowRules = compileAllowRules(policy);
  for (const rule of compileRules(policy)) {
    rule.regex.lastIndex = 0;
    redacted = redacted.replace(rule.regex, (...args) => {
      const value = args[0];
      const offset = getReplaceOffset(args);
      if (isAllowedSpan(redacted, offset, offset + value.length, allowRules)) {
        return value;
      }
      return replacementForRule(rule);
    });
  }
  return redacted;
}

export function applyPrivacyRedactionsToStore(config, matches, policy = normalizePolicy({})) {
  let filesChanged = 0;
  for (const match of matches) {
    if (!match.storeRelativePath) {
      continue;
    }
    const storePath = join(config.storePath, match.storeRelativePath);
    if (!existsSync(storePath)) {
      continue;
    }
    const content = readFileSync(storePath, "utf8");
    const redacted = redactText(content, policy);
    if (redacted !== content) {
      writeFileAtomic(storePath, redacted);
      filesChanged += 1;
    }
  }
  return { filesChanged };
}

export function writePrivacyReport(config, report) {
  const path = join(config.storePath, "projects", config.projectId, "privacy-report.json");
  writeJson(path, report);
  return path;
}

export function createPrivacyReport(findings, policy, options: Record<string, any> = {}) {
  return {
    version: 1,
    scannedAt: new Date().toISOString(),
    mode: options.mode || "scan",
    redacted: Boolean(options.redacted),
    totalFindings: findings.length,
    rules: policy.rules.map((rule) => rule.name),
    allowPatterns: policy.allowRules.map((rule) => rule.name),
    findings
  };
}

export function assertPrivacyAllowsPush(report, mode) {
  if (mode === "review" && report.totalFindings > 0) {
    throw new Error(`privacy scan found ${report.totalFindings} sensitive span(s). Run "git agent-sync privacy scan" to review them, or use "git agent-sync push --privacy redact" to write redacted sidecar copies.`);
  }
}

function normalizePolicy(rawPolicy) {
  const denyPatterns = Array.isArray(rawPolicy.denyPatterns) ? rawPolicy.denyPatterns : [];
  const allowPatterns = Array.isArray(rawPolicy.allowPatterns) ? rawPolicy.allowPatterns : [];
  return {
    version: 1,
    replacement: rawPolicy.replacement || DEFAULT_REPLACEMENT,
    rules: [...DEFAULT_RULES, ...denyPatterns].map((rule) => ({
      name: rule.name,
      pattern: rule.pattern,
      flags: rule.flags || "g",
      severity: rule.severity || "high",
      replacement: rule.replacement || rawPolicy.replacement || DEFAULT_REPLACEMENT
    })),
    allowRules: allowPatterns.map((rule, index) => normalizeAllowRule(rule, index))
  };
}

function compileRules(policy) {
  return policy.rules.map((rule) => ({
    ...rule,
    regex: new RegExp(rule.pattern, normalizeFlags(rule.flags))
  }));
}

function compileAllowRules(policy) {
  return policy.allowRules.map((rule) => ({
    ...rule,
    regex: new RegExp(rule.pattern, normalizeFlags(rule.flags))
  }));
}

function normalizeAllowRule(rule, index) {
  if (typeof rule === "string") {
    return {
      name: `allow_${index + 1}`,
      pattern: rule,
      flags: "g"
    };
  }
  return {
    name: rule.name || `allow_${index + 1}`,
    pattern: rule.pattern,
    flags: rule.flags || "g"
  };
}

function normalizeFlags(flags) {
  const set = new Set(String(flags || "g").split(""));
  set.add("g");
  return [...set].join("");
}

function replacementForRule(rule) {
  return String(rule.replacement || DEFAULT_REPLACEMENT).replaceAll("$name", rule.name);
}

function maskSecret(value) {
  const normalized = value.replace(/\s+/g, " ");
  if (normalized.length <= 12) {
    return "[REDACTED]";
  }
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

function positionForOffset(content, offset) {
  const before = content.slice(0, offset);
  const lines = before.split(/\r?\n/);
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1
  };
}

function isAllowedSpan(content, start, end, allowRules) {
  for (const rule of allowRules) {
    rule.regex.lastIndex = 0;
    let match;
    while ((match = rule.regex.exec(content))) {
      const allowStart = match.index;
      const allowEnd = allowStart + match[0].length;
      if (allowEnd > start && allowStart < end) {
        return true;
      }
      if (match[0].length === 0) {
        rule.regex.lastIndex += 1;
      }
    }
  }
  return false;
}

function getReplaceOffset(args) {
  const maybeGroups = args[args.length - 1];
  const offsetIndex = typeof maybeGroups === "object" ? args.length - 3 : args.length - 2;
  return Number(args[offsetIndex] || 0);
}
