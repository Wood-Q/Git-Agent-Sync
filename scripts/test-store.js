import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  adoptExistingProjectBundle,
  applyStoreSparseCheckout,
  copyMatchesToStore,
  ensureStoreRepo,
  findProjectBundle,
  getManifestPath,
  getProjectBundleStagePath,
  writeManifest
} from "../dist/store.js";

const base = mkdtempSync(join(tmpdir(), "agent-sync-store-unit-"));

function makeConfig(overrides = {}) {
  const storePath = join(base, overrides.storeName || "store");
  mkdirSync(storePath, { recursive: true });
  return {
    projectId: "Project-aaaaaaaaaa",
    projectIdentity: "git:github.com/you/project",
    projectName: "Project",
    projectRoot: join(base, "project"),
    storePath,
    legacyProjectIds: [],
    ...overrides
  };
}

// --- ensureStoreRepo: inits a git repo + gitignore ----------------------
{
  const storePath = join(base, "ensure-1");
  ensureStoreRepo(storePath, null);
  assert.equal(existsSync(join(storePath, ".git")), true);
  assert.equal(existsSync(join(storePath, ".gitignore")), true);
  // Idempotent: running again does not throw.
  ensureStoreRepo(storePath, null);
  assert.equal(existsSync(join(storePath, ".git")), true);
}

// --- path helpers --------------------------------------------------------
{
  const config = makeConfig();
  assert.equal(getManifestPath(config), join(config.storePath, "projects", config.projectId, "manifest.json"));
  assert.equal(getProjectBundleStagePath(config), "projects/Project-aaaaaaaaaa");
}

// --- writeManifest + findProjectBundle: direct id hit -------------------
{
  const config = makeConfig({ storeName: "manifest-1" });
  const scan = { matches: [], version: 1, projectId: config.projectId };
  writeManifest(config, scan, { branch: "main", headCommit: "abc", baseCommit: "abc", dirty: false });
  assert.equal(existsSync(getManifestPath(config)), true);

  const bundle = findProjectBundle(config);
  assert.equal(bundle.projectId, config.projectId);
  assert.equal(bundle.manifestPath, getManifestPath(config));
}

// --- findProjectBundle: legacy id still matches -------------------------
{
  const config = makeConfig({ storeName: "manifest-legacy" });
  // Write a manifest under an OLD project id, then look it up via legacyProjectIds.
  const oldId = "Project-legacyhash00";
  const legacyConfig = { ...config, projectId: "Project-newhash0001", legacyProjectIds: [oldId] };
  const scan = { matches: [], version: 1, projectId: oldId };
  // writeManifest writes under config.projectId, so temporarily use the old id.
  writeManifest({ ...config, projectId: oldId }, scan, null);

  const bundle = findProjectBundle(legacyConfig);
  assert.equal(bundle.projectId, oldId);
}

// --- findProjectBundle: scores compatible bundles by identity -----------
{
  const config = makeConfig({ storeName: "manifest-score", projectIdentity: "git:github.com/you/scorable" });
  // A foreign project dir with a manifest that shares identity but a different id.
  const compatId = "Scorable-deadbeef00";
  mkdirSync(join(config.storePath, "projects", compatId), { recursive: true });
  writeFileSync(
    join(config.storePath, "projects", compatId, "manifest.json"),
    `${JSON.stringify({
      projectId: compatId,
      projectName: "Project",
      projectIdentity: "git:github.com/you/scorable",
      matches: []
    })}\n`
  );
  const bundle = findProjectBundle(config);
  assert.equal(bundle.projectId, compatId);
  assert.ok(bundle.score > 0);
}

// --- findProjectBundle: no matches returns null -------------------------
{
  const config = makeConfig({ storeName: "manifest-empty" });
  // storePath exists but has no projects dir.
  assert.equal(findProjectBundle(config), null);
}

// --- copyMatchesToStore: copies files into projects/<id>/<agent>/ -------
{
  const config = makeConfig({ storeName: "copy-1" });
  const sourceDir = join(base, "sources");
  mkdirSync(sourceDir, { recursive: true });
  const sourceFile = join(sourceDir, "session.jsonl");
  writeFileSync(sourceFile, `{"type":"session_meta","payload":{"id":"s1"}}\n`);

  const scan = {
    matches: [
      {
        agent: "codex",
        bundleId: "codex-123",
        originalPath: sourceFile,
        sha256: "deadbeef"
      }
    ]
  };
  const copied = copyMatchesToStore(config, scan);
  assert.equal(copied.length, 1);
  assert.equal(copied[0].storeRelativePath, `projects/${config.projectId}/codex/codex-123.jsonl`);
  const target = join(config.storePath, copied[0].storeRelativePath);
  assert.equal(existsSync(target), true);
  assert.equal(readFileSync(target, "utf8"), `{"type":"session_meta","payload":{"id":"s1"}}\n`);
}

// --- applyStoreSparseCheckout -------------------------------------------
// Sparse checkout only activates when a remote is configured AND the store is a
// git repo. Without a remote it stays disabled. (The full positive sparse path
// with a seeded remote history is covered by test-store-promisor and test-e2e.)
{
  const storePath = join(base, "sparse-noremote");
  ensureStoreRepo(storePath, null);
  const config = { ...makeConfig({ storeName: "sparse-noremote" }), storePath };
  const result = applyStoreSparseCheckout(config);
  assert.equal(result.enabled, false);
}

// adoptExistingProjectBundle with no existing bundle is a safe no-op on the
// bundle side (sparse checkout is disabled without a remote, so it just returns).
{
  const storePath = join(base, "adopt-empty");
  ensureStoreRepo(storePath, null);
  const config = { ...makeConfig({ storeName: "adopt-empty" }), storePath };
  assert.doesNotThrow(() => adoptExistingProjectBundle(config));
}

rmSync(base, { recursive: true, force: true });
console.log("store unit test passed");
