import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const cli = join(repoRoot, "bin", "git-agent-sync.js");
const base = mkdtempSync(join(tmpdir(), "agent-sync-hooks-"));
const project = join(base, "project");
mkdirSync(project, { recursive: true });

run("git", ["init", "-b", "main"], project);
run("git", ["config", "user.name", "Agent Sync Test"], project);
run("git", ["config", "user.email", "test@example.invalid"], project);
writeFileSync(join(project, "README.md"), "# hooks\n");
run("git", ["add", "README.md"], project);
run("git", ["commit", "-m", "initial"], project);

run(process.execPath, [cli, "install-hooks"], project);
const hookPath = join(project, ".git", "hooks", "pre-push");
assert.equal(existsSync(hookPath), true);
assert.match(readFileSync(hookPath, "utf8"), /AGENT_SYNC_HOOK=pre-push/);
runHook(hookPath, project);

run(process.execPath, [cli, "uninstall-hooks"], project);
assert.equal(existsSync(hookPath), false);

// Pre-marker hook (commits before 5445bfa) must still be removable.
const legacyHook = "#!/bin/sh\n# Installed by git-agent-sync.\nexit 0\n";
writeFileSync(hookPath, legacyHook, { mode: 0o755 });
run(process.execPath, [cli, "uninstall-hooks"], project);
assert.equal(existsSync(hookPath), false);

// core.hooksPath must be honored on install and uninstall.
const customHooks = join(project, ".custom-hooks");
mkdirSync(customHooks, { recursive: true });
run("git", ["config", "core.hooksPath", customHooks], project);
run(process.execPath, [cli, "install-hooks"], project);
const customHook = join(customHooks, "pre-push");
assert.equal(existsSync(customHook), true, "install must write to core.hooksPath");
assert.equal(existsSync(hookPath), false, "install must not write to .git/hooks when core.hooksPath is set");
assert.match(readFileSync(customHook, "utf8"), /AGENT_SYNC_HOOK=pre-push/);
run(process.execPath, [cli, "uninstall-hooks"], project);
assert.equal(existsSync(customHook), false, "uninstall must remove the hook at core.hooksPath");
run("git", ["config", "--unset", "core.hooksPath"], project);

writeFileSync(hookPath, "#!/bin/sh\necho custom\n");
assert.throws(() => run(process.execPath, [cli, "install-hooks"], project), /pre-push hook already exists/);
assert.throws(() => run(process.execPath, [cli, "uninstall-hooks"], project), /was not installed by agent-sync/);
unlinkSync(hookPath);

console.log("hook install/uninstall test passed");

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

// Windows can't spawn a shell script directly; route through `sh` so the smoke
// check exercises the hook body on every platform.
function runHook(hookPath, cwd) {
  const result = spawnSync("sh", [hookPath], { cwd, env: process.env, encoding: "utf8" });
  if (result.error?.code === "ENOENT") {
    return;
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `hook failed: ${hookPath}`).trim());
  }
}
