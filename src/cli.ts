import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
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
import {
  formatBindingFiltersForCommand,
  hasActiveBindingFilters,
  parseArgs,
  parseBindingFilters,
  parseSelector,
  formatSelector
} from "./args.js";
import { getAgentRoot, scanSessions } from "./agents.js";
import { filterBindings, getBindingsPath, inspectBindings, queryBindings, readAllBindings, writeBindings } from "./bindings.js";
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
import {
  DEFAULT_LOCAL_WATCH_INTERVAL_SECONDS,
  checkLocalTransferWatch,
  normalizeWatchOptions,
  runLocalClean,
  runLocalRepair,
  runLocalRegister,
  runLocalTransfer
} from "./local-transfer.js";
import {
  cancelSyncJobs,
  enqueueSyncJob,
  flushSyncQueue,
  formatSyncQueueStatus,
  getSyncQueueStatus,
  retrySyncJobs,
  runDaemonLoop,
  startBackgroundSync,
  startDaemonProcess,
  stopDaemon
} from "./daemon.js";
import { rebuildEventIndexes, writeEventStoreSnapshot } from "./event-store.js";
import {
  addPrivacyAllowPattern,
  applyPrivacyRedactionsToStore,
  assertPrivacyAllowsPush,
  createPrivacyReport,
  loadPrivacyPolicy,
  normalizePrivacyMode,
  scanPrivacyMatches,
  writePrivacyReport
} from "./privacy.js";
import { restoreCommand } from "./restore.js";
import { runTui } from "./tui.js";
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
  syncNewStoreFromRemote,
  syncStoreFromRemote,
  writeManifest
} from "./store.js";
import { normalizePath, readJson, unique, writeJson } from "./utils.js";
import { getCodexArchiveInfo, isArchivedCodexSessionPath, summarizeCodexArchiveInfo } from "./codex-archive.js";
import { convertSessionToIr, exportIrReadable } from "./conversation-ir.js";
import {
  CONFLICT_RESOLUTION_STRATEGIES,
  listConflicts,
  resolveConflict,
  showConflict
} from "./conflicts.js";

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
    sync: () => syncCommand(gitRoot, args, options),
    daemon: () => daemonCommand(gitRoot, args, options),
    privacy: () => privacyCommand(gitRoot, args, options),
    tool: () => toolCommand(gitRoot, args, options),
    conflicts: () => conflictsCommand(gitRoot, args, options),
    scan: () => scanCommand(gitRoot, options),
    "clone-local": () => localTransferCommand(gitRoot, args, options),
    "watch-local": () => localTransferWatchCommand(gitRoot, options),
    "register-local": () => localRegisterCommand(gitRoot, options),
    "repair-local": () => localRepairCommand(gitRoot, options),
    "clean-local": () => localCleanCommand(gitRoot, options),
    tui: () => tuiCommand(gitRoot),
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
  git agent-sync log [--latest|--current|--branch <name>|--commit <sha>] [--agent <name>] [--author <text>] [--bundle <prefix>] [--date <YYYY-MM-DD>] [--title <text>] [--oneline] [-n <count>|-<count>] [--json]
  git agent-sync show <bundle-id>|[filters] <index> [--json]
  git agent-sync push [--m <message>] [--privacy review|redact|allow|off]
  git agent-sync pull
  git agent-sync sync [status|retry [id|all]|cancel [id|all]|--background|--flush] [--json]
  git agent-sync daemon <start|status|stop> [--once] [--interval <seconds>] [--json]
  git agent-sync privacy <scan|redact|allow-pattern-local> [--dry-run] [--json]
  git agent-sync tool <inspect|convert|export> --session <bundle-id> [--to ir|codex|claude] [--json]
  git agent-sync conflicts <list|show|resolve> [id|index] [--strategy keep-all|keep-latest|keep-local|keep-remote] [--all] [--json]
  git agent-sync scan [--json]
  git agent-sync clone-local [target-provider] [--dry-run] [--no-register] [--json]
  git agent-sync watch-local [--interval <seconds>] [--once] [--no-initial-sync] [--dry-run] [--json]
  git agent-sync register-local [--dry-run] [--json]
  git agent-sync repair-local [--dry-run] [--json]
  git agent-sync clean-local [--force] [--json]
  git agent-sync tui
  git agent-sync restore <bundle-id>|--index <n>|--i <n>|--all|[filters] [index] [--no-adapt] [--no-register]
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
  - Can clone matched Codex sessions to the current local Codex model_provider
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
  git agent-sync log [--latest|--current] [filters] [--oneline] [-n <count>|-<count>] [--json]
  git agent-sync log [--branch <name>|--commit <sha>] [filters] [--oneline] [-n <count>|-<count>] [--json]

