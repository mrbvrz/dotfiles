// Hunk stage / unstage / discard through executeAction against real repos.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeAction } from "../execute.js";
import { dialogFor } from "../git.js";
import { parseHunks, patchFor, HUNK_DIFF } from "../hunks.js";

const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" };
const base = mkdtempSync(join(tmpdir(), "hunks-"));
const git = (d, ...a) => execFileSync("git", a, { cwd: d, env, encoding: "utf8" });
// Same spawn for git and sh: argv array, no shell.
const exec = (d) => async (p, args) => { const r = spawnSync(p, args, { cwd: d, env, encoding: "utf8" }); return { code: r.status, stdout: r.stdout, stderr: r.stderr }; };
const ctxOf = (d) => ({ root: d, on: "t", head: git(d, "rev-parse", "HEAD").trim(), current: "main", remotes: [] });
const run = (d, a) => executeAction(a, {}, ctxOf(d), exec(d));
const lines = (n) => Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).map((l, i) => n[i + 1] ?? l);
const text = (n) => lines(n).join("\n") + "\n";
const diff = (d, staged, name) => git(d, ...HUNK_DIFF[staged ? "staged" : "unstaged"], name);
try {
  for (const name of ["f.txt", "my file -x.txt"]) {
    const r = join(base, name.replace(/\W/g, "_")); execFileSync("git", ["init", "-q", "-b", "main", r], { env });
    writeFileSync(join(r, name), text({})); git(r, "add", "."); git(r, "commit", "-qm", "i");
    writeFileSync(join(r, name), text({ 2: "EDIT2", 38: "EDIT38" }));
    const d = diff(r, false, name);
    const parsed = parseHunks(d);
    assert.equal(parsed.hunks.length, 2);
    assert.match(parsed.head, /^diff --git /);
    assert.equal(parsed.head.includes("@@"), false);
    // stage hunk 0
    assert.deepEqual(await run(r, { type: "stageHunk", path: name, patch: patchFor(d, 0) }), { ok: true });
    const cached = git(r, "diff", "--cached", "--", name);
    assert.match(cached, /\+EDIT2/); assert.doesNotMatch(cached, /EDIT38/);
    // unstage it from the --cached diff
    assert.equal((await run(r, { type: "unstageHunk", path: name, patch: patchFor(diff(r, true, name), 0) })).ok, true);
    assert.equal(git(r, "diff", "--cached"), "");
    // stage hunk 0, then further edits: staging the remaining worktree hunk keeps the earlier one
    await run(r, { type: "stageHunk", path: name, patch: patchFor(d, 0) });
    const d2 = diff(r, false, name);
    assert.equal(parseHunks(d2).hunks.length, 1);
    assert.equal((await run(r, { type: "stageHunk", path: name, patch: patchFor(d2, 0) })).ok, true);
    const both = git(r, "diff", "--cached", "--", name);
    assert.match(both, /\+EDIT2/); assert.match(both, /\+EDIT38/);
    git(r, "reset", "-q", "--hard");
    // discard hunk 1 of the worktree
    writeFileSync(join(r, name), text({ 2: "EDIT2", 38: "EDIT38" }));
    assert.equal((await run(r, { type: "discardHunk", path: name, patch: patchFor(diff(r, false, name), 1) })).ok, true);
    const wt = readFileSync(join(r, name), "utf8");
    assert.match(wt, /EDIT2/); assert.doesNotMatch(wt, /EDIT38/);
  }
  // glob-like name beside a plain one: literal pathspecs, first file only
  {
    const r = join(base, "glob"); execFileSync("git", ["init", "-q", "-b", "main", r], { env });
    writeFileSync(join(r, "[x].txt"), text({})); writeFileSync(join(r, "x.txt"), text({}));
    git(r, "add", "."); git(r, "commit", "-qm", "i");
    writeFileSync(join(r, "[x].txt"), text({ 2: "BRACKET" })); writeFileSync(join(r, "x.txt"), text({ 2: "PLAIN" }));
    const d = diff(r, false, "[x].txt");
    assert.equal((d.match(/^diff --git /gm) || []).length, 1);
    assert.match(d, /BRACKET/); assert.doesNotMatch(d, /PLAIN/);
    assert.equal((await run(r, { type: "stageHunk", path: "[x].txt", patch: patchFor(d, 0) })).ok, true);
    assert.equal(git(r, "diff", "--cached", "--name-only").trim(), "[x].txt");
    assert.match(git(r, "diff", "--name-only"), /^x\.txt$/m);
    const two = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-1\n+2\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -1 +1 @@\n-3\n+4\n";
    const pp = parseHunks(two);
    assert.equal(pp.hunks.length, 1); assert.doesNotMatch(patchFor(two, 0), /a\/b/);
    assert.throws(() => patchFor(two, 1));
  }
  // failure surfaces as a message; stale HEAD refused
  const r = join(base, "f_txt");
  const bad = "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,1 +1,1 @@\n-nope\n+x\n";
  const res = await run(r, { type: "stageHunk", path: "f.txt", patch: bad });
  assert.equal(res.ok, false); assert.ok(res.message);
  const stale = await executeAction({ type: "stageHunk", path: "f.txt", patch: bad }, {}, { ...ctxOf(r), head: "0".repeat(40) }, exec(r));
  assert.equal(stale.stale, true);
  // injection: payload only as $1, never interpreted
  writeFileSync(join(base, "pwn"), "");
  const evil = "diff --git a/x b/x\n@@ -1 +1 @@\n$(touch " + join(base, "pwned") + ")'; touch " + join(base, "pwned") + "; '\n";
  await run(r, { type: "stageHunk", path: "x", patch: evil });
  assert.equal(spawnSync("test", ["-e", join(base, "pwned")]).status, 1);
  // validation
  for (const patch of ["nope\n@@ -1 +1 @@\n", "diff --git a b\n", "diff --git a b\n@@ -1 +1 @@\n@@ -2 +2 @@\n", "diff --git a b\n@@ -1 +1 @@\n\0", undefined]) {
    await assert.rejects(run(r, { type: "stageHunk", path: "f.txt", patch }), /Invalid patch/);
  }
  assert.equal(dialogFor({ type: "discardHunk", path: "f.txt" }, {}).title, "Discard this change?");
  // the confirm names the hunk: its @@ header and its first changed line
  const dh = dialogFor({ type: "discardHunk", path: "f.txt", patch: "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@ fn main\n ctx\n-old line\n+new line\n" }, {});
  assert.equal(dh.danger, true);
  assert.match(dh.detail, /@@ -1,3 \+1,3 @@ fn main/); assert.match(dh.detail, /-old line/); assert.doesNotMatch(dh.detail, /\+new line/);
  assert.match(dh.detail, /f\.txt/);
  // diff.noprefix=true in the repo's config: the hunk diff still has a/ b/ prefixes git apply strips
  {
    const r = join(base, "noprefix"); execFileSync("git", ["init", "-q", "-b", "main", r], { env });
    git(r, "config", "diff.noprefix", "true");
    writeFileSync(join(r, "f.txt"), text({})); git(r, "add", "."); git(r, "commit", "-qm", "i");
    writeFileSync(join(r, "f.txt"), text({ 2: "EDIT2", 38: "EDIT38 " }));
    const d = diff(r, false, "f.txt");
    assert.match(d, /^diff --git a\/f\.txt b\/f\.txt$/m);
    assert.deepEqual(await run(r, { type: "stageHunk", path: "f.txt", patch: patchFor(d, 1) }), { ok: true }); // trailing space: no warning failure
    assert.match(git(r, "diff", "--cached"), /EDIT38/);
    assert.equal((await run(r, { type: "unstageHunk", path: "f.txt", patch: patchFor(diff(r, true, "f.txt"), 0) })).ok, true);
    assert.equal((await run(r, { type: "discardHunk", path: "f.txt", patch: patchFor(diff(r, false, "f.txt"), 0) })).ok, true);
    assert.doesNotMatch(readFileSync(join(r, "f.txt"), "utf8"), /EDIT2\n/);
  }
  console.log("hunks tests passed");
} finally { rmSync(base, { recursive: true, force: true }); }
