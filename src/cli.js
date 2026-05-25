import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  CACHE_FILE,
  CONFIG_DIR,
  CONFIG_FILE,
  DEFAULT_AGENT_DIR,
  DEFAULT_STORE_BRANCH,
  SUPPORTED_AGENTS,
  TOOL_VERSION
} from "./constants.js";
import { parseArgs, parseSelector, formatSelector } from "./args.js";
import { getAgentRoot, scanSessions } from "./agents.js";
import { getBindingsPath, inspectBindings, queryBindings, readAllBindings, writeBindings } from "./bindings.js";
import { cleanCodexTitle, extractCodexSessionMetadata, loadCodexSessionTitles } from "./codex-session.js";
import { cleanClaudeTitle, extractClaudeSessionMetadata } from "./claude-session.js";
import {
  legacyProjectIdForPath,
  readConfig,
  stableProjectId,
  writeConfig,
  writeGitignoreEntry
} from "./config.js";
import { getGitContext, getGitRoot, getGitValue, getProjectIdentity, runGit } from "./git.js";
import { restoreCommand } from "./restore.js";
import {
  adoptExistingProjectBundle,
  copyMatchesToStore,
  ensureStoreRepo,
  findProjectBundle,
  getManifestPath,
  getProjectBundleStagePath,
  getStoreSparseStatus,
  pruneArchivedManifestEntries,
  pruneArchivedSidecarEntries,
  pruneForeignProjectSidecarEntries,
  syncStoreFromRemote,
  writeManifest
} from "./store.js";
import { normalizePath, readJson, unique, writeJson } from "./utils.js";
import { getCodexArchiveInfo, isArchivedCodexSessionPath, summarizeCodexArchiveInfo } from "./codex-archive.js";

export async function main(argv) {
  const { command, args, options } = parseArgs(argv.slice(2));

  if (!command || command === "help") {
    printHelp(args[0]);
    return;
  }

  if (options.help) {
    printHelp(command);
    return;
  }

  if (command === "--version" || command === "version") {
    console.log(TOOL_VERSION);
    return;
  }

  const gitRoot = getGitRoot();
  const commands = {
    init: () => initCommand(gitRoot, args, options),
    status: () => statusCommand(gitRoot, options),
    log: () => logCommand(gitRoot, options),
    show: () => showCommand(gitRoot, args, options),
    push: () => pushCommand(gitRoot, options),
    pull: () => pullCommand(gitRoot),
    scan: () => scanCommand(gitRoot, options),
    "install-hooks": () => installHooksCommand(gitRoot),
    "uninstall-hooks": () => uninstallHooksCommand(gitRoot),
    restore: () => restoreCommand(gitRoot, args, options, readConfigWithBundle(gitRoot)),
    doctor: () => doctorCommand(gitRoot)
  };

  const handler = commands[command];
  if (!handler) {
    throw new Error(`unknown command "${command}". Run "git agent-sync --help".`);
  }

  await handler();
}

function printHelp(command = null) {
  if (command) {
    printCommandHelp(command);
    return;
  }

  console.log(`git-agent-sync ${TOOL_VERSION}

Usage:
  git agent-sync init [--remote <url>|<url>] [--store <path>]
  git agent-sync status [--json]
  git agent-sync log [--latest|--current|--branch <name>|--commit <sha>] [--oneline] [-n <count>|-<count>] [--json]
  git agent-sync show <bundle-id>|--latest <index>|--current <index>|--branch <name> <index>|--commit <sha> <index> [--json]
  git agent-sync push [--m <message>]
  git agent-sync pull
  git agent-sync scan [--json]
  git agent-sync restore <bundle-id>|--index <n>|--i <n>|--all|--latest|--current|--branch <name>|--commit <sha> [index] [--no-adapt] [--no-register]
  git agent-sync install-hooks
  git agent-sync uninstall-hooks
  git agent-sync doctor

Git-style behavior:
  - log browses synced agent conversations, like git log
  - show prints one snapshot detail, like git show <object>
  - restore writes selected snapshots back into your local agent directory
  - latest means the most recent sidecar sync batch
  - current means the current project HEAD commit
  - branch is a historical sync label, not a moving branch pointer
  - commit matches the project commit recorded during sidecar sync

MVP behavior:
  - Detects Codex sessions in ~/.codex/sessions/**/*.jsonl
  - Detects Claude Code sessions in ~/.claude/projects/**/*.jsonl
  - Stores matched session files in a sidecar Git repo
  - Does not add agent sessions to your project Git history
`);
}