Browses recoverable agent conversations.
Aligns with: git log.
Default Index values can be restored with git agent-sync restore --index <n>.
Uses a pager for long human-readable output when run in an interactive terminal.
Selectors:
  --latest       most recent sidecar sync batch
  --current      current project HEAD commit
  --branch name  branch label recorded during sync; may combine with other filters
  --commit sha   project commit recorded during sync; may combine with other filters
Filters:
  --agent name       codex or claude
  --author text      author name or email contains text
  --bundle prefix    bundle id prefix
  --date yyyy-mm-dd  conversation date in local time
  --title text       title contains text
Formats:
  --oneline      print one conversation per line
  -n count       limit output to count conversations
  -count         shorthand for -n count`,
    show: `Usage:
  git agent-sync show <bundle-id> [--json]
  git agent-sync show [--latest|--current|filters] <index> [--json]

Prints one agent session snapshot detail without restoring it.
Aligns with: git show <object>.`,
    push: `Usage:
  git agent-sync push [--m <message>] [--privacy review|redact|allow|off]

Copies matching agent session snapshots into the sidecar repo and commits them.
Use --m to set the sidecar commit message for this sync.
Aligns with: git push. The sidecar commit records the current project HEAD commit.
Privacy defaults to review; use --privacy redact to write redacted sidecar copies.`,
    pull: `Usage:
  git agent-sync pull

Fast-forwards the sidecar repo from its remote.
Run log or restore after pull to inspect or recover sessions.`,
    sync: `Usage:
  git agent-sync sync status [--json]
  git agent-sync sync --background [--json]
  git agent-sync sync --flush [--json]
  git agent-sync sync retry [id|all] [--json]
  git agent-sync sync cancel [id|all] [--json]

Queues, flushes, retries, or cancels local sidecar sync jobs without blocking normal project work.`,
    daemon: `Usage:
  git agent-sync daemon start [--once] [--interval <seconds>] [--json]
  git agent-sync daemon status [--json]
  git agent-sync daemon stop [--json]

Starts, inspects, or stops the local Agent-Sync background worker.`,
    privacy: `Usage:
  git agent-sync privacy scan [--json]
  git agent-sync privacy redact [--dry-run] [--json]
  git agent-sync privacy allow-pattern-local <name>=<regex> [--json]
  git agent-sync privacy allow-pattern-local <name> <regex> [--json]

Scans current-project agent sessions or updates the local privacy allowlist.`,
    tool: `Usage:
  git agent-sync tool inspect --session <bundle-id> [--json]
  git agent-sync tool convert --session <bundle-id> [--to ir] [--json]
  git agent-sync tool export --session <bundle-id> --to <codex|claude> [--mode readable]

Converts a sidecar bundle into Agent-Sync Conversation IR or readable cross-tool JSONL.`,
    conflicts: `Usage:
  git agent-sync conflicts list [--all] [--json]
  git agent-sync conflicts show <id|index> [--all] [--json]
  git agent-sync conflicts resolve <id|index> [--strategy keep-all|keep-latest|keep-local|keep-remote] [--notes <text>] [--dry-run] [--json]

Reviews sidecar conflict quarantine records without deleting any session objects.
Resolve marks the conflict metadata as handled; run git agent-sync push afterwards to publish the sidecar metadata.`,
    "clone-local": `Usage:
  git agent-sync clone-local [target-provider] [--dry-run] [--no-register] [--json]

Clones current-project Codex sessions to the target Codex model_provider.
When target-provider is omitted, Agent-Sync reads ~/.codex/config.toml.
The cloned rollout stays inside ~/.codex/sessions, records cloned_from/original_provider metadata, and registers Codex UI indexes unless --no-register is used.`,
    "watch-local": `Usage:
  git agent-sync watch-local [--interval <seconds>] [--once] [--no-initial-sync] [--dry-run] [--json]

Watches ~/.codex/config.toml for model_provider changes and clones current-project Codex sessions to the active provider.
Defaults to an interval of ${DEFAULT_LOCAL_WATCH_INTERVAL_SECONDS} seconds.`,
    "register-local": `Usage:
  git agent-sync register-local [--dry-run] [--json]

