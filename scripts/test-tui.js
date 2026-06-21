import assert from "node:assert/strict";
import { getTuiChoices, renderTuiMenu, resolveTuiChoice, runTui } from "../dist/tui.js";

const config = {
  projectName: "Project",
  projectRoot: "/tmp/project",
  storePath: "/tmp/project/.agent-sync-store"
};

const menu = renderTuiMenu(config);
assert.match(menu, /Agent Sync TUI - Project/);
assert.match(menu, /Clone Codex sessions to current provider/);
assert.match(menu, /Watch Codex provider changes/);

assert.equal(getTuiChoices().some((choice) => choice.key === "5" && choice.prompt), true);
assert.deepEqual(resolveTuiChoice("6").args, ["clone-local"]);
assert.deepEqual(resolveTuiChoice("w").args, ["watch-local"]);
assert.equal(resolveTuiChoice("q").exits, true);
assert.equal(resolveTuiChoice("missing"), null);

const commands = [];
const answers = ["1", "", "5", "3", "", "q"];
const io = {
  async question() {
    return answers.shift() || "";
  },
  close() {}
};

await runTui("/tmp/project", config, {
  io,
  runner(args, cwd) {
    commands.push({ args, cwd });
    return 0;
  }
});

assert.deepEqual(commands, [
  { args: ["status"], cwd: "/tmp/project" },
  { args: ["restore", "--index", "3"], cwd: "/tmp/project" }
]);

console.log("agent-sync tui test passed");
