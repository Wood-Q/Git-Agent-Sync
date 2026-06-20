import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  addPrivacyAllowPattern,
  applyPrivacyRedactionsToStore,
  assertPrivacyAllowsPush,
  loadPrivacyPolicy,
  normalizePrivacyMode,
  redactText,
  scanPrivacyMatches,
  writePrivacyReport
} from "../dist/privacy.js";

const repoRoot = process.cwd();
const cli = join(repoRoot, "bin", "git-agent-sync.js");
const base = mkdtempSync(join(tmpdir(), "agent-sync-privacy-"));
const gitRoot = join(base, "project");
const storePath = join(base, "store");
const sourcePath = join(base, "session.jsonl");
const storeRelativePath = "projects/project-123/codex/codex-secret.jsonl";
const storeSessionPath = join(storePath, storeRelativePath);
mkdirSync(join(gitRoot, ".agent-sync"), { recursive: true });
mkdirSync(join(storeSessionPath, ".."), { recursive: true });

const secret = "sk-" + "a".repeat(32);
const githubToken = "ghp_" + "b".repeat(36);
const content = [
  JSON.stringify({ type: "session_meta", payload: { id: "secret-session", cwd: gitRoot } }),
  JSON.stringify({ type: "message", payload: { text: `OPENAI_API_KEY=${secret}` } }),
  JSON.stringify({ type: "message", payload: { text: `Authorization: Bearer ${githubToken}` } })
].join("\n") + "\n";
writeFileSync(sourcePath, content);
writeFileSync(storeSessionPath, content);

const config = {
  projectId: "project-123",
  projectName: "Project",
  projectIdentity: "git:https://github.com/example/project",
  storePath
};
const match = {
  agent: "codex",
  bundleId: "codex-secret",
  originalPath: sourcePath,
  storeRelativePath
};
const policy = loadPrivacyPolicy(gitRoot);

assert.equal(normalizePrivacyMode(undefined), "review");
assert.equal(normalizePrivacyMode("redact"), "redact");
assert.throws(() => normalizePrivacyMode("bad"), /--privacy/);

const report = scanPrivacyMatches([match], policy);
assert.equal(report.totalFindings >= 2, true);
assert.equal(report.findings.some((finding) => finding.rule === "openai_api_key"), true);
assert.equal(report.findings.some((finding) => finding.preview.includes(secret)), false);
assert.throws(() => assertPrivacyAllowsPush(report, "review"), /privacy scan found/);
assert.doesNotThrow(() => assertPrivacyAllowsPush(report, "redact"));

const redacted = redactText(content, policy);
assert.equal(redacted.includes(secret), false);
assert.equal(redacted.includes(githubToken), false);
assert.match(redacted, /\[REDACTED:openai_api_key\]/);

const allowRoot = join(base, "allow-project");
mkdirSync(join(allowRoot, ".agent-sync"), { recursive: true });
const allowedSecret = "sk-" + "c".repeat(32);
const blockedSecret = "sk-" + "d".repeat(32);
const allowSourcePath = join(base, "allow-session.jsonl");
const allowContent = [
  JSON.stringify({ type: "session_meta", payload: { id: "allow-session", cwd: allowRoot } }),
  JSON.stringify({ type: "message", payload: { text: `example=${allowedSecret}` } }),
  JSON.stringify({ type: "message", payload: { text: `real=${blockedSecret}` } })
].join("\n") + "\n";
writeFileSync(allowSourcePath, allowContent);
writeFileSync(join(allowRoot, ".agent-sync", "privacy.json"), JSON.stringify({
  version: 1,
  allowPatterns: [
    { name: "documented_example_token", pattern: "sk-c{32}" }
  ]
}, null, 2));
const allowPolicy = loadPrivacyPolicy(allowRoot);
const allowReport = scanPrivacyMatches([{
  agent: "codex",
  bundleId: "allow-secret",
  originalPath: allowSourcePath
}], allowPolicy);
assert.equal(allowReport.allowPatterns.includes("documented_example_token"), true);
assert.equal(allowReport.findings.some((finding) => finding.preview.includes("cccc")), false);
assert.equal(allowReport.findings.some((finding) => finding.preview.includes("dddd")), true);
const allowRedacted = redactText(allowContent, allowPolicy);
assert.equal(allowRedacted.includes(allowedSecret), true);
assert.equal(allowRedacted.includes(blockedSecret), false);

const reviewedSecret = "sk-" + "e".repeat(32);
const allowAdded = addPrivacyAllowPattern(allowRoot, "reviewed_example=sk-e{32}");
assert.equal(allowAdded.changed, true);
assert.equal(allowAdded.rule.name, "reviewed_example");
const allowUnchanged = addPrivacyAllowPattern(allowRoot, "reviewed_example", "sk-e{32}");
assert.equal(allowUnchanged.changed, false);
assert.throws(() => addPrivacyAllowPattern(allowRoot, "reviewed_example", "sk-f{32}"), /already exists/);
const reviewedPolicy = loadPrivacyPolicy(allowRoot);
const reviewedReport = scanPrivacyMatches([{
  agent: "codex",
  bundleId: "reviewed-secret",
  originalPath: writeTempSession(base, "reviewed-session.jsonl", reviewedSecret)
}], reviewedPolicy);
assert.equal(reviewedReport.findings.some((finding) => finding.preview.includes("eeee")), false);