function printCommandHelp(command) {
  const help = {
    init: `Usage:
  git agent-sync init [--remote <url>|<url>] [--store <path>]

Initializes project-local config and a sidecar Git repo.
Aligns with: git init plus git remote add for the sidecar store.`,
    status: `Usage:
  git agent-sync status [--json]

Scans local agent sessions and reports which files match this Git project.`,
    scan: `Usage:
  git agent-sync scan [--json]

Alias of status. Scans local agent sessions without pushing.`,
    log: `Usage:
  git agent-sync log [--oneline] [-n <count>|-<count>] [--json]
  git agent-sync log --latest [--oneline] [-n <count>|-<count>] [--json]
  git agent-sync log --current [--oneline] [-n <count>|-<count>] [--json]
  git agent-sync log --branch <name> [--oneline] [-n <count>|-<count>] [--json]
  git agent-sync log --commit <sha> [--oneline] [-n <count>|-<count>] [--json]

Browses recoverable agent conversations.
Aligns with: git log.
Default Index values can be restored with git agent-sync restore --index <n>.
Uses a pager for long human-readable output when run in an interactive terminal.
Selectors:
  --latest       most recent sidecar sync batch
  --current      current project HEAD commit
  --branch name  branch label recorded during sync
  --commit sha   project commit recorded during sync
Formats:
  --oneline      print one conversation per line
  -n count       limit output to count conversations
  -count         shorthand for -n count`,
    show: `Usage:
  git agent-sync show <bundle-id> [--json]
  git agent-sync show --latest <index> [--json]
  git agent-sync show --current <index> [--json]
  git agent-sync show --branch <name> <index> [--json]
  git agent-sync show --commit <sha> <index> [--json]

Prints one agent session snapshot detail without restoring it.
Aligns with: git show <object>.`,
    push: `Usage:
  git agent-sync push [--m <message>]

Copies matching agent session snapshots into the sidecar repo and commits them.
Use --m to set the sidecar commit message for this sync.
Aligns with: git push. The sidecar commit records the current project HEAD commit.`,
    pull: `Usage:
  git agent-sync pull

Fast-forwards the sidecar repo from its remote.
Run log or restore after pull to inspect or recover sessions.`,
    restore: `Usage:
  git agent-sync restore <bundle-id> [--no-adapt] [--no-register]
  git agent-sync restore --index <n> [--no-adapt] [--no-register]
  git agent-sync restore --i <n> [--no-adapt] [--no-register]
  git agent-sync restore --all [--no-adapt] [--no-register]
  git agent-sync restore --latest [index|--index <n>|--i <n>] [--no-adapt] [--no-register]
  git agent-sync restore --current [index|--index <n>|--i <n>] [--no-adapt] [--no-register]
  git agent-sync restore --branch <name> [index|--index <n>|--i <n>] [--no-adapt] [--no-register]
  git agent-sync restore --commit <sha> [index|--index <n>|--i <n>] [--no-adapt] [--no-register]

Restores selected snapshots into the local agent sessions directory.
Use --index/--i with the Index shown by the default log output.
By default Codex restores are registered in state_5.sqlite/session_index.jsonl; Claude restores are written under ~/.claude/projects for the current project.
Aligns with: git restore/checkout for local working context.`,
    "install-hooks": `Usage:
  git agent-sync install-hooks

Installs a project pre-push hook that runs git-agent-sync push before git push.
The hook skips when .agent-sync/config.json or the sidecar Git repo is missing.`,
    "uninstall-hooks": `Usage:
  git agent-sync uninstall-hooks

Removes the pre-push hook installed by git-agent-sync.
It refuses to remove hooks that were not installed by Agent-Sync.`,
    doctor: `Usage:
  git agent-sync doctor

Checks config, sidecar remote, manifest, bindings, and local agent directories.`
  };

  const text = help[command];
  if (!text) {
    throw new Error(`unknown command "${command}". Run "git agent-sync --help".`);
  }
  console.log(text);
}