Registers Agent-Sync local Codex provider clones in this machine's Codex UI indexes without rewriting rollout files.`,
    "repair-local": `Usage:
  git agent-sync repair-local [--dry-run] [--json]

Repairs local Codex UI registration for Agent-Sync provider clones without rewriting the rollout files.`,
    "clean-local": `Usage:
  git agent-sync clean-local [--force] [--json]

Previews Agent-Sync local Codex provider clone cleanup by default.
Use --force to remove only current-project rollout files created by clone-local.`,
    tui: `Usage:
  git agent-sync tui

Opens an interactive terminal menu for status, log, pull, push, restore, local Codex provider clone, and local watch operations.`,
    restore: `Usage:
  git agent-sync restore <bundle-id> [--no-adapt] [--no-register]
  git agent-sync restore --index <n> [--no-adapt] [--no-register]
  git agent-sync restore --i <n> [--no-adapt] [--no-register]
  git agent-sync restore --all [--no-adapt] [--no-register]
  git agent-sync restore [--latest|--current|filters] [index|--index <n>|--i <n>] [--no-adapt] [--no-register]

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
  const initSync = syncNewStoreFromRemote(config);
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
  if (initSync.status === "synced") {
    console.log(`agent-sync: initialized sidecar store from origin/${DEFAULT_STORE_BRANCH}.`);
  } else if (initSync.status === "unrelated") {
    console.log(`agent-sync: existing sidecar history is unrelated to origin/${DEFAULT_STORE_BRANCH}; init left it unchanged.`);
  } else if (initSync.status === "diverged") {
    console.log(`agent-sync: existing sidecar history has diverged from origin/${DEFAULT_STORE_BRANCH}; init left it unchanged.`);
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

function privacyCommand(gitRoot, args, options) {
  const action = args[0] || "scan";
  if (!["scan", "redact", "allow-pattern-local"].includes(action)) {
    throw new Error(`unknown privacy action "${action}". Run "git agent-sync privacy --help".`);
  }
  if (action === "allow-pattern-local") {
    const result = addPrivacyAllowPattern(gitRoot, args[1], args[2]);
    printPrivacyAllowPatternResult(result, options);
    return;
  }
  const config = readConfigWithBundle(gitRoot);
  const scan = scanSessions(gitRoot, config);
  const policy = loadPrivacyPolicy(gitRoot);
  const report = scanPrivacyMatches(scan.matches, policy);
  report.mode = action;
  if (action === "redact") {
    report.redacted = !options.dryRun;
  }
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printPrivacyReport(report, { dryRun: options.dryRun, action });
}

function toolCommand(gitRoot, args, options) {
  const action = args[0] || "inspect";
  if (!["inspect", "convert", "export"].includes(action)) {
    throw new Error(`unknown tool action "${action}". Run "git agent-sync tool --help".`);
  }
  const config = readConfigWithBundle(gitRoot);
  const bundleId = options.session || args[1];
  const binding = findBindingByBundleId(config, bundleId);
  if (!binding) {
    throw new Error(`no bundle found for "${bundleId || ""}"`);
  }
  const sourcePath = join(config.storePath, binding.storeRelativePath);
  const content = readFileSync(sourcePath, "utf8");
  const ir = convertSessionToIr(binding.agent, content, {
    ...binding,
    sourcePath,
    projectRoot: config.projectRoot,
    projectIdentity: config.projectIdentity
  });

  if (action === "export") {
    const exported = exportIrReadable(ir, {
      to: options.to || "ir",
      mode: options.mode || "readable"
    });
    if (options.json) {
      console.log(JSON.stringify({ ok: true, format: "jsonl", content: exported }, null, 2));
    } else {
      process.stdout.write(exported);
    }
    return;
  }

  if (options.json || action === "convert") {
    console.log(JSON.stringify(ir, null, 2));
    return;
  }

  console.log(`bundle: ${binding.bundleId}`);
  console.log(`agent:  ${binding.agent}`);
  console.log(`title:  ${ir.conversation.title || binding.title || binding.bundleId}`);
  console.log(`events: ${ir.events.length}`);
  console.log(`tools:  ${ir.events.filter((event) => event.type === "tool_call").length} call(s), ${ir.events.filter((event) => event.type === "tool_result").length} result(s)`);
}

function conflictsCommand(gitRoot, args, options) {
  const action = args[0] || "list";
  if (!["list", "show", "resolve"].includes(action)) {
    throw new Error(`unknown conflicts action "${action}". Run "git agent-sync conflicts --help".`);
  }
  const config = readConfigWithBundle(gitRoot);

  if (action === "list") {
    const conflicts = listConflicts(config, { all: options.all });
    if (options.json) {
      console.log(JSON.stringify(conflicts, null, 2));
      return;
    }
    printConflictList(conflicts, options);
    return;
  }

  if (action === "show") {
    const conflict = showConflict(config, args[1], { all: options.all });
    if (options.json) {
      console.log(JSON.stringify(conflict.raw, null, 2));
      return;
    }
    printConflictDetail(conflict);
    return;
  }

  const conflict = resolveConflict(config, args[1], {
    all: options.all,
    dryRun: options.dryRun,
    notes: options.notes,
    strategy: options.strategy
  });
  if (options.json) {
    console.log(JSON.stringify(conflict, null, 2));
    return;
  }
  const prefix = conflict.dryRun ? "would mark" : "marked";
  console.log(`agent-sync: ${prefix} conflict ${conflict.id} resolved with ${conflict.resolution?.strategy || "keep-all"}.`);
  if (!conflict.dryRun) {
    console.log("agent-sync: run git agent-sync push to publish this sidecar conflict metadata.");
  }
}

function localTransferCommand(gitRoot, args, options) {
  const config = readConfigWithBundle(gitRoot);
  const result = runLocalTransfer(gitRoot, config, {
    ...options,
    targetProvider: args[0] || ""
  });
  printLocalTransferResult(result, options);
}

function localRepairCommand(gitRoot, options) {
  const config = readConfigWithBundle(gitRoot);
  const result = runLocalRepair(gitRoot, config, options);
  printLocalTransferResult(result, options);
}

function localRegisterCommand(gitRoot, options) {
  const config = readConfigWithBundle(gitRoot);
  const result = runLocalRegister(gitRoot, config, options);
  printLocalTransferResult(result, options);
}

function localCleanCommand(gitRoot, options) {
  const config = readConfigWithBundle(gitRoot);
  const result = runLocalClean(gitRoot, config, options);
  printLocalTransferResult(result, options);
}

async function localTransferWatchCommand(gitRoot, options) {
  const config = readConfigWithBundle(gitRoot);
  const watchOptions = normalizeWatchOptions(options);
  let previousProvider = "";

  if (!options.json && !watchOptions.once) {
    console.log(`agent-sync: watching Codex model_provider every ${watchOptions.intervalSeconds}s. Press Ctrl+C to stop.`);
  }

  while (true) {
    const event = checkLocalTransferWatch(gitRoot, config, watchOptions, previousProvider);
    previousProvider = event.provider;
    printLocalTransferWatchEvent(event, options);
    if (watchOptions.once) {
      return;
    }
    await sleep(watchOptions.intervalSeconds * 1000);
  }
}

async function tuiCommand(gitRoot) {
  const config = readConfigWithBundle(gitRoot);
  await runTui(gitRoot, config);
}

function logCommand(gitRoot, options) {
  const config = readConfigWithBundle(gitRoot);
  const selector = parseSelector(options, { requireSelector: false });
  const filters = parseBindingFilters(options, selector);
  const bindings = limitBindings(getFilteredBindings(config, selector, filters, gitRoot), options);

  if (options.json) {
    console.log(JSON.stringify(bindings, null, 2));
    return;
  }

  pageOrPrint(renderBindings(config, bindings, selector, filters, options));
}

function showCommand(gitRoot, args, options) {
  const config = readConfigWithBundle(gitRoot);
  const selector = parseSelector(options, { requireSelector: false });
  const filters = parseBindingFilters(options, selector);
  const scoped = selector || hasActiveBindingFilters(filters);
  const match = scoped
    ? selectBindingByIndex(getFilteredBindings(config, selector, filters, gitRoot), parseRequiredIndex(args, options, selector, filters), selector, filters)
    : findBindingByBundleId(config, args[0]);
  if (!match) {
    throw new Error(scoped ? `no bindings found for ${formatQueryScope(selector, filters)}` : `no bundle found for "${args[0] || ""}"`);
  }

  if (options.json) {
    console.log(JSON.stringify(match, null, 2));
    return;
  }
  printBindingDetail(config, match);
}

function pushCommand(gitRoot, options: Record<string, any> = {}) {
  const config = readConfigWithBundle(gitRoot);
  ensureStoreRepo(config.storePath, config.remote);
  syncStoreFromRemote(config, {
    onMerge: () => rebuildMergedEventIndexes(config)
  });
  adoptExistingProjectBundle(config);
  writeConfig(gitRoot, config);
  const gitContext = getGitContext(gitRoot);
  const syncRunId = `${new Date().toISOString()}:${gitContext.headCommit}`;
  const archiveInfo = getCodexArchiveInfo(getAgentRoot("codex"), { gitRoot });
  const scan = scanSessions(gitRoot, config, archiveInfo);
  writeJson(join(gitRoot, CACHE_FILE), scan);
  const privacyMode = normalizePrivacyMode(options.privacy);
  const privacyPolicy = loadPrivacyPolicy(gitRoot);
  const privacyReport: Record<string, any> = privacyMode === "off" || privacyMode === "allow"
    ? createPrivacyReport([], privacyPolicy, { mode: privacyMode })
    : scanPrivacyMatches(scan.matches, privacyPolicy);
  privacyReport.mode = privacyMode;
  assertPrivacyAllowsPush(privacyReport, privacyMode);

  const pruned = pruneArchivedSidecarEntries(config, archiveInfo);
  const foreignPruned = pruneForeignProjectSidecarEntries(config);
  const copied = copyMatchesToStore(config, scan, archiveInfo);
  const redactions = privacyMode === "redact"
    ? applyPrivacyRedactionsToStore(config, scan.matches, privacyPolicy)
    : { filesChanged: 0 };
  if (privacyMode !== "off" && privacyReport.totalFindings > 0) {
    privacyReport.redacted = privacyMode === "redact";
    privacyReport.filesChanged = redactions.filesChanged;
    writePrivacyReport(config, privacyReport);
  }
  writeManifest(config, scan, gitContext);
  const commitMessage = getPushCommitMessage(config, gitContext, options);
  const author = getProjectGitAuthor(gitRoot);
  const bindingsAdded = writeBindings(config, scan.matches, gitContext, syncRunId, {
    message: commitMessage,
    authorName: author.name,
    authorEmail: author.email
  });
  const eventStore = writeEventStoreSnapshot(config, scan.matches, gitContext, syncRunId, {
    message: commitMessage,
    authorName: author.name,
    authorEmail: author.email,
    preferStoreContent: privacyMode === "redact"
  });

  stageProjectBundle(config);
  const diff = runGit(["diff", "--cached", "--quiet"], config.storePath, { allowFail: true });
  if (diff.status === 0) {
    console.log(`agent-sync: no sidecar changes (${copied.length} matched session(s), ${pruned.removedFiles} archived removed, ${foreignPruned.removedFiles} foreign removed).`);
  } else {
    runGit(["-c", `user.name=${author.name}`, "-c", `user.email=${author.email}`, "commit", "-m", commitMessage], config.storePath);
    console.log(`agent-sync: committed ${copied.length} matched session file(s), ${bindingsAdded} new binding(s), ${eventStore.eventsWritten} event(s), ${eventStore.objectsWritten} object(s), ${redactions.filesChanged} redacted file(s), ${pruned.removedFiles} archived removed, ${foreignPruned.removedFiles} foreign removed.`);
  }

  if (config.remote) {
    pushStoreWithRetry(config);
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

function pushStoreWithRetry(config) {
  const first = runGit(["push", "-u", "origin", DEFAULT_STORE_BRANCH], config.storePath, { allowFail: true });
  if (first.status === 0) {
    return { retried: false };
  }
  if (!isRejectedStorePush(first)) {
    throw new Error(`git push -u origin ${DEFAULT_STORE_BRANCH} failed: ${(first.stderr || first.stdout || "").trim()}`);
  }

  console.log(`agent-sync: sidecar push was rejected; fetching ${DEFAULT_STORE_BRANCH}, replaying event indexes, and retrying.`);
  syncStoreFromRemote(config, {
    onMerge: () => rebuildMergedEventIndexes(config)
  });
  rebuildMergedEventIndexes(config);
  const retry = runGit(["push", "-u", "origin", DEFAULT_STORE_BRANCH], config.storePath, { allowFail: true });
  if (retry.status !== 0) {
    throw new Error(`git push -u origin ${DEFAULT_STORE_BRANCH} failed after retry: ${(retry.stderr || retry.stdout || "").trim()}`);
  }
  return { retried: true };
}

function rebuildMergedEventIndexes(config) {
  const rebuilt = rebuildEventIndexes(config);
  stageProjectBundle(config);
  const diff = runGit(["diff", "--cached", "--quiet"], config.storePath, { allowFail: true });
  if (diff.status !== 0) {
    runGit(["commit", "-m", `rebuild ${config.projectName} sidecar event indexes`], config.storePath);
    console.log(`agent-sync: rebuilt event indexes from ${rebuilt.events} event(s), ${rebuilt.conflicts || 0} conflict(s).`);
  }
  return rebuilt;
}

function isRejectedStorePush(result) {
  const output = `${result.stderr || ""}\n${result.stdout || ""}`.toLowerCase();
  return output.includes("rejected") ||
    output.includes("fetch first") ||
    output.includes("non-fast-forward") ||
    output.includes("failed to push some refs");
}

async function syncCommand(gitRoot, args, options) {
  const action = args[0] || "";
  if (action === "status" || (!action && options.json && !options.background && !options.flush)) {
    printQueueStatus(gitRoot, options);
    return;
  }
  if (action && !["background", "flush", "retry", "cancel"].includes(action)) {
    throw new Error(`unknown sync action "${action}". Run "git agent-sync sync --help".`);
  }

  if (options.flush || action === "flush") {
    const result = flushSyncQueue(gitRoot);
    printSyncResult(result, options);
    return;
  }
  if (action === "retry") {
    const result = retrySyncJobs(gitRoot, args[1] || "all");
    printQueueMutationResult(result, options);
    return;
  }
  if (action === "cancel") {
    const result = cancelSyncJobs(gitRoot, args[1] || "all");
    printQueueMutationResult(result, options);
    return;
  }

  const config = readConfigWithBundle(gitRoot);
  const job = enqueueSyncJob(gitRoot, config, {
    action: "push",
    reason: options.background || action === "background" ? "background-sync" : "manual-sync"
  });
  let worker = null;
  if (options.background || action === "background") {
    worker = startBackgroundSync(gitRoot);
  }
  const result = { version: 1, job, worker };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`agent-sync: queued sync job ${job.id}.`);
  if (worker) {
    console.log(`agent-sync: started background worker pid ${worker.pid}.`);
  } else {
    console.log("agent-sync: run git agent-sync sync --flush to process the queue.");
  }
}

async function daemonCommand(gitRoot, args, options) {
  const action = args[0] || "status";
  if (action === "status") {
    printQueueStatus(gitRoot, options);
    return;
  }
  if (action === "stop") {
    const result = stopDaemon(gitRoot);
    printDaemonResult(result, options);
    return;
  }
  if (action === "start") {
    if (options.once) {
      const result = await runDaemonLoop(gitRoot, {
        once: true,
        intervalSeconds: parseDaemonInterval(options)
      });
      printDaemonResult({ mode: "foreground-once", result }, options);
      return;
    }
    const result = startDaemonProcess(gitRoot, {
      intervalSeconds: parseDaemonInterval(options)
    });
    printDaemonResult(result, options);
    return;
  }
  if (action === "run") {
    const result = await runDaemonLoop(gitRoot, {
      intervalSeconds: parseDaemonInterval(options)
    });
    printDaemonResult(result, options);
    return;
  }
  throw new Error(`unknown daemon action "${action}". Run "git agent-sync daemon --help".`);
}

function installHooksCommand(gitRoot) {
  const hookPath = resolveHookPath(gitRoot);
  mkdirSync(dirname(hookPath), { recursive: true });
  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, "utf8");
    if (!isAgentSyncHook(existing)) {
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
  git-agent-sync sync --background >/dev/null 2>&1 || true
elif command -v agent-sync >/dev/null 2>&1; then
  agent-sync sync --background >/dev/null 2>&1 || true
else
  echo "agent-sync: git-agent-sync not found; skipping background session sync" >&2
fi
`;
  writeFileSync(hookPath, hook, { mode: 0o755 });
  console.log(`agent-sync: installed pre-push hook at ${hookPath}`);
}

