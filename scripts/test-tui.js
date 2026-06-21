import assert from "node:assert/strict";
import {
  filterTuiChoices,
  formatTuiCommand,
  getTuiCategories,
  getTuiChoices,
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

// --- home menu (English) ---------------------------------------------------
const homeMenu = renderTuiMenu(config);
assert.match(homeMenu, /Agent Sync Kit - Project/);
assert.match(homeMenu, /Agent Sync Kit/);
assert.match(homeMenu, /Choose a workspace, press Enter to open\./);
assert.match(homeMenu, /\[1\] Remote Sync/);
assert.match(homeMenu, /\[2\] Local Transfer/);
assert.match(homeMenu, /\[3\] Doctor/);
assert.match(homeMenu, /Enter open/);

// --- remote workspace (English) -------------------------------------------
const remoteMenu = renderTuiMenu(config, { categoryId: "remote" });
assert.match(remoteMenu, /REMOTE SYNC/);
assert.match(remoteMenu, /\[PUSH\]/);
assert.match(remoteMenu, /Push sessions/);
assert.match(remoteMenu, /Pull sessions/);
assert.match(remoteMenu, /Restore by index/);
assert.match(remoteMenu, /Log latest sessions/);
assert.match(remoteMenu, /Init sidecar store/);
assert.match(remoteMenu, /Install pre-push hook/);
assert.match(remoteMenu, /git agent-sync push/);
assert.match(remoteMenu, /git agent-sync restore --index <restore-index>/);
assert.match(remoteMenu, /git agent-sync init --remote <remote-url>/);

// --- local workspace (English) --------------------------------------------
const localMenu = renderTuiMenu(config, { categoryId: "local" });
assert.match(localMenu, /LOCAL/);
assert.match(localMenu, /Clone Codex to current provider/);
assert.match(localMenu, /Register local clones/);
assert.match(localMenu, /Watch provider changes/);
assert.match(localMenu, /Migrate bundle to Claude JSONL/);
assert.match(localMenu, /Migrate bundle to Codex JSONL/);
assert.match(localMenu, /git agent-sync clone-local/);
assert.match(localMenu, /git agent-sync watch-local/);
assert.match(localMenu, /git agent-sync tool export --to claude --mode readable --session <bundle-id>/);

// --- doctor workspace (English) -------------------------------------------
const doctorMenu = renderTuiMenu(config, { categoryId: "doctor" });
assert.match(doctorMenu, /DOCTOR/);
assert.match(doctorMenu, /Run doctor/);
assert.match(doctorMenu, /Show session status/);
assert.match(doctorMenu, /git agent-sync doctor/);
assert.match(doctorMenu, /git agent-sync status/);

// --- home menu (Chinese) ---------------------------------------------------
const cnHomeMenu = renderTuiMenu(config, { cn: true });
assert.match(cnHomeMenu, /Agent Sync 中文工具箱 - Project/);
assert.match(cnHomeMenu, /选择一个工作区/);
assert.match(cnHomeMenu, /\[1\] 远程同步/);
assert.match(cnHomeMenu, /\[2\] 本地迁移/);
assert.match(cnHomeMenu, /\[3\] 诊断/);

const cnRemoteMenu = renderTuiMenu(config, { cn: true, categoryId: "remote" });
assert.match(cnRemoteMenu, /推送会话/);
assert.match(cnRemoteMenu, /按编号恢复/);
assert.match(cnRemoteMenu, /初始化 sidecar 仓库/);

const cnLocalMenu = renderTuiMenu(config, { cn: true, categoryId: "local" });
assert.match(cnLocalMenu, /克隆 Codex 到当前 provider/);
assert.match(cnLocalMenu, /迁移为 Claude JSONL/);

// --- data accessors --------------------------------------------------------
assert.equal(getTuiCategories().find((category) => category.id === "remote").key, "1");
assert.equal(getTuiCategories().find((category) => category.id === "local").key, "2");
assert.equal(getTuiCategories().find((category) => category.id === "doctor").key, "3");
assert.equal(getTuiCategories({ cn: true }).find((category) => category.id === "doctor").title, "诊断");

assert.equal(getTuiChoices().some((choice) => choice.key === "p" && choice.category === "remote"), true);
assert.equal(getTuiChoices().some((choice) => choice.key === "w" && choice.category === "local" && choice.handoff), true);
assert.equal(getTuiChoices().some((choice) => choice.key === "d" && choice.category === "doctor"), true);
assert.equal(getTuiChoices({ cn: true }).some((choice) => choice.key === "p" && choice.label.includes("推送")), true);
assert.equal(getTuiChoices().some((choice) => choice.key === "r" && Boolean(choice.prompt)), true);
assert.equal(getTuiChoices().some((choice) => choice.key === "i" && Boolean(choice.prompt) && choice.promptSuffix === "--remote"), true);

// --- resolveTuiCategory ----------------------------------------------------
assert.equal(resolveTuiCategory("1").id, "remote");
assert.equal(resolveTuiCategory("2").id, "local");
assert.equal(resolveTuiCategory("3").id, "doctor");
assert.equal(resolveTuiCategory("remote").id, "remote");
assert.equal(resolveTuiCategory("doctor", { cn: true }).id, "doctor");

// --- resolveTuiChoice + args ----------------------------------------------
assert.deepEqual(resolveTuiChoice("p").args, ["push"]);
assert.deepEqual(resolveTuiChoice("l").args, ["pull"]);
assert.deepEqual(resolveTuiChoice("r").args, ["restore", "--index"]);
assert.deepEqual(resolveTuiChoice("g").args, ["log", "--latest", "--oneline", "-20"]);
assert.deepEqual(resolveTuiChoice("i").args, ["init"]);
assert.deepEqual(resolveTuiChoice("k").args, ["install-hooks"]);
assert.deepEqual(resolveTuiChoice("c").args, ["clone-local"]);
assert.deepEqual(resolveTuiChoice("e").args, ["register-local"]);
assert.deepEqual(resolveTuiChoice("w").args, ["watch-local"]);
assert.deepEqual(resolveTuiChoice("w").handoff, true);
assert.deepEqual(resolveTuiChoice("a").args, ["tool", "export", "--to", "claude", "--mode", "readable", "--session"]);
assert.deepEqual(resolveTuiChoice("o").args, ["tool", "export", "--to", "codex", "--mode", "readable", "--session"]);
assert.deepEqual(resolveTuiChoice("d").args, ["doctor"]);
assert.deepEqual(resolveTuiChoice("s").args, ["status"]);

assert.equal(resolveTuiChoice("p").confirm.includes("Push"), true);
assert.equal(resolveTuiChoice("p", "", { cn: true }).confirm.includes("推送"), true);
assert.equal(resolveTuiChoice("k").confirm.includes("hook"), true);
assert.equal(resolveTuiChoice("r").confirm.includes("Restore"), true);
assert.equal(resolveTuiChoice("r").browser, "restore");
assert.equal(resolveTuiChoice("g").browser, "log");
assert.equal(resolveTuiChoice("i").prompt.label, "Remote URL");
assert.equal(resolveTuiChoice("missing"), null);

// --- formatTuiCommand ------------------------------------------------------
assert.equal(formatTuiCommand(resolveTuiChoice("p")), "git agent-sync push");
assert.equal(formatTuiCommand(resolveTuiChoice("l")), "git agent-sync pull");
assert.equal(formatTuiCommand(resolveTuiChoice("r")), "git agent-sync restore --index <restore-index>");
assert.equal(formatTuiCommand(resolveTuiChoice("r", "", { cn: true })), "git agent-sync restore --index <restore-index>");
assert.equal(formatTuiCommand(resolveTuiChoice("g")), "git agent-sync log --latest --oneline -20");
assert.equal(formatTuiCommand(resolveTuiChoice("i")), "git agent-sync init --remote <remote-url>");
assert.equal(formatTuiCommand(resolveTuiChoice("k")), "git agent-sync install-hooks");
assert.equal(formatTuiCommand(resolveTuiChoice("c")), "git agent-sync clone-local");
assert.equal(formatTuiCommand(resolveTuiChoice("a")), "git agent-sync tool export --to claude --mode readable --session <bundle-id>");
assert.equal(formatTuiCommand(resolveTuiChoice("d")), "git agent-sync doctor");

// --- filterTuiChoices ------------------------------------------------------
assert.equal(filterTuiChoices(getTuiChoices(), "push").some((choice) => choice.key === "p"), true);
assert.equal(filterTuiChoices(getTuiChoices(), "claude").some((choice) => choice.key === "a"), true);
assert.equal(filterTuiChoices(getTuiChoices({ cn: true }), "推送").some((choice) => choice.key === "p"), true);
assert.equal(filterTuiChoices(getTuiChoices(), "doctor").some((choice) => choice.key === "d"), true);

// --- runTui prompt flow (scripted io + runner) -----------------------------
// log and restore now open a browser: they first fetch the session list via
// `log --latest --oneline -40` (printed in full, untruncated), then restore
// asks for the number and runs `restore --index <n>`.
const commands = [];
const answers = [
  // remote workspace
  "1",
  "p", "y", "",          // push (confirm) + enter
  "g", "",               // log: list printed + enter
  "r", "3", "y", "",     // restore: list printed, pick index 3, confirm, enter
  "i", "", "",           // init with empty optional remote + enter
  "home",
  // local workspace
  "2",
  "c", "",               // clone-local + enter
  "home",
  // doctor workspace
  "3",
  "d", "",               // doctor + enter
  "q"                    // quit
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
    return { status: 0, stdout: args[0] === "log" ? "1  sample session  feat: demo" : "" };
  }
});

assert.deepEqual(commands, [
  { args: ["push"], cwd: "/tmp/project" },
  { args: ["log", "--latest", "--oneline", "-40"], cwd: "/tmp/project" },
  { args: ["log", "--latest", "--oneline", "-40"], cwd: "/tmp/project" },
  { args: ["restore", "--index", "3"], cwd: "/tmp/project" },
  { args: ["init"], cwd: "/tmp/project" },
  { args: ["clone-local"], cwd: "/tmp/project" },
  { args: ["doctor"], cwd: "/tmp/project" }
]);

console.log("agent-sync tui test passed");