const applied = applyPrivacyRedactionsToStore(config, [match], policy);
assert.equal(applied.filesChanged, 1);
const stored = readFileSync(storeSessionPath, "utf8");
assert.equal(stored.includes(secret), false);
assert.equal(stored.includes(githubToken), false);

const reportPath = writePrivacyReport(config, { ...report, mode: "redact", redacted: true });
assert.equal(existsSync(reportPath), true);
assert.match(readFileSync(reportPath, "utf8"), /openai_api_key/);

const cliBase = mkdtempSync(join(tmpdir(), "agent-sync-privacy-cli-"));
const project = join(cliBase, "project");
const codexRoot = join(cliBase, "codex");
const claudeRoot = join(cliBase, "claude");
mkdirSync(join(codexRoot, "2026", "06", "20"), { recursive: true });
mkdirSync(claudeRoot, { recursive: true });
mkdirSync(project, { recursive: true });
run("git", ["init", "-b", "main"], project);
run("git", ["config", "user.name", "Agent Sync Test"], project);
run("git", ["config", "user.email", "test@example.invalid"], project);
writeFileSync(join(project, "README.md"), "# privacy cli\n");
run("git", ["add", "README.md"], project);
run("git", ["commit", "-m", "initial"], project);
const currentCommit = run("git", ["rev-parse", "HEAD"], project);
run(process.execPath, [cli, "init"], project, privacyEnv(codexRoot, claudeRoot));
const cliAllow = JSON.parse(run(process.execPath, [cli, "privacy", "allow-pattern-local", "reviewed_cli=sk-f{32}", "--json"], project, privacyEnv(codexRoot, claudeRoot)));
assert.equal(cliAllow.changed, true);
assert.match(readFileSync(join(project, ".agent-sync", "privacy.json"), "utf8"), /reviewed_cli/);
writeJsonl(join(codexRoot, "2026", "06", "20", "secret.jsonl"), [
  {
    type: "session_meta",
    payload: {
      id: "secret-cli",
      cwd: project,
      git: {
        commit_hash: currentCommit,
        branch: "main"
      }
    }
  },
  { type: "turn_context", payload: { cwd: project } },
  { type: "response_item", payload: { type: "message", role: "user", content: `token=${secret}` } }
]);

assert.throws(
  () => run(process.execPath, [cli, "push"], project, privacyEnv(codexRoot, claudeRoot)),
  /privacy scan found/
);
run(process.execPath, [cli, "push", "--privacy", "redact"], project, privacyEnv(codexRoot, claudeRoot));
const projectConfig = JSON.parse(readFileSync(join(project, ".agent-sync", "config.json"), "utf8"));
const sidecar = join(project, ".agent-sync-store");
const redactedBundle = readFileSync(findFirstStoreFile(sidecar, `/projects/${projectConfig.projectId}/codex/`), "utf8");
assert.equal(redactedBundle.includes(secret), false);
assert.match(redactedBundle, /\[REDACTED:/);
const redactedObject = readFileSync(findFirstStoreFile(sidecar, "/objects/"), "utf8");
assert.equal(redactedObject.includes(secret), false);
assert.match(redactedObject, /\[REDACTED:/);
assert.equal(existsSync(join(sidecar, "projects", projectConfig.projectId, "privacy-report.json")), true);

console.log("privacy redaction test passed");

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `command failed: ${command} ${args.join(" ")}`).trim());
  }
  return result.stdout.trim();
}

function privacyEnv(codexDir, claudeDir) {
  return {
    ...process.env,
    AGENT_SYNC_CODEX_DIR: codexDir,
    AGENT_SYNC_CLAUDE_DIR: claudeDir
  };
}

function writeJsonl(path, items) {
  writeFileSync(path, `${items.map((item) => JSON.stringify(item)).join("\n")}\n`);
}

function writeTempSession(root, name, token) {
  const path = join(root, name);
  writeFileSync(path, `${JSON.stringify({ type: "message", payload: { text: `token=${token}` } })}\n`);
  return path;
}

function findFirstStoreFile(root, needle) {
  for (const file of walkFiles(root)) {
    if (file.includes(needle) && file.endsWith(".jsonl")) {
      return file;
    }
  }
  throw new Error(`no store file found for ${needle}`);
}

function walkFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current)) {
      const fullPath = join(current, entry);
      if (statSync(fullPath).isDirectory()) {
        stack.push(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }
  return files;
}