function uninstallHooksCommand(gitRoot) {
  const hookPath = resolveHookPath(gitRoot);
  if (!existsSync(hookPath)) {
    console.log("agent-sync: no pre-push hook installed.");
    return;
  }
  const content = readFileSync(hookPath, "utf8");
  if (!isAgentSyncHook(content)) {
    throw new Error(`pre-push hook was not installed by agent-sync: ${hookPath}`);
  }
  unlinkSync(hookPath);
  console.log(`agent-sync: removed pre-push hook at ${hookPath}`);
}

function resolveHookPath(gitRoot) {
  const hookRelative = getGitValue(["rev-parse", "--git-path", "hooks/pre-push"], gitRoot);
  if (!hookRelative) {
    return join(gitRoot, ".git", "hooks", "pre-push");
  }
  return resolve(gitRoot, hookRelative);
}

function isAgentSyncHook(content) {
  // New marker (5445bfa+) and the original header used before the marker existed.
  return content.includes("AGENT_SYNC_HOOK=pre-push") || content.includes("# Installed by git-agent-sync");
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
  const paths = [".gitignore", getProjectBundleStagePath(config)];
  for (const optionalPath of ["objects", "events", "conflicts"]) {
    if (existsSync(join(config.storePath, optionalPath))) {
      paths.push(optionalPath);
    }
  }
  runGit(["add", "--", ...paths], config.storePath);
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

function printLocalTransferResult(result, options: Record<string, any> = {}) {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.mode === "register") {
    console.log("agent-sync: register local Codex provider clone sessions");
    console.log(`registered: ${result.stats.registered}, dry-run: ${result.stats.dry_run}, skipped: ${result.stats.skipped_unmarked + result.stats.skipped_foreign}, errors: ${result.stats.error}`);
    for (const item of result.results) {
      if (item.action === "registered" || item.action === "dry_run") {
        console.log(`[${item.action}] ${item.path}`);
      } else if (item.action === "error") {
        console.log(`[error] ${item.path}: ${item.message}`);
      }
    }
    return;
  }

  if (result.mode === "repair") {
    console.log("agent-sync: repair local Codex provider clone registration");
    console.log(`repaired: ${result.stats.repaired}, dry-run: ${result.stats.dry_run}, skipped: ${result.stats.skipped_unmarked + result.stats.skipped_foreign}, errors: ${result.stats.error}`);
    for (const item of result.results) {
      if (item.action === "repaired" || item.action === "dry_run") {
        console.log(`[${item.action}] ${item.path}`);
      } else if (item.action === "error") {
        console.log(`[error] ${item.path}: ${item.message}`);
      }
    }
    return;
  }

  if (result.mode === "clean") {
    console.log(`agent-sync: ${result.dryRun ? "preview" : "clean"} local Codex provider clones`);
    console.log(`removed: ${result.stats.removed}, dry-run: ${result.stats.dry_run}, skipped: ${result.stats.skipped_unmarked + result.stats.skipped_foreign}, errors: ${result.stats.error}`);
    for (const item of result.results) {
      if (item.action === "removed" || item.action === "dry_run") {
        console.log(`[${item.action}] ${item.path}`);
      } else if (item.action === "error") {
        console.log(`[error] ${item.path}: ${item.message}`);
      }
    }
    if (result.dryRun) {
      console.log("agent-sync: dry run, add --force to remove generated local clone files.");
    }
    return;
  }

  console.log(`agent-sync: clone Codex sessions to provider ${result.provider}`);
  console.log(`candidates: ${result.candidates}`);
  console.log(`cloned: ${result.stats.cloned}, skipped: ${result.stats.skipped_exists + result.stats.skipped_target + result.stats.skipped_collision}, errors: ${result.stats.error}`);
  for (const item of result.results) {
    if (item.action === "cloned") {
      console.log(`[${item.action}] ${item.targetPath}`);
    } else if (item.action === "skipped_collision" || item.action === "error") {
      console.log(`[skip] ${item.sourceBundleId}: ${item.message}`);
    }
  }
  if (result.dryRun) {
    console.log("agent-sync: dry run, no local session files were written.");
  }
}

