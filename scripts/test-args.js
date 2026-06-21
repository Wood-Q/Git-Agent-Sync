import assert from "node:assert/strict";
import {
  formatBindingFiltersForCommand,
  formatSelector,
  hasActiveBindingFilters,
  hasBindingFilters,
  parseArgs,
  parseBindingFilters,
  parseSelector
} from "../dist/args.js";

// --- parseArgs: command + positional args -------------------------------
{
  const parsed = parseArgs(["log", "abc", "def"]);
  assert.equal(parsed.command, "log");
  assert.deepEqual(parsed.args, ["abc", "def"]);
  assert.deepEqual(parsed.options, {});
}

// Leading flag means no command is recognised.
{
  const parsed = parseArgs(["--json", "log"]);
  assert.equal(parsed.command, undefined);
  assert.deepEqual(parsed.args, ["log"]);
  assert.equal(parsed.options.json, true);
}

// Boolean flags.
{
  const { options } = parseArgs(["push", "--json", "--oneline", "--all", "--background", "--flush", "--latest", "--current", "--cn", "--no-adapt", "--no-register", "--no-initial-sync", "--dry-run", "--force", "--once"]);
  assert.equal(options.json, true);
  assert.equal(options.oneline, true);
  assert.equal(options.all, true);
  assert.equal(options.background, true);
  assert.equal(options.flush, true);
  assert.equal(options.latest, true);
  assert.equal(options.current, true);
  assert.equal(options.cn, true);
  assert.equal(options.noAdapt, true);
  assert.equal(options.noRegister, true);
  assert.equal(options.noInitialSync, true);
  assert.equal(options.dryRun, true);
  assert.equal(options.force, true);
  assert.equal(options.once, true);
}

// -n / --max-count / --max-count= / -<number> all set maxCount.
assert.equal(parseArgs(["log", "-n", "5"]).options.maxCount, "5");
assert.equal(parseArgs(["log", "--max-count", "5"]).options.maxCount, "5");
assert.equal(parseArgs(["log", "--max-count=5"]).options.maxCount, "5");
assert.equal(parseArgs(["log", "-5"]).options.maxCount, "5");
assert.equal(parseArgs(["log", "-20"]).options.maxCount, "20");

// --flag=value and --flag value and short forms are equivalent.
assert.equal(parseArgs(["x", "--agent", "codex"]).options.agent, "codex");
assert.equal(parseArgs(["x", "--agent=codex"]).options.agent, "codex");
assert.equal(parseArgs(["x", "--to", "ir"]).options.to, "ir");
assert.equal(parseArgs(["x", "--to=ir"]).options.to, "ir");
assert.equal(parseArgs(["x", "--privacy", "redact"]).options.privacy, "redact");
assert.equal(parseArgs(["x", "--privacy=redact"]).options.privacy, "redact");
assert.equal(parseArgs(["x", "--session", "b1"]).options.session, "b1");
assert.equal(parseArgs(["x", "--session=b1"]).options.session, "b1");
assert.equal(parseArgs(["x", "--strategy", "keep-all"]).options.strategy, "keep-all");
assert.equal(parseArgs(["x", "--strategy=keep-all"]).options.strategy, "keep-all");
assert.equal(parseArgs(["x", "--interval", "2"]).options.interval, "2");
assert.equal(parseArgs(["x", "--interval=2"]).options.interval, "2");

// message aliases: --m=, --m, -m, --message, --message=
assert.equal(parseArgs(["x", "--m=hello"]).options.message, "hello");
assert.equal(parseArgs(["x", "--m", "hello"]).options.message, "hello");
assert.equal(parseArgs(["x", "-m", "hello"]).options.message, "hello");
assert.equal(parseArgs(["x", "--message", "hello"]).options.message, "hello");
assert.equal(parseArgs(["x", "--message=hello"]).options.message, "hello");

// index aliases: --index/--index=/--i/--i=/
assert.equal(parseArgs(["x", "--index", "3"]).options.index, "3");
assert.equal(parseArgs(["x", "--index=3"]).options.index, "3");
assert.equal(parseArgs(["x", "--i", "3"]).options.index, "3");
assert.equal(parseArgs(["x", "--i=3"]).options.index, "3");

// Unknown tokens become positional args.
{
  const { args, options } = parseArgs(["show", "bundle-1", "--weird-flag"]);
  assert.deepEqual(args, ["bundle-1", "--weird-flag"]);
  assert.deepEqual(options, {});
}

// --- parseSelector -------------------------------------------------------
assert.equal(parseSelector({ latest: true }, { requireSelector: false }).type, "latest");
assert.equal(parseSelector({ current: true }, { requireSelector: false }).type, "current");
assert.deepEqual(parseSelector({ branch: "main" }, { requireSelector: false }), { type: "branch", value: "main" });
assert.deepEqual(parseSelector({ commit: "abc123" }, { requireSelector: false }), { type: "commit", value: "abc123" });
assert.equal(parseSelector({}, { requireSelector: false }), null);

// requireSelector throws when none present.
assert.throws(() => parseSelector({}, { requireSelector: true }), /log requires one of/);

// Multiple primary selectors collide.
assert.throws(() => parseSelector({ latest: true, current: true }, { requireSelector: false }), /choose only one of/);

// branch/commit require a value.
assert.throws(() => parseSelector({ branch: "" }, { requireSelector: false }), /--branch requires a value/);

// --- filters -------------------------------------------------------------
assert.equal(hasBindingFilters({ agent: "codex" }), true);
assert.equal(hasBindingFilters({}), false);

{
  const filters = parseBindingFilters({ agent: "codex", title: "login" });
  assert.deepEqual(filters, { agent: "codex", title: "login" });
  assert.equal(hasActiveBindingFilters(filters), true);
}
assert.equal(hasActiveBindingFilters({}), false);
assert.equal(hasActiveBindingFilters(null), false);

// Invalid agent / date are rejected.
assert.throws(() => parseBindingFilters({ agent: "gemini" }), /--agent must be one of/);
assert.throws(() => parseBindingFilters({ date: "2026/06/21" }), /--date must use YYYY-MM-DD/);
assert.doesNotThrow(() => parseBindingFilters({ date: "2026-06-21" }));

// Empty filter value is rejected.
assert.throws(() => parseBindingFilters({ title: "" }), /--title requires a value/);

// branch/commit as filters are dropped when used as selector value.
{
  const filters = parseBindingFilters({ branch: "main" }, { type: "branch", value: "main" });
  assert.equal(filters.branch, undefined);
}
{
  const filters = parseBindingFilters({ commit: "abc" }, { type: "commit", value: "abc" });
  assert.equal(filters.commit, undefined);
}

// --- format helpers ------------------------------------------------------
assert.equal(formatSelector({ type: "latest" }), "latest");
assert.equal(formatSelector({ type: "current" }), "current");
assert.equal(formatSelector({ type: "branch", value: "main" }), "branch main");
assert.equal(formatSelector({ type: "commit", value: "abc" }), "commit abc");

assert.equal(formatBindingFiltersForCommand({ agent: "codex" }), "--agent codex");
assert.equal(formatBindingFiltersForCommand({ title: "login api" }), '--title "login api"');
assert.equal(formatBindingFiltersForCommand({}), "");
assert.equal(formatBindingFiltersForCommand(null), "");

console.log("args parser test passed");
