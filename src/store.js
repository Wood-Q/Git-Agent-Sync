import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_STORE_BRANCH, DEFAULT_STORE_GITIGNORE, TOOL_VERSION } from "./constants.js";
import { getProjectRemote, runGit } from "./git.js";
import { isArchivedCodexSessionPath } from "./codex-archive.js";
import { isCodexSessionContentForProject } from "./codex-session.js";
import { isClaudeSessionContentForProject } from "./claude-session.js";
import { scoreProjectManifest } from "./config.js";
import { expandHome, normalizePath, readJson, toSlash, unique, writeFileAtomic, writeJson } from "./utils.js";

export function ensureStoreRepo(storePath, remote) {
  mkdirSync(storePath, { recursive: true });
  if (!existsSync(join(storePath, ".git"))) {
    runGit(["init", "-b", DEFAULT_STORE_BRANCH], storePath);
  }
  runGit(["config", "user.name", "agent-sync"], storePath);
  runGit(["config", "user.email", "agent-sync@example.invalid"], storePath);
  const gitignore = join(storePath, ".gitignore");
  if (!existsSync(gitignore)) {
    writeFileAtomic(gitignore, DEFAULT_STORE_GITIGNORE);
  }
  if (remote) {
    const current = runGit(["remote", "get-url", "origin"], storePath, { allowFail: true });
    if (current.status !== 0) {
      runGit(["remote", "add", "origin", remote], storePath);
    } else if (current.stdout.trim() !== remote) {
      runGit(["remote", "set-url", "origin", remote], storePath);
    }
  }
}

export function syncStoreFromRemote(config) {
  const { storePath, remote } = config;
  if (!remote) {
    return false;
  }

  const remoteHead = runGit(["ls-remote", "--heads", "origin", DEFAULT_STORE_BRANCH], storePath, { allowFail: true });
  if (remoteHead.status !== 0 || !remoteHead.stdout.trim()) {
    return false;
  }

  const sparse = applyStoreSparseCheckout(config);
  fetchStoreBranch(storePath);
  const branch = runGit(["rev-parse", "--verify", DEFAULT_STORE_BRANCH], storePath, { allowFail: true });
  if (branch.status !== 0) {
    removeBootstrapGitignore(storePath);
    runGit(["checkout", "-B", DEFAULT_STORE_BRANCH, `origin/${DEFAULT_STORE_BRANCH}`], storePath);
    if (sparse.enabled) {
      applyStoreSparseCheckout(config);
    }
    return true;
  }

  const upstream = runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], storePath, { allowFail: true });
  if (upstream.status !== 0 || upstream.stdout.trim() !== `origin/${DEFAULT_STORE_BRANCH}`) {
    runGit(["branch", "--set-upstream-to", `origin/${DEFAULT_STORE_BRANCH}`, DEFAULT_STORE_BRANCH], storePath);
  }
  runGit(["merge", "--ff-only", `origin/${DEFAULT_STORE_BRANCH}`], storePath);
  if (sparse.enabled) {
    applyStoreSparseCheckout(config);
  }
  return true;
}

function fetchStoreBranch(storePath) {
  const filtered = runGit(["fetch", "--filter=blob:none", "origin", DEFAULT_STORE_BRANCH], storePath, { allowFail: true });
  if (filtered.status === 0) {
    runGit(["config", "remote.origin.promisor", "true"], storePath);
    runGit(["config", "remote.origin.partialclonefilter", "blob:none"], storePath);
    return true;
  }
  runGit(["fetch", "origin", DEFAULT_STORE_BRANCH], storePath);
  runGit(["config", "--unset", "remote.origin.promisor"], storePath, { allowFail: true });
  runGit(["config", "--unset", "remote.origin.partialclonefilter"], storePath, { allowFail: true });
  return false;
}

export function applyStoreSparseCheckout(config) {
  if (!config.remote || !existsSync(join(config.storePath, ".git"))) {
    return { enabled: false, status: "disabled" };
  }
  const init = runGit(["sparse-checkout", "init", "--no-cone"], config.storePath, { allowFail: true });
  if (init.status !== 0) {
    return { enabled: false, status: "unsupported", message: (init.stderr || init.stdout || "").trim() };
  }
  const patterns = getStoreSparsePatterns(config);
  const set = runGit(["sparse-checkout", "set", "--no-cone", ...patterns], config.storePath, { allowFail: true });
  if (set.status !== 0) {
    runGit(["sparse-checkout", "disable"], config.storePath, { allowFail: true });
    return { enabled: false, status: "failed", message: (set.stderr || set.stdout || "").trim() };
  }
  return { enabled: true, status: "enabled", patterns };
}

export function getStoreSparseStatus(config) {
  if (!existsSync(join(config.storePath, ".git"))) {
    return { enabled: false, status: "missing" };
  }
  const sparse = getGitConfig(config.storePath, "core.sparseCheckout") === "true";
  const cone = getGitConfig(config.storePath, "core.sparseCheckoutCone");
  const filter = getGitConfig(config.storePath, "remote.origin.partialclonefilter") || "none";
  return {
    enabled: sparse,
    status: sparse ? "enabled" : "disabled",
    cone: cone || "unset",
    filter
  };
}