function initCommand(gitRoot, args, options) {
  mkdirSync(join(gitRoot, CONFIG_DIR), { recursive: true });

  const projectName = basename(gitRoot);
  const storePath = normalizePath(resolve(gitRoot, options.store || DEFAULT_AGENT_DIR));
  const remote = options.remote || args[0] || null;
  const projectIdentity = getProjectIdentity(gitRoot);
  const legacyProjectId = legacyProjectIdForPath(gitRoot);
  const config = {
    version: 1,
    projectId: stableProjectId(projectName, projectIdentity),
    projectIdentity,
    legacyProjectIds: unique([legacyProjectId].filter(Boolean)),
    projectName,
    projectRoot: gitRoot,
    storePath,
    remote,
    agents: SUPPORTED_AGENTS,
    createdAt: new Date().toISOString()
  };

  ensureStoreRepo(storePath, config.remote);
  adoptExistingProjectBundle(config);
  writeConfig(gitRoot, config);
  writeGitignoreEntry(gitRoot, CONFIG_DIR);
  writeGitignoreEntry(gitRoot, DEFAULT_AGENT_DIR);

  console.log(`agent-sync initialized for ${projectName}`);
  console.log(`config: ${join(gitRoot, CONFIG_FILE)}`);
  console.log(`store:  ${storePath}`);
  console.log(`project id: ${config.projectId}`);
  if (config.remote) {
    console.log(`remote: ${config.remote}`);
  }
}

function statusCommand(gitRoot, options) {
  const config = readConfigWithBundle(gitRoot);
  const scan = scanSessions(gitRoot, config);
  writeJson(join(gitRoot, CACHE_FILE), scan);

  if (options.json) {
    console.log(JSON.stringify(scan, null, 2));
    return;
  }

  printScan(scan, config);
}

function scanCommand(gitRoot, options) {
  return statusCommand(gitRoot, options);
}

function logCommand(gitRoot, options) {
  const config = readConfigWithBundle(gitRoot);
  const selector = parseSelector(options, { requireSelector: false });
  const bindings = limitBindings(selector ? queryBindings(config, selector, gitRoot) : readAllBindings(config), options);

  if (options.json) {
    console.log(JSON.stringify(bindings, null, 2));
    return;
  }

  pageOrPrint(renderBindings(config, bindings, selector, options));
}

function showCommand(gitRoot, args, options) {
  const config = readConfigWithBundle(gitRoot);
  const selector = parseSelector(options, { requireSelector: false });
  const match = selector
    ? selectBindingByIndex(queryBindings(config, selector, gitRoot), parseRequiredIndex(args, options, selector), selector)
    : findBindingByBundleId(config, args[0]);
  if (!match) {
    throw new Error(selector ? `no bindings found for ${formatSelector(selector)}` : `no bundle found for "${args[0] || ""}"`);
  }

  if (options.json) {
    console.log(JSON.stringify(match, null, 2));
    return;
  }
  printBindingDetail(config, match);
}

function pushCommand(gitRoot, options = {}) {
  const config = readConfigWithBundle(gitRoot);
  ensureStoreRepo(config.storePath, config.remote);
  syncStoreFromRemote(config);
  adoptExistingProjectBundle(config);
  writeConfig(gitRoot, config);
  const gitContext = getGitContext(gitRoot);
  const syncRunId = `${new Date().toISOString()}:${gitContext.headCommit}`;
  const archiveInfo = getCodexArchiveInfo(getAgentRoot("codex"), { gitRoot });
  const scan = scanSessions(gitRoot, config, archiveInfo);
  writeJson(join(gitRoot, CACHE_FILE), scan);

  const pruned = pruneArchivedSidecarEntries(config, archiveInfo);
  const foreignPruned = pruneForeignProjectSidecarEntries(config);
  const copied = copyMatchesToStore(config, scan, archiveInfo);
  writeManifest(config, scan, gitContext);
  const commitMessage = getPushCommitMessage(config, gitContext, options);
  const author = getProjectGitAuthor(gitRoot);
  const bindingsAdded = writeBindings(config, scan.matches, gitContext, syncRunId, {
    message: commitMessage,
    authorName: author.name,
    authorEmail: author.email
  });

  stageProjectBundle(config);
  const diff = runGit(["diff", "--cached", "--quiet"], config.storePath, { allowFail: true });
  if (diff.status === 0) {
    console.log(`agent-sync: no sidecar changes (${copied.length} matched session(s), ${pruned.removedFiles} archived removed, ${foreignPruned.removedFiles} foreign removed).`);
  } else {
    runGit(["-c", `user.name=${author.name}`, "-c", `user.email=${author.email}`, "commit", "-m", commitMessage], config.storePath);
    console.log(`agent-sync: committed ${copied.length} matched session file(s), ${bindingsAdded} new binding(s), ${pruned.removedFiles} archived removed, ${foreignPruned.removedFiles} foreign removed.`);
  }

  if (config.remote) {
    runGit(["push", "-u", "origin", DEFAULT_STORE_BRANCH], config.storePath);
    console.log("agent-sync: pushed sidecar repo.");
  }
}