function printLocalTransferWatchEvent(event, options: Record<string, any> = {}) {
  if (options.json) {
    console.log(JSON.stringify(event, null, 2));
    return;
  }
  if (!event.result) {
    return;
  }
  const label = event.changed ? `provider changed: ${event.previousProvider} -> ${event.provider}` : `initial provider sync: ${event.provider}`;
  console.log(`agent-sync: ${label} at ${event.checkedAt}`);
  printLocalTransferResult(event.result, options);
}

function printQueueStatus(gitRoot, options) {
  const status = getSyncQueueStatus(gitRoot);
  if (options.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  console.log(formatSyncQueueStatus(status));
}

function printSyncResult(result, options) {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.locked) {
    console.log(`agent-sync: ${result.message}`);
    return;
  }
  console.log(`agent-sync: processed ${result.processed} sync job(s), ${result.succeeded} succeeded, ${result.retried} queued for retry, ${result.failed} failed.`);
}

function printQueueMutationResult(result, options) {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.locked) {
    console.log(`agent-sync: ${result.message}`);
    return;
  }
  const verb = result.action === "retry" ? "queued for retry" : "cancelled";
  console.log(`agent-sync: ${verb} ${result.changed} sync job(s).`);
  if (!result.changed) {
    console.log(`agent-sync: no matching ${result.action === "retry" ? "failed or cancelled" : "pending"} job found for "${result.selector}".`);
  }
}

