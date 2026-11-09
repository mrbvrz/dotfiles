import assert from "node:assert/strict";
import { parseBranches } from "../git.js";

const text = ["refs/heads/main", "refs/heads/feat/x", "refs/remotes/origin/HEAD", "refs/remotes/origin/main", "refs/remotes/origin/dev", "refs/remotes/up/stream/topic"].join("\n");
assert.deepEqual(parseBranches(text, ["origin", "up/stream"]), [
  { name: "main" }, { name: "feat/x" },
  { name: "origin/dev", remote: "origin", branch: "dev" },
  { name: "up/stream/topic", remote: "up/stream", branch: "topic" },
]);
assert.deepEqual(parseBranches("", ["origin"]), []);
console.log("branches tests passed");

import { pickerStart } from "../git.js";
assert.equal(pickerStart(3, "", true), 0);
assert.equal(pickerStart(3, "ma", true), 1);
assert.equal(pickerStart(0, "zz", true), 0);
assert.equal(pickerStart(3, "ma", false), 0);
console.log("picker start passed");

// "Create branch…" from the picker checks the new branch out by default; from a commit's menu it doesn't.
import { dialogFor, initialValues } from "../git.js";
const h = "c".repeat(40);
assert.equal(dialogFor({ type: "createBranch", hash: h, short: "cccccccc", checkout: true }, {}).checks[0].value, true);
assert.equal(initialValues({ type: "createBranch", hash: h, short: "cccccccc", checkout: true }, {}).checkout, true);
assert.equal(dialogFor({ type: "createBranch", hash: h, short: "cccccccc" }, {}).checks[0].value, false);
console.log("create branch default passed");