function pullCommand(gitRoot) {
  const config = readConfigWithBundle(gitRoot);
  ensureStoreRepo(config.storePath, config.remote);
  const archiveInfo = getCodexArchiveInfo(getAgentRoot("codex"), { gitRoot });

  if (config.remote) {
    const pulled = syncStoreFromRemote(config);
    if (!pulled) {
      console.log(`agent-sync: remote has no ${DEFAULT_STORE_BRANCH} branch yet; push from a machine with sessions first.`);
    }
    console.log("agent-sync: pulled sidecar repo.");
    adoptExistingProjectBundle(config);
    writeConfig(gitRoot, config);
  } else {
    console.log("agent-sync: no remote configured; local sidecar store is already available.");
  }

  const pruned = pruneArchivedSidecarEntries(config, archiveInfo);
  const manifestPruned = pruneArchivedManifestEntries(config, archiveInfo);
  const foreignPruned = pruneForeignProjectSidecarEntries(config);
  if (pruned.removedFiles || pruned.removedBindings) {
    console.log(`agent-sync: pruned ${pruned.removedFiles} archived file(s) and ${pruned.removedBindings} archived binding(s).`);
  }
  if (manifestPruned.removed) {
    console.log(`agent-sync: pruned ${manifestPruned.removed} archived manifest entr${manifestPruned.removed === 1 ? "y" : "ies"}.`);
  }
  if (foreignPruned.removedFiles || foreignPruned.removedBindings || foreignPruned.removedManifestEntries) {
    console.log(`agent-sync: pruned ${foreignPruned.removedFiles} foreign project file(s), ${foreignPruned.removedBindings} binding(s), and ${foreignPruned.removedManifestEntries} manifest entr${foreignPruned.removedManifestEntries === 1 ? "y" : "ies"}.`);
  }
  commitStoreCleanup(config, pruned, manifestPruned, foreignPruned);

  const bundle = findProjectBundle(config);
  if (bundle) {
    const manifest = readJson(bundle.manifestPath);
    console.log(`agent-sync: ${manifest.matches.length} session file(s) available for restore.`);
    if (bundle.projectId !== config.projectId) {
      console.log(`agent-sync: using compatible project bundle ${bundle.projectId}.`);
    }
  }
}

function installHooksCommand(gitRoot) {
  const hooksDir = join(gitRoot, ".git", "hooks");
  mkdirSync(hooksDir, { recursive: true });
  const hookPath = join(hooksDir, "pre-push");
  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, "utf8");
    if (!existing.includes("AGENT_SYNC_HOOK=pre-push")) {
      throw new Error(`pre-push hook already exists and was not installed by agent-sync: ${hookPath}`);
    }
  }
  const hook = `#!/bin/sh
# Installed by git-agent-sync. AGENT_SYNC_HOOK=pre-push
CONFIG_FILE=".agent-sync/config.json"

if [ ! -f "$CONFIG_FILE" ]; then
  exit 0
fi

STORE_PATH="$(node -e "try { const fs = require('fs'); const path = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8')).storePath || '.agent-sync-store'; process.stdout.write(path); } catch (_) { process.exit(0); }")"

if [ -z "$STORE_PATH" ] || [ ! -d "$STORE_PATH/.git" ]; then
  exit 0
fi

if command -v git-agent-sync >/dev/null 2>&1; then
  git-agent-sync push
elif command -v agent-sync >/dev/null 2>&1; then
  agent-sync push
else
  echo "agent-sync: git-agent-sync not found; skipping session sync" >&2
fi
`;
  writeFileSync(hookPath, hook, { mode: 0o755 });
  console.log(`agent-sync: installed pre-push hook at ${hookPath}`);
}

