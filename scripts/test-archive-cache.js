import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getCodexArchiveInfo } from "../dist/codex-archive.js";
import { ARCHIVE_CACHE_FILE } from "../dist/constants.js";

const base = mkdtempSync(join(tmpdir(), "agent-sync-archive-cache-"));
const project = join(base, "project");
const codexHome = join(base, "codex");
const codexRoot = join(codexHome, "sessions");
const archivedDir = join(codexHome, "archived_sessions");
mkdirSync(project, { recursive: true });
mkdirSync(codexRoot, { recursive: true });
mkdirSync(archivedDir, { recursive: true });

const archivedA = join(archivedDir, "a.jsonl");
writeFileSync(archivedA, "{}\n");

const first = getCodexArchiveInfo(codexRoot, { gitRoot: project });
assert.equal(first.cacheStatus, "miss");
assert.equal(first.archivedPaths.has(archivedA.replaceAll("\\", "/")), true);
assert.equal(first.archivedPaths.size, 1);

const cachePath = join(project, ARCHIVE_CACHE_FILE);
const cache = JSON.parse(readFileSync(cachePath, "utf8"));
assert.deepEqual(cache.archivedPaths, [archivedA.replaceAll("\\", "/")]);

const second = getCodexArchiveInfo(codexRoot, { gitRoot: project });
assert.equal(second.cacheStatus, "hit");
assert.equal(second.archivedPaths.size, 1);

const archivedB = join(archivedDir, "b.jsonl");
writeFileSync(archivedB, "{}\n");
const third = getCodexArchiveInfo(codexRoot, { gitRoot: project });
assert.equal(third.cacheStatus, "miss");
assert.equal(third.archivedPaths.has(archivedB.replaceAll("\\", "/")), true);
assert.equal(third.archivedPaths.size, 2);

console.log("archive cache test passed");
