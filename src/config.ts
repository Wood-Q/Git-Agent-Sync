import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { CONFIG_FILE, DEFAULT_AGENT_DIR } from "./constants.js";
import { getProjectIdentity, normalizeRemoteUrl } from "./git.js";
import { normalizePath, readJson, sha256, unique, writeFileAtomic, writeJson } from "./utils.js";

export function readConfig(gitRoot) {
  const path = join(gitRoot, CONFIG_FILE);
  if (!existsSync(path)) {
    throw new Error("agent-sync is not initialized. Run \"git agent-sync init\" first.");
  }
  const config = readJson(path);
  const projectName = config.projectName || basename(gitRoot);
  const projectIdentity = config.projectIdentity || getProjectIdentity(gitRoot);
  const legacyProjectId = legacyProjectIdForPath(gitRoot);
  const stableId = stableProjectId(projectName, projectIdentity);
  const configuredProjectId = config.projectId;
  const isLegacyConfig = !config.projectIdentity;
  return {
    ...config,
    projectName,
    projectRoot: gitRoot,
    storePath: normalizePath(resolve(gitRoot, config.storePath || DEFAULT_AGENT_DIR)),
    projectIdentity,
    projectId: isLegacyConfig ? stableId : config.projectId || stableId,
    legacyProjectIds: unique([...(config.legacyProjectIds || []), configuredProjectId, legacyProjectId].filter(Boolean))
  };
}

export function writeConfig(gitRoot, config) {
  writeJson(join(gitRoot, CONFIG_FILE), config);
}

export function writeGitignoreEntry(gitRoot, entry) {
  const gitignore = join(gitRoot, ".gitignore");
  const line = `${entry}/`;
  const existing = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : "";
  if (!existing.split(/\r?\n/).includes(line)) {
    writeFileAtomic(gitignore, `${existing}${existing.endsWith("\n") || existing.length === 0 ? "" : "\n"}${line}\n`);
  }
}

export function stableProjectId(projectName, projectIdentity) {
  return `${projectName}-${sha256(projectIdentity).slice(0, 10)}`;
}

export function legacyProjectIdForPath(gitRoot) {
  return `${basename(gitRoot)}-${sha256(normalizePath(gitRoot)).slice(0, 10)}`;
}

export function scoreProjectManifest(config, manifest) {
  let score = 0;
  if (manifest.projectId && config.legacyProjectIds?.includes(manifest.projectId)) {
    score += 5;
  }
  if (manifest.legacyProjectIds?.includes(config.projectId)) {
    score += 5;
  }
  if (manifest.projectIdentity && manifest.projectIdentity === config.projectIdentity) {
    score += 4;
  }
  if (manifest.projectName && manifest.projectName === config.projectName) {
    score += 2;
  }
  const manifestRepo = normalizeRemoteUrl(manifest.projectRemote || manifest.remote || "");
  if (manifestRepo && `git:${manifestRepo}` === config.projectIdentity) {
    score += 4;
  }
  return score;
}