function uninstallHooksCommand(gitRoot) {
  const hookPath = join(gitRoot, ".git", "hooks", "pre-push");
  if (!existsSync(hookPath)) {
    console.log("agent-sync: no pre-push hook installed.");
    return;
  }
  const content = readFileSync(hookPath, "utf8");
  if (!content.includes("AGENT_SYNC_HOOK=pre-push")) {
    throw new Error(`pre-push hook was not installed by agent-sync: ${hookPath}`);
  }
  unlinkSync(hookPath);
  console.log(`agent-sync: removed pre-push hook at ${hookPath}`);
}

function commitStoreCleanup(config, archivedPruned, manifestPruned, foreignPruned) {
  const changed = Boolean(
    archivedPruned.removedFiles ||
    archivedPruned.removedBindings ||
    manifestPruned.removed ||
    foreignPruned.removedFiles ||
    foreignPruned.removedBindings ||
    foreignPruned.removedManifestEntries
  );
  if (!changed) {
    return;
  }

  stageProjectBundle(config);
  const diff = runGit(["diff", "--cached", "--quiet"], config.storePath, { allowFail: true });
  if (diff.status !== 0) {
    runGit(["commit", "-m", `prune ${config.projectName} sidecar sessions`], config.storePath);
    console.log("agent-sync: committed sidecar cleanup locally; run push to publish it.");
  }
}

function stageProjectBundle(config) {
  runGit(["add", "--", ".gitignore", getProjectBundleStagePath(config)], config.storePath);
}

function getPushCommitMessage(config, gitContext, options) {
  if (Object.prototype.hasOwnProperty.call(options, "message")) {
    const message = String(options.message ?? "").trim();
    if (!message) {
      throw new Error("push --m requires a non-empty message");
    }
    return message;
  }
  const shortCommit = gitContext.headCommit.slice(0, 12);
  const branch = gitContext.branch || "detached";
  return `sync ${config.projectName} agent sessions at ${shortCommit} (${branch})`;
}

function getProjectGitAuthor(gitRoot) {
  return {
    name: getGitValue(["config", "user.name"], gitRoot) || "agent-sync",
    email: getGitValue(["config", "user.email"], gitRoot) || "agent-sync@example.invalid"
  };
}

function doctorCommand(gitRoot) {
  const config = existsSync(join(gitRoot, CONFIG_FILE)) ? readConfigWithBundle(gitRoot) : null;
  const codexRoot = getAgentRoot("codex");
  const claudeRoot = getAgentRoot("claude");
  const codexArchive = getCodexArchiveInfo(codexRoot, config ? { gitRoot } : {});
  const checks = [];
  addCheck(checks, "git root", "ok", gitRoot);
  addCheck(checks, "node", "ok", process.version);
  addCheck(checks, "codex dir", existsSync(codexRoot) ? "ok" : "warn", existsSync(codexRoot) ? codexRoot : "missing");
  addCheck(checks, "codex archive", codexArchive.stateStatus === "ok" ? "ok" : "warn", describeCodexArchive(codexArchive));
  addCheck(checks, "claude dir", existsSync(claudeRoot) ? "ok" : "warn", existsSync(claudeRoot) ? claudeRoot : "missing");
  addCheck(checks, "config", config ? "ok" : "fail", config ? join(gitRoot, CONFIG_FILE) : "missing");
  if (config) {
    addCheck(checks, "store", existsSync(config.storePath) ? "ok" : "fail", existsSync(config.storePath) ? config.storePath : "missing");
    addCheck(checks, "remote", checkRemote(config), config.remote || "none");
    addCheck(checks, "store git", checkStoreGit(config), describeStoreGit(config));
    addCheck(checks, "store sparse", checkStoreSparse(config), describeStoreSparse(config));
    addCheck(checks, "manifest", checkManifest(config), describeManifest(config));
    addCheck(checks, "bindings", checkBindings(config), describeBindings(config));
    addCheck(checks, "codex files", "ok", `${countAgentFiles(codexRoot, codexArchive)} file(s) visible, ${codexArchive.archivedPaths.size} archived skipped`);
    addCheck(checks, "claude files", "ok", `${countAgentFiles(claudeRoot)} file(s)`);
    addCheck(checks, "identity", "ok", config.projectIdentity);
    addCheck(checks, "project id", "ok", config.projectId);
    addCheck(checks, "legacy id", "ok", config.legacyProjectIds?.join(", ") || "none");
  }
  for (const check of checks) {
    console.log(`${check.status.padEnd(5)} ${check.label.padEnd(12)} ${check.value}`);
  }
}

