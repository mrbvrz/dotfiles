// Stage / unstage / discard through executeAction against real repos.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeAction } from "../execute.js";
import { dialogFor, dialogHeight, doneText, READ, commandsFor, hasConflictMarkers } from "../git.js";
import { STASH_LIST, parseStashes, parseGroups, commitValues } from "../scm.js";

const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" };
const base = mkdtempSync(join(tmpdir(), "actions-"));
const mk = (n) => { const d = join(base, n); execFileSync("git", ["init", "-q", "-b", "main", d], { env }); return d; };
const git = (d, ...a) => execFileSync("git", a, { cwd: d, env, encoding: "utf8" }).trim();
const exec = (d) => async (p, args) => { const r = spawnSync(p, args, { cwd: d, env, encoding: "utf8" }); return { code: r.status, stdout: r.stdout, stderr: r.stderr }; };
const ctxOf = (d) => ({ root: d, on: "t", head: spawnSync("git", ["rev-parse", "--verify", "-q", "HEAD"], { cwd: d, encoding: "utf8" }).stdout.trim() || null, current: "main", remotes: [] });
const run = (d, a) => executeAction(a, {}, ctxOf(d), exec(d));
try {
  const r = mk("r");
  writeFileSync(join(r, "t.txt"), "orig\n"); git(r, "add", "."); git(r, "commit", "-qm", "i");
  for (const name of ["a b.txt", "-dash.txt", "é.txt"]) {
    writeFileSync(join(r, name), "x");
    assert.equal((await run(r, { type: "stage", paths: [name] })).ok, true);
    assert.equal(git(r, "-c", "core.quotePath=false", "diff", "--cached", "--name-only"), name);
    assert.equal((await run(r, { type: "unstage", paths: [name] })).ok, true);
    assert.equal(git(r, "diff", "--cached", "--name-only"), "");
    rmSync(join(r, name));
  }
  // discard tracked (staged + worktree) and untracked
  writeFileSync(join(r, "t.txt"), "changed\n"); git(r, "add", "t.txt"); writeFileSync(join(r, "t.txt"), "again\n");
  writeFileSync(join(r, "-u.txt"), "u");
  const d = { type: "discard", tracked: ["t.txt"], untracked: ["-u.txt"] };
  assert.equal((await run(r, d)).ok, true);
  assert.equal(readFileSync(join(r, "t.txt"), "utf8"), "changed\n"); // staged edit kept
  assert.equal(git(r, "diff", "--cached", "--name-only"), "t.txt");
  assert.equal(existsSync(join(r, "-u.txt")), false);
  git(r, "reset", "-q", "--hard");
  // (a) staged-new file edited again, (d) mixed with plain M
  writeFileSync(join(r, "new.txt"), "v1\n"); git(r, "add", "new.txt"); writeFileSync(join(r, "new.txt"), "v2\n");
  writeFileSync(join(r, "t.txt"), "m\n");
  assert.equal((await run(r, { type: "discard", tracked: ["new.txt", "t.txt"], untracked: [] })).ok, true);
  assert.equal(readFileSync(join(r, "new.txt"), "utf8"), "v1\n");
  assert.equal(readFileSync(join(r, "t.txt"), "utf8"), "orig\n");
  assert.equal(git(r, "diff", "--cached", "--name-only"), "new.txt");
  git(r, "reset", "-q", "--hard"); git(r, "clean", "-fq");
  // literal pathspecs
  writeFileSync(join(r, "[x].txt"), "1"); writeFileSync(join(r, "x.txt"), "2");
  assert.equal((await run(r, { type: "stage", paths: ["[x].txt"] })).ok, true);
  assert.equal(git(r, "diff", "--cached", "--name-only"), "[x].txt");
  await run(r, { type: "unstage", paths: ["[x].txt"] });
  assert.equal((await run(r, { type: "discard", tracked: [], untracked: ["[x].txt"] })).ok, true);
  assert.equal(existsSync(join(r, "x.txt")), true); assert.equal(existsSync(join(r, "[x].txt")), false);
  rmSync(join(r, "x.txt"));
  // dialogs
  // d is mixed (tracked + untracked): the title says files get deleted
  assert.equal(dialogFor(d, {}).title, "Discard changes and delete files");
  assert.equal(dialogFor(d, {}).confirm, "Discard and delete");
  const du = dialogFor({ type: "discard", tracked: [], untracked: Array.from({ length: 7 }, (_, i) => `f${i}`) }, {});
  assert.equal(du.title, "Delete untracked files"); assert.equal(du.confirm, "Delete");
  assert.match(du.detail, /and 2 more/); assert.doesNotMatch(du.detail, /f5/);
  assert.match(du.detail, /^Delete 7 untracked files:/); assert.equal(du.danger, true);
  // tracked only: never says Delete
  const dt = dialogFor({ type: "discard", tracked: ["a.txt", "b.txt"], untracked: [] }, {});
  assert.equal(dt.title, "Discard changes"); assert.equal(dt.confirm, "Discard"); assert.equal(dt.danger, true);
  assert.match(dt.detail, /^Discard changes to 2 files:\na\.txt\nb\.txt\n/); assert.doesNotMatch(dt.detail, /Delete/);
  // mixed: a separate, counted Delete line, untracked never hidden in the tracked "more"
  const mixed = { type: "discard", tracked: ["t1", "t2", "t3", "t4"], untracked: ["u1"] };
  const dm = dialogFor(mixed, {});
  assert.equal(dm.title, "Discard changes and delete files"); assert.equal(dm.danger, true);
  assert.match(dm.detail, /Discard changes to 4 files:\nt1\n/); assert.match(dm.detail, /\nDelete 1 untracked file:\nu1\n/);
  assert.match(dm.detail, /can't be undone/);
  const dm2 = dialogFor({ type: "discard", tracked: Array.from({ length: 9 }, (_, i) => `t${i}`), untracked: Array.from({ length: 6 }, (_, i) => `u${i}`) }, {});
  assert.match(dm2.detail, /Discard changes to 9 files:/); assert.match(dm2.detail, /Delete 6 untracked files:/);
  // height: every detail line gets its row, wrapped lines more
  const lineCount = dm.detail.split("\n").length;
  assert.ok(dialogHeight(dm) >= 36 + 26 + lineCount * 19 + 8 + 30 + 52, "mixed dialog tall enough for its lines");
  assert.ok(dialogHeight({ detail: "x".repeat(110) }) > dialogHeight({ detail: "x".repeat(10) }), "long lines wrap");
  assert.equal(dialogFor({ type: "stashDrop", ref: "stash@{0}", hash: "a".repeat(40) }, {}).danger, true);
  assert.equal(doneText({ type: "stage", paths: ["a", "b"] }), "Staged 2 files");
  assert.equal(doneText({ type: "unstage", paths: ["a"] }), "Unstaged 1 files");
  assert.equal(doneText(d), "Discarded 2 files");
  // stale
  const c = ctxOf(r); git(r, "commit", "-q", "--allow-empty", "-m", "n");
  const st = await executeAction({ type: "stage", paths: ["x"] }, {}, c, exec(r));
  assert.equal(st.ok, false); assert.equal(st.stale, true);
  // invalid paths
  await assert.rejects(() => run(r, { type: "stage", paths: [] }));
  await assert.rejects(() => run(r, { type: "stage", paths: ["a\0b"] }));
  // unborn HEAD
  const u = mk("u");
  writeFileSync(join(u, "n.txt"), "n"); writeFileSync(join(u, "m.txt"), "m"); git(u, "add", "n.txt");
  assert.equal((await run(u, { type: "unstage", paths: ["n.txt"] })).ok, true);
  assert.equal(git(u, "diff", "--cached", "--name-only"), "");
  git(u, "add", "n.txt"); writeFileSync(join(u, "n.txt"), "n2");
  assert.equal((await run(u, { type: "discard", tracked: ["n.txt"], untracked: ["m.txt"] })).ok, true);
  assert.equal(readFileSync(join(u, "n.txt"), "utf8"), "n"); assert.equal(existsSync(join(u, "m.txt")), false);
  assert.equal(git(u, "diff", "--cached", "--name-only"), "n.txt");
  // stashes
  const s = mk("s");
  writeFileSync(join(s, "t.txt"), "orig\n"); git(s, "add", "."); git(s, "commit", "-qm", "i");
  writeFileSync(join(s, "one.txt"), "1"); git(s, "add", "one.txt"); git(s, "stash", "push", "-qm", "first");
  writeFileSync(join(s, "two.txt"), "2"); git(s, "add", "two.txt"); git(s, "stash", "push", "-qm", "second");
  const list = parseStashes(git(s, ...STASH_LIST));
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((x) => x.ref), ["stash@{0}", "stash@{1}"]);
  assert.match(list[0].message, /second/); assert.match(list[1].message, /first/);
  assert.equal(typeof list[0].time, "number");
  assert.deepEqual(parseStashes(""), []);
  assert.match(list[0].hash, /^[0-9a-f]{40}$/); assert.equal(list[0].hash, git(s, "rev-parse", "stash@{0}"));
  const pick = (x) => ({ ref: x.ref, hash: x.hash, message: x.message });
  // a stash pushed since the list was read shifts the refs: the old ref with its old hash is refused
  writeFileSync(join(s, "three.txt"), "3"); git(s, "add", "three.txt"); git(s, "stash", "push", "-qm", "third");
  for (const type of ["stashApply", "stashPop", "stashDrop"]) {
    const moved = await run(s, { type, ...pick(list[0]) });
    assert.equal(moved.ok, false, type); assert.equal(moved.stale, true, type);
  }
  assert.equal(parseStashes(git(s, ...STASH_LIST)).length, 3, "nothing dropped or popped");
  assert.equal(existsSync(join(s, "two.txt")), false, "nothing applied");
  const now = parseStashes(git(s, ...STASH_LIST));
  assert.equal(now[1].hash, list[0].hash);
  assert.equal((await run(s, { type: "stashDrop", ...pick(now[0]) })).ok, true); // drop "third" by its own hash
  await assert.rejects(() => run(s, { type: "stashDrop", ref: "stash@{0}" }), /Invalid stash/); // no hash: refused
  assert.equal((await run(s, { type: "stashPop", ...pick(parseStashes(git(s, ...STASH_LIST))[1]) })).ok, true);
  assert.equal(existsSync(join(s, "one.txt")), true);
  assert.equal(parseStashes(git(s, ...STASH_LIST)).length, 1);
  assert.equal((await run(s, { type: "stashApply", ...pick(parseStashes(git(s, ...STASH_LIST))[0]) })).ok, true);
  assert.equal(parseStashes(git(s, ...STASH_LIST)).length, 1); // apply keeps it
  assert.equal(dialogFor({ type: "stashDrop", ref: "stash@{0}", message: "second" }, {}).title, "Drop stash?");
  assert.match(dialogFor({ type: "stashDrop", ref: "stash@{0}", message: "second" }, {}).detail, /second/);
  assert.equal((await run(s, { type: "stashDrop", ...pick(parseStashes(git(s, ...STASH_LIST))[0]) })).ok, true);
  assert.equal(parseStashes(git(s, ...STASH_LIST)).length, 0);
  for (const t of ["stashApply", "stashPop", "stashDrop"]) {
    await assert.rejects(() => run(s, { type: t, ref: "stash@{0}; rm -rf", hash: "a".repeat(40) }));
    await assert.rejects(() => run(s, { type: t, ref: "--all", hash: "a".repeat(40) }));
    await assert.rejects(() => run(s, { type: t, ref: "stash@{0}", hash: "--all" }));
  }
  assert.deepEqual(commandsFor({ type: "stashPop", ref: "stash@{3}", hash: "b".repeat(40) }), [["stash", "pop", "stash@{3}"]]);

  // ---- smart commit
  // Untrimmed: a status entry starts with a space (" M a.txt").
  const groupsOf = (d) => parseGroups(execFileSync("git", [...READ, "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd: d, env, encoding: "utf8" }));
  const sc = mk("sc");
  writeFileSync(join(sc, "t.txt"), "1\n"); git(sc, "add", "."); git(sc, "commit", "-qm", "i");
  assert.equal(commitValues(groupsOf(sc), "msg"), null, "nothing to commit");
  writeFileSync(join(sc, "t.txt"), "2\n"); writeFileSync(join(sc, "new.txt"), "n\n"); git(sc, "add", "t.txt");
  assert.equal(commitValues(groupsOf(sc), "   "), null, "blank message");
  assert.deepEqual(commitValues(groupsOf(sc), "  staged only \n"), { message: "staged only", all: false });
  assert.equal((await executeAction({ type: "commit" }, commitValues(groupsOf(sc), "staged only"), ctxOf(sc), exec(sc))).ok, true);
  assert.equal(existsSync(join(sc, "new.txt")) && git(sc, "ls-files", "new.txt"), "", "untracked file left alone");
  const vals = commitValues(groupsOf(sc), "all in");
  assert.deepEqual(vals, { message: "all in", all: true, smart: true });
  assert.equal((await executeAction({ type: "commit" }, vals, ctxOf(sc), exec(sc))).ok, true);
  assert.equal(git(sc, "ls-files", "new.txt"), "new.txt");
  assert.equal(git(sc, "status", "--porcelain"), "");
  // nothing staged + conflict -> existing unresolved-conflicts guard
  const cf = mk("cf");
  writeFileSync(join(cf, "c"), "b"); git(cf, "add", "."); git(cf, "commit", "-qm", "b");
  git(cf, "checkout", "-qb", "side"); writeFileSync(join(cf, "c"), "s"); git(cf, "commit", "-qam", "s");
  git(cf, "checkout", "-q", "main"); writeFileSync(join(cf, "c"), "m"); git(cf, "commit", "-qam", "m");
  spawnSync("git", ["merge", "-q", "side"], { cwd: cf, env });
  const cv = commitValues(groupsOf(cf), "merge");
  assert.deepEqual(cv, { message: "merge", all: true, smart: true });
  const refused = await executeAction({ type: "commit" }, cv, ctxOf(cf), exec(cf));
  assert.equal(refused.ok, false);
  assert.match(refused.message, /unresolved merge conflicts/);
  // ---- mark a conflict resolved: asks first, stages exactly that file
  assert.equal(hasConflictMarkers("a\n<<<<<<< HEAD\nm\n=======\ns\n>>>>>>> side\n"), true);
  assert.equal(hasConflictMarkers("a\n  <<<<<<< not at start\nb\n"), false);
  assert.equal(hasConflictMarkers("clean\n"), false);
  const mr = dialogFor({ type: "markResolved", path: "c", markers: true }, {});
  assert.equal(mr.title, "Mark as resolved?"); assert.equal(mr.danger, true);
  assert.match(mr.detail, /\bc\b/); assert.match(mr.detail, /conflict markers/);
  assert.doesNotMatch(dialogFor({ type: "markResolved", path: "c", markers: false }, {}).detail, /still contains/);
  assert.deepEqual(commandsFor({ type: "markResolved", path: "-x [y].txt" }), [["--literal-pathspecs", "add", "--", "-x [y].txt"]]);
  assert.throws(() => commandsFor({ type: "markResolved", path: "" }), /Invalid file paths/);
  writeFileSync(join(cf, "c"), "resolved\n");
  assert.equal((await executeAction({ type: "markResolved", path: "c" }, {}, ctxOf(cf), exec(cf))).ok, true);
  assert.equal(git(cf, "ls-files", "--unmerged"), "");
  assert.equal(git(cf, "diff", "--cached", "--name-only"), "c");
  assert.equal(doneText({ type: "markResolved", path: "c" }), "Marked c as resolved");
  // ---- smart commit on a stale panel: something staged since the panel read "nothing staged"
  const ss = mk("ss");
  writeFileSync(join(ss, "a.txt"), "1\n"); writeFileSync(join(ss, "b.txt"), "1\n"); git(ss, "add", "."); git(ss, "commit", "-qm", "i");
  writeFileSync(join(ss, "a.txt"), "2\n"); writeFileSync(join(ss, "b.txt"), "2\n");
  const sv = commitValues(groupsOf(ss), "all of it");
  assert.equal(sv.smart, true);
  git(ss, "add", "a.txt"); // staged in a terminal after the panel drew
  const head0 = git(ss, "rev-parse", "HEAD");
  const late = await executeAction({ type: "commit" }, sv, ctxOf(ss), exec(ss));
  assert.equal(late.ok, false); assert.equal(late.stale, true);
  assert.equal(git(ss, "rev-parse", "HEAD"), head0, "nothing committed");
  assert.equal(git(ss, "diff", "--cached", "--name-only"), "a.txt", "nothing more staged");
  // the commit dialog's explicit "stage every change" (not smart) still stages and commits
  assert.equal((await executeAction({ type: "commit" }, { message: "explicit", all: true }, ctxOf(ss), exec(ss))).ok, true);
  assert.equal(git(ss, "status", "--porcelain"), "");
  // smart commit in a repo with no commits yet
  const su = mk("su");
  writeFileSync(join(su, "n.txt"), "n");
  assert.equal((await executeAction({ type: "commit" }, commitValues(groupsOf(su), "first"), ctxOf(su), exec(su))).ok, true);
  assert.equal(git(su, "ls-files"), "n.txt");
} finally { rmSync(base, { recursive: true, force: true }); }
console.log("actions tests passed");
