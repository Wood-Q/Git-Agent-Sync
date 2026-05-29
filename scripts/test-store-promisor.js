import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const cli = join(repoRoot, "bin", "git-agent-sync.js");
const base = realpathSync(mkdtempSync(join(tmpdir(), "agent-sync-store-promisor-")));
const project = join(base, "project");
const storeRemote = join(base, "store.git");

mkdirSync(project, { recursive: true });
run("git", ["init", "--bare", "-b", "main", storeRemote], base);
run("git", ["init", "-b", "main"], project);
run("git", ["config", "user.name", "Agent Sync Test"], project);
run("git", ["config", "user.email", "test@example.invalid"], project);
writeFileSync(join(project, "README.md"), "# store promisor\n");
run("git", ["add", "README.md"], project);
run("git", ["commit", "-m", "initial"], project);

run(process.execPath, [cli, "init", "--remote", storeRemote], project);
const storePath = join(project, ".agent-sync-store");
assert.equal(run("git", ["config", "--get", "remote.origin.promisor"], storePath), "true");
assert.equal(run("git", ["config", "--get", "remote.origin.partialclonefilter"], storePath), "blob:none");
assert.equal(run("git", ["config", "--get", "core.sparseCheckout"], storePath), "true");
assert.match(readFileSync(join(storePath, ".git", "info", "sparse-checkout"), "utf8"), /\/projects\/\*\/manifest\.json/);

run("git", ["config", "--unset", "remote.origin.promisor"], storePath);
run("git", ["config", "--unset", "remote.origin.partialclonefilter"], storePath);
run(process.execPath, [cli, "pull"], project);
assert.equal(run("git", ["config", "--get", "remote.origin.promisor"], storePath), "true");
assert.equal(run("git", ["config", "--get", "remote.origin.partialclonefilter"], storePath), "blob:none");

console.log("store promisor config test passed");

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `command failed: ${command} ${args.join(" ")}`).trim());
  }
  return result.stdout.trim();
}