function addCheck(checks, label, status, value) {
  checks.push({ label, status, value });
}

function checkRemote(config) {
  if (!config.remote) {
    return "warn";
  }
  if (!existsSync(join(config.storePath, ".git"))) {
    return "fail";
  }
  const result = runGit(["ls-remote", "--heads", "origin"], config.storePath, { allowFail: true });
  return result.status === 0 ? "ok" : "fail";
}

function checkStoreGit(config) {
  if (!existsSync(join(config.storePath, ".git"))) {
    return "fail";
  }
  const branch = getGitValue(["rev-parse", "--abbrev-ref", "HEAD"], config.storePath);
  return branch === DEFAULT_STORE_BRANCH ? "ok" : "warn";
}

function describeStoreGit(config) {
  if (!existsSync(join(config.storePath, ".git"))) {
    return "missing .git";
  }
  const branch = getGitValue(["rev-parse", "--abbrev-ref", "HEAD"], config.storePath) || "unknown";
  const upstream = getGitValue(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], config.storePath) || "no upstream";
  return `${branch}, ${upstream}`;
}

function checkStoreSparse(config) {
  if (!config.remote) {
    return "warn";
  }
  const status = getStoreSparseStatus(config);
  return status.enabled ? "ok" : "warn";
}

function describeStoreSparse(config) {
  const status = getStoreSparseStatus(config);
  if (!config.remote) {
    return "disabled (no remote)";
  }
  return `${status.status}, cone ${status.cone || "unset"}, filter ${status.filter || "none"}`;
}

function checkManifest(config) {
  const path = getManifestPath(config);
  if (!existsSync(path)) {
    return "warn";
  }
  try {
    const manifest = readJson(path);
    return Array.isArray(manifest.matches) ? "ok" : "fail";
  } catch {
    return "fail";
  }
}

function describeManifest(config) {
  const path = getManifestPath(config);
  if (!existsSync(path)) {
    return "missing";
  }
  try {
    const manifest = readJson(path);
    const count = Array.isArray(manifest.matches) ? manifest.matches.length : 0;
    return `${count} match(es)`;
  } catch (error) {
    return `invalid JSON (${error.message})`;
  }
}

function checkBindings(config) {
  const summary = inspectBindings(config);
  if (!summary.exists) {
    return "warn";
  }
  return summary.invalid ? "warn" : "ok";
}

function describeBindings(config) {
  const summary = inspectBindings(config);
  if (!summary.exists) {
    return `missing (${getBindingsPath(config)})`;
  }
  const base = `${summary.valid} valid, ${summary.invalid} invalid`;
  return summary.errors.length ? `${base}; ${summary.errors.slice(0, 2).join("; ")}` : base;
}

function describeCodexArchive(info) {
  const summary = summarizeCodexArchiveInfo(info);
  return `${summary.archivedCount} archived session(s), state ${summary.stateStatus}, ${summary.sourceSummary}, cache ${summary.cacheStatus}`;
}

function countAgentFiles(root, archiveInfo = null) {
  if (!existsSync(root)) {
    return 0;
  }
  const stack = [root];
  let count = 0;
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.isFile() && (entry.name.endsWith(".jsonl") || entry.name.endsWith(".json"))) {
        if (archiveInfo && isArchivedCodexSessionPath(path, archiveInfo)) {
          continue;
        }
        count += 1;
      }
    }
  }
  return count;
}

function readConfigWithBundle(gitRoot) {
  const config = readConfig(gitRoot);
  adoptExistingProjectBundle(config);
  return config;
}

