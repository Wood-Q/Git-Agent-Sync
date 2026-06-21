import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  expandHome,
  normalizePath,
  readJson,
  safeRead,
  sha256,
  shrinkHome,
  toSlash,
  unique,
  walk,
  writeFileAtomic,
  writeJson
} from "../dist/utils.js";

const base = mkdtempSync(join(tmpdir(), "agent-sync-utils-"));

// --- sha256 --------------------------------------------------------------
assert.equal(sha256(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
assert.equal(sha256("agent-sync"), sha256("agent-sync"));
assert.notEqual(sha256("a"), sha256("b"));
assert.equal(sha256(Buffer.from("agent-sync")), sha256("agent-sync"));

// --- unique --------------------------------------------------------------
assert.deepEqual(unique([1, 1, 2, 3, 2]), [1, 2, 3]);
assert.deepEqual(unique([]), []);
assert.deepEqual(unique(["a", "a", "b"]), ["a", "b"]);

// --- normalizePath / toSlash ---------------------------------------------
assert.equal(normalizePath("/tmp/x"), process.platform === "win32" ? "C:/tmp/x" : "/tmp/x");
assert.equal(toSlash("a\\b\\c"), "a/b/c");
assert.equal(toSlash("a/b/c"), "a/b/c");

// --- expandHome / shrinkHome round-trip ----------------------------------
{
  const home = process.env.HOME || process.env.USERPROFILE;
  assert.equal(expandHome("~"), home);
  assert.equal(expandHome("~/projects/x"), join(home, "projects/x"));
  assert.equal(expandHome("/abs/path"), "/abs/path");
}

// shrinkHome collapses a home-relative path to ~/...
{
  const home = process.env.HOME || process.env.USERPROFILE;
  const shrunk = shrinkHome(join(home, "projects", "demo"));
  assert.ok(shrunk.startsWith("~/"), `${shrunk} should start with ~/`);
  // Absolute non-home paths are normalized but not collapsed.
  const abs = shrinkHome("/opt/other");
  assert.ok(!abs.startsWith("~/"));
}

// --- walk ----------------------------------------------------------------
{
  mkdirSync(join(base, "a", "b"), { recursive: true });
  writeFileSync(join(base, "root.txt"), "r");
  writeFileSync(join(base, "a", "mid.txt"), "m");
  writeFileSync(join(base, "a", "b", "leaf.txt"), "l");
  const files = walk(base).map((f) => f.replaceAll("\\", "/")).sort();
  assert.equal(files.length, 3);
  assert.ok(files.some((f) => f.endsWith("root.txt")));
  assert.ok(files.some((f) => f.endsWith("a/mid.txt")));
  assert.ok(files.some((f) => f.endsWith("a/b/leaf.txt")));
}

// walk on a missing dir returns [].
assert.deepEqual(walk(join(base, "does-not-exist")), []);

// --- safeRead ------------------------------------------------------------
assert.equal(safeRead(join(base, "missing.txt")), "");
writeFileSync(join(base, "present.txt"), "hello");
assert.equal(safeRead(join(base, "present.txt")), "hello");

// --- writeJson / readJson ------------------------------------------------
{
  const target = join(base, "nested", "deep", "config.json");
  writeJson(target, { name: "agent-sync", count: 3 });
  assert.equal(existsSync(target), true);
  assert.deepEqual(readJson(target), { name: "agent-sync", count: 3 });
  // writeJson appends a trailing newline.
  assert.equal(readFileSync(target, "utf8").endsWith("\n"), true);
}

// --- writeFileAtomic: overwrites existing file atomically ----------------
{
  const target = join(base, "atomic.txt");
  writeFileSync(target, "old");
  writeFileAtomic(target, "new");
  assert.equal(readFileSync(target, "utf8"), "new");
}

// writeFileAtomic creates parent dirs.
{
  const target = join(base, "brand-new-dir", "file.txt");
  writeFileAtomic(target, "x");
  assert.equal(readFileSync(target, "utf8"), "x");
}

// readJson throws on bad JSON.
assert.throws(() => readJson(join(base, "present.txt")), SyntaxError);

rmSync(base, { recursive: true, force: true });
console.log("utils test passed");