function getStoreSparsePatterns(config) {
  const projectIds = unique([config.projectId, ...(config.legacyProjectIds || [])].filter(Boolean));
  return [
    "/.gitignore",
    "/projects/*/manifest.json",
    ...projectIds.map((projectId) => `/projects/${projectId}/**`)
  ];
}

function getGitConfig(cwd, key) {
  const result = runGit(["config", "--get", key], cwd, { allowFail: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

function removeBootstrapGitignore(storePath) {
  const gitignore = join(storePath, ".gitignore");
  if (!existsSync(gitignore)) {
    return;
  }
  const status = runGit(["status", "--porcelain", "--", ".gitignore"], storePath, { allowFail: true });
  const content = readFileSync(gitignore, "utf8");
  if (status.stdout.trim() === "?? .gitignore" && content === DEFAULT_STORE_GITIGNORE) {
    unlinkSync(gitignore);
  }
}

export function pruneArchivedSidecarEntries(config, archiveInfo) {
  if (!archiveInfo) {
    return { removedFiles: 0, removedBindings: 0 };
  }

  const bundleDir = getProjectBundleDir(config);
  if (!existsSync(bundleDir)) {
    return { removedFiles: 0, removedBindings: 0 };
  }

  const manifestPath = getManifestPath(config);
  const archivedStorePaths = new Set();
  const archivedOriginalPaths = new Set();

  if (existsSync(manifestPath)) {
    try {
      const manifest = readJson(manifestPath);
      for (const match of manifest.matches || []) {
        if (match.agent === "codex" && isArchivedCodexSessionPath(match.originalPath, archiveInfo)) {
          if (match.storeRelativePath) {
            archivedStorePaths.add(join(config.storePath, match.storeRelativePath));
          }
          if (match.originalPath) {
            archivedOriginalPaths.add(normalizePath(expandHome(match.originalPath)));
          }
        }
      }
    } catch {
      // keep going; bindings cleanup still works below
    }
  }

  const bindingsPath = join(bundleDir, "bindings.jsonl");
  let removedBindings = 0;
  if (existsSync(bindingsPath)) {
    const raw = readFileSync(bindingsPath, "utf8");
    const keptLines = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      let binding;
      try {
        binding = JSON.parse(line);
      } catch {
        keptLines.push(line);
        continue;
      }
      const originalPath = binding?.originalPath ? normalizePath(expandHome(binding.originalPath)) : "";
      const shouldRemove = binding?.agent === "codex" && isArchivedCodexSessionPath(binding.originalPath, archiveInfo);
      if (shouldRemove) {
        removedBindings += 1;
        if (binding.storeRelativePath) {
          archivedStorePaths.add(join(config.storePath, binding.storeRelativePath));
        }
        if (originalPath) {
          archivedOriginalPaths.add(originalPath);
        }
        continue;
      }
      keptLines.push(line);
    }
    if (removedBindings) {
      const content = keptLines.length ? `${keptLines.join("\n")}\n` : "";
      writeFileAtomic(bindingsPath, content);
    }
  }

  let removedFiles = 0;
  for (const filePath of archivedStorePaths) {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      removedFiles += 1;
    }
  }

  return { removedFiles, removedBindings, archivedOriginalPaths: archivedOriginalPaths.size };
}

export function pruneForeignProjectSidecarEntries(config) {
  const bundleDir = getProjectBundleDir(config);
  if (!existsSync(bundleDir)) {
    return { removedFiles: 0, removedBindings: 0, removedManifestEntries: 0 };
  }

  const manifestPath = getManifestPath(config);
  const foreignStorePaths = new Set();
  const foreignBundleIds = new Set();
  let removedManifestEntries = 0;

  if (existsSync(manifestPath)) {
    try {
      const manifest = readJson(manifestPath);
      const keptMatches = [];
      for (const match of manifest.matches || []) {
        if (isForeignStoreMatch(config, match)) {
          removedManifestEntries += 1;
          foreignBundleIds.add(match.bundleId);
          if (match.storeRelativePath) {
            foreignStorePaths.add(join(config.storePath, match.storeRelativePath));
          }
          continue;
        }
        keptMatches.push(match);
      }
      if (removedManifestEntries) {
        manifest.matches = keptMatches;
        writeJson(manifestPath, manifest);
      }
    } catch {
      // keep going; bindings cleanup still works below
    }
  }

  const bindingsPath = join(bundleDir, "bindings.jsonl");
  let removedBindings = 0;
  if (existsSync(bindingsPath)) {
    const raw = readFileSync(bindingsPath, "utf8");
    const keptLines = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      let binding;
      try {
        binding = JSON.parse(line);
      } catch {
        keptLines.push(line);
        continue;
      }
      const shouldRemove = isSupportedStoreAgent(binding?.agent) && (
        foreignBundleIds.has(binding.bundleId) || isForeignStoreMatch(config, binding)
      );
      if (shouldRemove) {
        removedBindings += 1;
        foreignBundleIds.add(binding.bundleId);
        if (binding.storeRelativePath) {
          foreignStorePaths.add(join(config.storePath, binding.storeRelativePath));
        }
        continue;
      }
      keptLines.push(line);
    }
    if (removedBindings) {
      const content = keptLines.length ? `${keptLines.join("\n")}\n` : "";
      writeFileAtomic(bindingsPath, content);
    }
  }

  let removedFiles = 0;
  for (const filePath of foreignStorePaths) {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      removedFiles += 1;
    }
  }

  return { removedFiles, removedBindings, removedManifestEntries };
}