function printScan(scan, config) {
  console.log(`project: ${scan.projectName}`);
  console.log(`id:      ${config.projectId}`);
  console.log(`store:   ${config.storePath}`);
  console.log(`scan:    ${scan.candidates} candidate file(s), ${scan.matches.length} match(es)`);
  if (scan.cache) {
    console.log(`cache:   ${scan.cache.cached} reused, ${scan.cache.refreshed} refreshed`);
  }
  if (!scan.matches.length) {
    console.log("hint: sessions are matched only through structured project metadata such as cwd, workdir, Git remote, branch, or commit.");
    return;
  }
  for (const match of scan.matches) {
    console.log(`- ${match.bundleId} ${match.agent} ${match.originalPath} (${match.bytes} bytes)`);
  }
}

function limitBindings(bindings, options) {
  const maxCount = parseMaxCount(options);
  return maxCount ? bindings.slice(0, maxCount) : bindings;
}

function parseMaxCount(options) {
  const value = options.maxCount;
  if (value === null || value === undefined) {
    return null;
  }
  if (!/^\d+$/.test(String(value)) || Number(value) < 1) {
    throw new Error("log count must be a positive number");
  }
  return Number(value);
}

function renderBindings(config, bindings, selector, options = {}) {
  return options.oneline
    ? renderBindingsOneline(config, bindings)
    : renderBindingsFull(config, bindings, selector);
}

function renderBindingsOneline(config, bindings) {
  const titles = loadCodexSessionTitles();
  return bindings.map((binding, index) => {
    const title = getBindingTitle(config, binding, titles);
    const message = binding.commitMessage || fallbackBindingCommitMessage(config, binding);
    return `${index + 1}  ${title}  ${message}`;
  }).join("\n");
}

function renderBindingsFull(config, bindings, selector) {
  const titles = loadCodexSessionTitles();
  const lines = [];
  if (selector) {
    lines.push(`selector: ${formatSelector(selector)}`);
    lines.push(`bindings: ${bindings.length}`);
    lines.push(`restore:  git agent-sync restore ${formatSelectorForCommand(selector)} <index>`);
    lines.push(`show:     git agent-sync show ${formatSelectorForCommand(selector)} <index>`);
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
    if (!selector) {
      lines.push(`    Restore: git agent-sync restore --index ${index + 1}`);
      lines.push(`    Show:    git agent-sync show ${binding.bundleId}`);
    }
  });
  return lines.join("\n");
}

function pageOrPrint(text) {
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

function shouldUsePager(text) {
  if (!process.stdout.isTTY) {
    return false;
  }
  const rows = process.stdout.rows || 24;
  return text.split(/\r?\n/).length > rows;
}

function printBindingDetail(config, binding) {
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

function selectBindingByIndex(bindings, index, selector) {
  if (!bindings.length) {
    return null;
  }
  if (index > bindings.length) {
    throw new Error(`show index ${index} is out of range for ${formatSelector(selector)} (${bindings.length} binding(s))`);
  }
  return bindings[index - 1] || null;
}

function parseRequiredIndex(args, options, selector) {
  const value = options.index ?? args[0];
  if (value === null || value === undefined) {
    throw new Error(`show ${formatSelector(selector)} requires an index`);
  }
  if (!/^\d+$/.test(String(value)) || Number(value) < 1) {
    throw new Error("show index must be a positive number");
  }
  return Number(value);
}

function findBindingByBundleId(config, bundleId) {
  if (!bundleId) {
    throw new Error("show requires a bundle id or selector index");
  }
  const summary = inspectBindings(config);
  return summary.bindings.find((binding) => binding.bundleId === bundleId) || null;
}

function getBindingTitle(config, binding, titles) {
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

function formatSelectorForCommand(selector) {
  if (selector.type === "latest") {
    return "--latest";
  }
  if (selector.type === "current") {
    return "--current";
  }
  return `--${selector.type} ${selector.value}`;
}

function getStoredSessionTitle(config, binding) {
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

function compactTitle(value) {
  return value.replace(/\s+/g, " ").trim().slice(0, 96);
}

function fallbackBindingCommitMessage(config, binding) {
  const shortCommit = binding.projectCommit ? binding.projectCommit.slice(0, 12) : "no-head";
  const branch = binding.projectBranch || "detached";
  return `sync ${config.projectName || "project"} agent sessions at ${shortCommit} (${branch})`;
}

function formatGitDate(value) {
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

function formatTimePart(date) {
  return [
    date.getHours(),
    date.getMinutes(),
    date.getSeconds()
  ].map((value) => String(value).padStart(2, "0")).join(":");
}
