import assert from "node:assert/strict";
import {
  filterTuiChoices,
  formatTuiCommand,
  getTuiCategories,
  getTuiChoices,
  getTuiViews,
  renderTuiMenu,
  resolveTuiCategory,
  resolveTuiChoice,
  runTui
} from "../dist/tui.js";

const config = {
  projectName: "Project",
  projectRoot: "/tmp/project",
  storePath: "/tmp/project/.agent-sync-store"
};

const menu = renderTuiMenu(config);
assert.match(menu, /Agent Sync Kit - Project/);
assert.match(menu, /Agent Sync Kit v0\.1\.4/);
assert.match(menu, /Choose a toolkit/);
assert.match(menu, /› 1\.  Sidecar Sync Toolkit/);
assert.match(menu, /2\.  Codex Session Toolkit/);
assert.match(menu, /Enter \/ number opens/);

const remoteMenu = renderTuiMenu(config, { categoryId: "remote" });
assert.match(remoteMenu, /Remote conversation sync toolbox/);
assert.match(remoteMenu, /\[1\] Sync \/ Browse/);
assert.match(remoteMenu, /\[2\] Queue \/ Daemon/);
assert.match(remoteMenu, /\[3\] Privacy \/ Redact/);
assert.match(remoteMenu, /\[4\] Conflict \/ Resolve/);
assert.match(remoteMenu, /Function domain navigation/);
assert.match(remoteMenu, /Retry failed queue jobs/);
assert.match(remoteMenu, /Show conflict diff summary/);
assert.match(remoteMenu, /Push with explicit allow/);

const localMenu = renderTuiMenu(config, { categoryId: "local" });
assert.match(localMenu, /Local Codex session toolbox/);
assert.match(localMenu, /\[1\] Session \/ Browse/);
assert.match(localMenu, /\[2\] Provider \/ Clone/);
assert.match(localMenu, /\[3\] Bundle \/ Transfer/);
assert.match(localMenu, /\[4\] Repair \/ Maintenance/);
assert.match(localMenu, /Clone Codex sessions to current provider/);
assert.match(localMenu, /git agent-sync tool inspect --session <bundle-id>/);

const cnMenu = renderTuiMenu(config, { cn: true });
assert.match(cnMenu, /Agent Sync 中文工具箱 - Project/);
assert.match(cnMenu, /统一 Agent 对话同步工具箱/);
assert.match(cnMenu, /选择工具箱/);
assert.match(cnMenu, /› 1\.  Sidecar Sync Toolkit/);
assert.match(cnMenu, /2\.  Codex Session Toolkit/);

const cnRemoteMenu = renderTuiMenu(config, { cn: true, categoryId: "remote" });
assert.match(cnRemoteMenu, /远程对话同步工具箱/);
assert.match(cnRemoteMenu, /功能域导航/);
assert.match(cnRemoteMenu, /Queue \/ Daemon/);
assert.match(cnRemoteMenu, /重试失败队列任务/);
assert.match(cnRemoteMenu, /取消 pending 队列任务/);
assert.match(cnRemoteMenu, /添加隐私 allow pattern/);
assert.match(cnRemoteMenu, /查看冲突 diff 摘要/);

const cnLocalMenu = renderTuiMenu(config, { cn: true, categoryId: "local" });
assert.match(cnLocalMenu, /Codex 会话工具箱/);
assert.match(cnLocalMenu, /Session \/ Browse/);
assert.match(cnLocalMenu, /Repair \/ Maintenance/);
assert.match(cnLocalMenu, /克隆 Codex 会话到当前 provider/);
assert.match(cnLocalMenu, /git agent-sync tool inspect --session <bundle-id>/);