function printDaemonResult(result, options) {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.mode === "background") {
    console.log(`agent-sync: daemon started with pid ${result.pid}.`);
  } else if (result.mode === "foreground-once") {
    console.log("agent-sync: daemon flushed the queue once.");
  } else if (result.status) {
    console.log(`agent-sync: daemon ${result.status}.`);
  } else {
    console.log("agent-sync: daemon command complete.");
  }
}

function parseDaemonInterval(options) {
  if (!options.interval) {
    return undefined;
  }
  if (!/^\d+$/.test(String(options.interval)) || Number(options.interval) < 1) {
    throw new Error("daemon --interval must be a positive number of seconds");
  }
  return Number(options.interval);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
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

function printPrivacyReport(report, options: Record<string, any> = {}) {
  const action = options.action || "scan";
  console.log(`privacy: ${report.totalFindings} finding(s)`);
  if (action === "redact" && options.dryRun) {
    console.log("mode:    dry-run redaction preview");
  } else if (action === "redact") {
    console.log("mode:    redaction preview; use push --privacy redact to write sidecar copies");
  }
  for (const finding of report.findings.slice(0, 50)) {
    console.log(`- ${finding.rule} ${finding.path}:${finding.line}:${finding.column} ${finding.preview}`);
  }
  if (report.findings.length > 50) {
    console.log(`... ${report.findings.length - 50} more finding(s)`);
  }
}

function printPrivacyAllowPatternResult(result, options: Record<string, any> = {}) {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const status = result.changed ? "added" : "already exists";
  console.log(`privacy: ${status} allow pattern ${result.rule.name}`);
  console.log(`pattern: ${result.rule.pattern}`);
  console.log(`policy:  ${result.path}`);
}

function printConflictList(conflicts, options: Record<string, any> = {}) {
  const scope = options.all ? "all" : "active";
  console.log(`conflicts: ${conflicts.length} ${scope} conflict(s)`);
  if (!conflicts.length) {
    console.log(options.all ? "agent-sync: no conflicts found." : "agent-sync: no active conflicts found.");
    return;
  }
  for (const conflict of conflicts) {
    console.log(`${conflict.index}. ${conflict.id} ${conflict.agent}/${conflict.sessionId} ${conflict.status} ${conflict.objectHashes.length} object(s), ${conflict.eventCount} event(s)`);
    console.log(`   show:    git agent-sync conflicts show ${conflict.index}`);
    console.log(`   resolve: git agent-sync conflicts resolve ${conflict.index} --strategy keep-all`);
  }
}

function printConflictDetail(conflict) {
  console.log(`id:       ${conflict.id}`);
  console.log(`status:   ${conflict.status}`);
  console.log(`type:     ${conflict.type}`);
  console.log(`agent:    ${conflict.agent}`);
  console.log(`session:  ${conflict.sessionId}`);
  console.log(`path:     ${conflict.relativePath}`);
  console.log(`objects:  ${conflict.objectHashes.length}`);
  for (const hash of conflict.objectHashes) {
    console.log(`  - ${hash}`);
  }
  console.log(`events:   ${conflict.eventCount}`);
  for (const event of conflict.events) {
    console.log(`  - ${event.syncedAt || "unknown"} ${event.machineId || "unknown"} ${event.bundleId || "unknown"} ${event.objectHash || "unknown"}`);
  }
  if (conflict.resolution) {
    console.log(`resolved: ${conflict.resolvedAt || "unknown"} (${conflict.resolution.strategy || "unknown"})`);
    if (conflict.resolution.notes) {
      console.log(`notes:    ${conflict.resolution.notes}`);
    }
  } else {
    console.log(`resolve:  git agent-sync conflicts resolve ${conflict.id} --strategy keep-all`);
    console.log(`strategies: ${CONFLICT_RESOLUTION_STRATEGIES.join(", ")}`);
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

function getFilteredBindings(config, selector, filters, gitRoot) {
  const bindings = selector ? queryBindings(config, selector, gitRoot) : readAllBindings(config);
  if (!hasActiveBindingFilters(filters)) {
    return bindings;
  }
  const titles = loadCodexSessionTitles();
  return filterBindings(bindings, filters, {
    getTitle: (binding) => getBindingTitle(config, binding, titles)
  });
}

function renderBindings(config, bindings, selector, filters, options: Record<string, any> = {}) {
  return options.oneline
    ? renderBindingsOneline(config, bindings)
    : renderBindingsFull(config, bindings, selector, filters);
}

function renderBindingsOneline(config, bindings) {
  const titles = loadCodexSessionTitles();
  return bindings.map((binding, index) => {
    const title = getBindingTitle(config, binding, titles);
    const message = binding.commitMessage || fallbackBindingCommitMessage(config, binding);
    return `${index + 1}  ${title}  ${message}`;
  }).join("\n");
}

function renderBindingsFull(config, bindings, selector, filters = {}) {
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

function selectBindingByIndex(bindings, index, selector, filters = {}) {
  if (!bindings.length) {
    return null;
  }
  if (index > bindings.length) {
    throw new Error(`show index ${index} is out of range for ${formatQueryScope(selector, filters)} (${bindings.length} binding(s))`);
  }
  return bindings[index - 1] || null;
}

function parseRequiredIndex(args, options, selector, filters = {}) {
  const value = options.index ?? args[0];
  if (value === null || value === undefined) {
    throw new Error(`show ${formatQueryScope(selector, filters)} requires an index`);
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
  return readAllBindings(config).find((binding) => binding.bundleId === bundleId) || null;
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

function formatQueryScopeForCommand(selector, filters = {}) {
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
