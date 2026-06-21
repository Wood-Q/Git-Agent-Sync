import assert from "node:assert/strict";
import { parseRestoreIndex, selectRestoreMatches } from "../dist/restore.js";

// --- parseRestoreIndex ---------------------------------------------------
// No index anywhere → null.
assert.equal(parseRestoreIndex([], {}, false), null);
assert.equal(parseRestoreIndex([], {}, true), null);

// --index / --i option wins.
assert.equal(parseRestoreIndex([], { index: "3" }, false), 3);
assert.equal(parseRestoreIndex([], { index: "1" }, true), 1);

// Positional arg only counts when a selector is present.
assert.equal(parseRestoreIndex(["2"], {}, true), 2);
// Without a selector, a bare positional is ignored (not treated as index).
assert.equal(parseRestoreIndex(["2"], {}, false), null);

// Non-numeric or zero/negative rejected.
assert.throws(() => parseRestoreIndex([], { index: "abc" }, false), /positive number/);
assert.throws(() => parseRestoreIndex([], { index: "0" }, false), /positive number/);
assert.throws(() => parseRestoreIndex(["-1"], {}, true), /positive number/);

// --- selectRestoreMatches ------------------------------------------------
const matches = [{ bundleId: "a" }, { bundleId: "b" }, { bundleId: "c" }];

// No index → all matches returned (e.g. --all or restore whole selector).
assert.deepEqual(selectRestoreMatches(matches, null, null), matches);
assert.deepEqual(selectRestoreMatches(matches, 0, null), matches);

// 1-based index picks the right single match.
assert.deepEqual(selectRestoreMatches(matches, 1, null), [{ bundleId: "a" }]);
assert.deepEqual(selectRestoreMatches(matches, 3, null), [{ bundleId: "c" }]);

// Out-of-range throws with a descriptive scope.
assert.throws(
  () => selectRestoreMatches(matches, 4, null),
  /out of range for log \(3 binding\(s\)\)/
);
assert.throws(
  () => selectRestoreMatches(matches, 5, { type: "latest" }),
  /out of range for latest \(3 binding\(s\)\)/
);

// Scope text includes active filters.
assert.throws(
  () => selectRestoreMatches(matches, 9, { type: "branch", value: "main" }, { agent: "codex" }),
  /out of range for branch main, agent codex/
);

console.log("restore index/selection test passed");