assert.equal(getTuiCategories().some((category) => category.id === "remote" && category.key === "A"), true);
assert.equal(getTuiCategories({ cn: true }).some((category) => category.id === "local" && category.toolkitTitle === "CODEX SESSION TOOLKIT"), true);
assert.equal(getTuiViews().some((view) => view.id === "tool" && view.title === "Bundle / Transfer"), true);
assert.equal(getTuiViews().some((view) => view.id === "conflicts" && view.title === "Conflict / Resolve"), true);
assert.equal(getTuiViews({ cn: true }).some((view) => view.id === "tool" && view.title === "Bundle / Transfer"), true);
assert.equal(getTuiViews().find((view) => view.id === "dashboard").category, "remote");
assert.equal(getTuiViews().find((view) => view.id === "local").category, "local");
assert.equal(getTuiChoices({ cn: true }).some((choice) => choice.key === "6" && choice.label.includes("克隆 Codex")), true);
assert.equal(getTuiChoices().some((choice) => choice.key === "i" && choice.prompt), true);
assert.equal(getTuiChoices().some((choice) => choice.key === "5" && choice.prompt), true);
assert.equal(resolveTuiCategory("1").id, "remote");
assert.equal(resolveTuiCategory("b").id, "local");
assert.equal(resolveTuiChoice("4").confirm.includes("Push"), true);
assert.equal(resolveTuiChoice("4", "", { cn: true }).confirm.includes("推送"), true);
assert.equal(resolveTuiChoice("R").confirm.includes("redacted"), true);
assert.deepEqual(resolveTuiChoice("u").args, ["sync", "retry"]);
assert.deepEqual(resolveTuiChoice("K").args, ["sync", "cancel"]);
assert.equal(resolveTuiChoice("K").confirm.includes("Cancel"), true);
assert.deepEqual(resolveTuiChoice("P", "privacy").args, ["privacy", "allow-pattern-local"]);
assert.equal(resolveTuiChoice("P", "privacy").confirm.includes("allow pattern"), true);
assert.deepEqual(resolveTuiChoice("6").args, ["clone-local"]);
assert.deepEqual(resolveTuiChoice("n").args, ["register-local"]);
assert.deepEqual(resolveTuiChoice("z").args, ["clean-local"]);
assert.deepEqual(resolveTuiChoice("w").args, ["watch-local"]);
assert.deepEqual(resolveTuiChoice("i").args, ["tool", "inspect", "--session"]);
assert.equal(formatTuiCommand(resolveTuiChoice("i")), "git agent-sync tool inspect --session <bundle-id>");
assert.equal(formatTuiCommand(resolveTuiChoice("i", "", { cn: true })), "git agent-sync tool inspect --session <bundle-id>");
assert.equal(filterTuiChoices(getTuiChoices(), "redaction").some((choice) => choice.key === "y"), true);
assert.equal(filterTuiChoices(getTuiChoices({ cn: true }), "脱敏").some((choice) => choice.key === "y"), true);
assert.deepEqual(resolveTuiChoice("g", "conflicts").args, ["conflicts", "list"]);
assert.deepEqual(resolveTuiChoice("D", "conflicts").args, ["conflicts", "diff"]);
assert.deepEqual(resolveTuiChoice("j", "conflicts").args, ["conflicts", "resolve", "--strategy", "keep-all"]);
assert.deepEqual(resolveTuiChoice("J", "conflicts").args, ["conflicts", "resolve", "--strategy", "keep-latest"]);
assert.deepEqual(resolveTuiChoice("O", "conflicts").args, ["conflicts", "resolve", "--strategy", "keep-local"]);
assert.deepEqual(resolveTuiChoice("E", "conflicts").args, ["conflicts", "resolve", "--strategy", "keep-remote"]);
assert.equal(resolveTuiChoice("q").exits, true);
assert.equal(resolveTuiChoice("missing"), null);

const commands = [];
const answers = [
  "1",
  "1", "",
  "u", "all", "",
  "K", "all", "y", "",
  "P", "example=sk-example-[a-z]+", "y", "",
  "D", "1", "",
  "J", "1", "y", "",
  "home",
  "2",
  "r", "3", "y", "",
  "i", "bundle-1", "",
  "q"
];
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
  { args: ["sync", "retry", "all"], cwd: "/tmp/project" },
  { args: ["sync", "cancel", "all"], cwd: "/tmp/project" },
  { args: ["privacy", "allow-pattern-local", "example=sk-example-[a-z]+"], cwd: "/tmp/project" },
  { args: ["conflicts", "diff", "1"], cwd: "/tmp/project" },
  { args: ["conflicts", "resolve", "--strategy", "keep-latest", "1"], cwd: "/tmp/project" },
  { args: ["restore", "--index", "3"], cwd: "/tmp/project" },
  { args: ["tool", "inspect", "--session", "bundle-1"], cwd: "/tmp/project" }
]);

console.log("agent-sync tui test passed");