export function copyMatchesToStore(config, scan, archiveInfo = null) {
  const copied = [];
  const projectDir = join(config.storePath, "projects", config.projectId);
  for (const match of scan.matches) {
    const source = expandHome(match.originalPath);
    if (archiveInfo && match.agent === "codex" && isArchivedCodexSessionPath(source, archiveInfo)) {
      continue;
    }
    const storeRelativePath = join(
      "projects",
      config.projectId,
      match.agent,
      `${match.bundleId}${source.endsWith(".json") ? ".json" : ".jsonl"}`
    );
    const target = join(config.storePath, storeRelativePath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    match.storeRelativePath = toSlash(storeRelativePath);
    copied.push(match);
  }
  mkdirSync(projectDir, { recursive: true });
  return copied;
}

export function writeManifest(config, scan, gitContext = null) {
  const manifest = {
    ...scan,
    tool: "git-agent-sync",
    toolVersion: TOOL_VERSION,
    projectIdentity: config.projectIdentity,
    projectRemote: getProjectRemote(config.projectRoot),
    gitContext,
    legacyProjectIds: config.legacyProjectIds || [],
    matches: scan.matches.map(({ absolutePath, ...item }) => item)
  };
  writeJson(join(config.storePath, "projects", config.projectId, "manifest.json"), manifest);
}

export function pruneArchivedManifestEntries(config, archiveInfo) {
  const manifestPath = getManifestPath(config);
  if (!archiveInfo || !existsSync(manifestPath)) {
    return { removed: 0 };
  }

  let manifest;
  try {
    manifest = readJson(manifestPath);
  } catch {
    return { removed: 0 };
  }

  if (!Array.isArray(manifest.matches) || !manifest.matches.length) {
    return { removed: 0 };
  }

  const keptMatches = [];
  let removed = 0;
  for (const match of manifest.matches) {
    if (match.agent === "codex" && isArchivedCodexSessionPath(match.originalPath, archiveInfo)) {
      removed += 1;
      continue;
    }
    keptMatches.push(match);
  }

  if (!removed) {
    return { removed: 0 };
  }

  manifest.matches = keptMatches;
  writeJson(manifestPath, manifest);
  return { removed };
}

export function adoptExistingProjectBundle(config) {
  const bundle = findProjectBundle(config);
  if (!bundle || bundle.projectId === config.projectId) {
    applyStoreSparseCheckout(config);
    return;
  }
  config.projectId = bundle.projectId;
  config.legacyProjectIds = unique([...(config.legacyProjectIds || []), bundle.projectId]);
  applyStoreSparseCheckout(config);
}

export function findProjectBundle(config) {
  const projectsDir = join(config.storePath, "projects");
  const directIds = unique([config.projectId, ...(config.legacyProjectIds || [])].filter(Boolean));
  for (const projectId of directIds) {
    const manifestPath = join(projectsDir, projectId, "manifest.json");
    if (existsSync(manifestPath)) {
      return { projectId, manifestPath };
    }
  }

  if (!existsSync(projectsDir)) {
    return null;
  }

  const candidates = readdirSync(projectsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const manifestPath = join(projectsDir, entry.name, "manifest.json");
      if (!existsSync(manifestPath)) {
        return null;
      }
      const manifest = readJson(manifestPath);
      const score = scoreProjectManifest(config, manifest);
      return { projectId: entry.name, manifestPath, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.projectId.localeCompare(b.projectId));

  return candidates[0]?.score > 0 ? candidates[0] : null;
}

function isForeignStoreMatch(config, match) {
  if (!match || !isSupportedStoreAgent(match.agent) || !match.storeRelativePath) {
    return false;
  }
  const source = join(config.storePath, match.storeRelativePath);
  if (!existsSync(source)) {
    return false;
  }
  try {
    const content = readFileSync(source, "utf8");
    if (match.agent === "codex") {
      return !isCodexSessionContentForProject(content, config);
    }
    if (match.agent === "claude") {
      return !isClaudeSessionContentForProject(content, config);
    }
    return false;
  } catch {
    return false;
  }
}

function isSupportedStoreAgent(agent) {
  return agent === "codex" || agent === "claude";
}

export function getProjectBundleDir(config) {
  return join(config.storePath, "projects", config.projectId);
}

export function getManifestPath(config) {
  return join(getProjectBundleDir(config), "manifest.json");
}

export function getProjectBundleStagePath(config) {
  return toSlash(join("projects", config.projectId));
}
