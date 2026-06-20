import assert from "node:assert/strict";
import { getTuiChoices, getTuiViews, renderTuiMenu, resolveTuiChoice, runTui } from "../dist/tui.js";

const config = {
  projectName: "Project",
  projectRoot: "/tmp/project",
  storePath: "/tmp/project/.agent-sync-store"
};

const menu = renderTuiMenu(config);
assert.match(menu, /Agent Sync TUI - Project/);
assert.match(menu, /Sync Queue/);
assert.match(menu, /Clone Codex sessions to current provider/);
assert.match(menu, /Watch Codex provider changes/);
assert.match(menu, /Tool Convert/);
assert.match(menu, /Privacy Review/);
assert.match(menu, /Conflicts/);

assert.equal(getTuiViews().some((view) => view.id === "tool" && view.title === "Tool Convert"), true);
assert.equal(getTuiViews().some((view) => view.id === "conflicts" && view.title === "Conflicts"), true);
assert.equal(getTuiChoices().some((choice) => choice.key === "i" && choice.prompt), true);
assert.equal(getTuiChoices().some((choice) => choice.key === "5" && choice.prompt), true);
assert.deepEqual(resolveTuiChoice("6").args, ["clone-local"]);
assert.deepEqual(resolveTuiChoice("w").args, ["watch-local"]);
assert.deepEqual(resolveTuiChoice("i").args, ["tool", "inspect", "--session"]);
assert.equal(resolveTuiChoice("q").exits, true);
assert.equal(resolveTuiChoice("missing"), null);

const commands = [];
const answers = ["1", "", "5", "3", "", "i", "bundle-1", "", "q"];
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
  { args: ["restore", "--index", "3"], cwd: "/tmp/project" },
  { args: ["tool", "inspect", "--session", "bundle-1"], cwd: "/tmp/project" }
]);

console.log("agent-sync tui test passed");
