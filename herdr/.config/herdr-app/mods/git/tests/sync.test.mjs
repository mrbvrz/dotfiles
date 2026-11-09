// Sync through executeAction against a bare remote and a second clone.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeAction } from "../execute.js";
import { dialogFor, commandsFor } from "../git.js";
import { syncPlan, operationOf, repoOperation } from "../scm.js";

const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" };
const base = mkdtempSync(join(tmpdir(), "sync-"));
const git = (d, ...a) => execFileSync("git", a, { cwd: d, env, encoding: "utf8" }).trim();
const calls = [];
const exec = (d) => async (p, args) => { calls.push([p, ...args]); const r = spawnSync(p, args, { cwd: d, env, encoding: "utf8" }); return { code: r.status, stdout: r.stdout, stderr: r.stderr }; };
const ctxOf = (d, extra = {}) => ({ root: d, on: "t", head: spawnSync("git", ["rev-parse", "--verify", "-q", "HEAD"], { cwd: d, encoding: "utf8", env }).stdout.trim() || null,
  current: spawnSync("git", ["symbolic-ref", "-q", "--short", "HEAD"], { cwd: d, encoding: "utf8", env }).stdout.trim() || null, remotes: ["origin"], ...extra });
const run = (d, a, v = {}) => executeAction(a, v, ctxOf(d), exec(d));
const commit = (d, file, text, msg) => { writeFileSync(join(d, file), text); git(d, "add", "."); git(d, "commit", "-qm", msg); };
const upstreamOf = (d) => git(d, "rev-parse", "--abbrev-ref", "@{upstream}");
const dirs = () => {
  const bare = join(base, `bare${calls.length}${Math.random()}`.replace(".", ""));
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare], { env });
  const a = bare + "-a", b = bare + "-b";
  execFileSync("git", ["clone", "-q", bare, a], { env, stdio: "ignore" }); execFileSync("git", ["clone", "-q", bare, b], { env, stdio: "ignore" });
  commit(a, "f.txt", "base\n", "base"); git(a, "push", "-q", "origin", "HEAD:main"); git(a, "branch", "-u", "origin/main");
  git(b, "pull", "-q", "origin", "main"); git(b, "branch", "-u", "origin/main");
  return { bare, a, b };
};
try {
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", join(base, "bareU")], { env });
  // plan
  assert.equal(syncPlan({ branch: null, upstream: null, ahead: 0, behind: 0, remotes: ["origin"] }).kind, "none");
  assert.equal(syncPlan({ branch: "main", head: "x", upstream: null, remotes: ["origin"] }).label, "Publish");
  assert.equal(syncPlan({ branch: "main", upstream: null, remotes: [] }).kind, "none");
  assert.equal(syncPlan({ branch: "main", head: "x", upstream: "origin/main", ahead: 1, behind: 1, remotes: ["origin"] }).kind, "diverged");
  assert.equal(syncPlan({ branch: "main", head: "x", upstream: "origin/main", ahead: 2, behind: 0, remotes: ["origin"] }).kind, "push");
  assert.equal(syncPlan({ branch: "main", head: "x", upstream: "origin/main", ahead: 0, behind: 2, remotes: ["origin"] }).kind, "pull");
  const unborn = join(base, "unborn"); execFileSync("git", ["init", "-q", "-b", "main", unborn], { env });
  // unborn clone that has a remote: plan input read from the repo itself
  const ub = join(base, "ub"); execFileSync("git", ["clone", "-q", join(base, "bareU"), ub], { env, stdio: "ignore" });
  const ubBranch = spawnSync("git", ["symbolic-ref", "-q", "--short", "HEAD"], { cwd: ub, env, encoding: "utf8" }).stdout.trim() || null;
  const ubHead = spawnSync("git", ["rev-parse", "--verify", "-q", "HEAD"], { cwd: ub, env, encoding: "utf8" }).stdout.trim() || null;
  assert.equal(ubHead, null); assert.ok(ubBranch);
  assert.equal(syncPlan({ branch: ubBranch, head: ubHead, upstream: null, remotes: ["origin"] }).kind, "none");
  assert.equal(await operationOf(async (a) => { const r = spawnSync("git", a, { cwd: unborn, env, encoding: "utf8" }); return { code: r.status, stdout: r.stdout }; }, async () => false), null);

  // ahead-only: sync pushes, through the non-interactive env
  let { bare, a, b } = dirs();
  commit(a, "a.txt", "1\n", "ahead");
  calls.length = 0;
  assert.deepEqual(await run(a, { type: "sync" }), { ok: true });
  assert.equal(git(bare, "rev-parse", "main"), git(a, "rev-parse", "HEAD"));
  assert.ok(calls.some((c) => c[0] === "env" && c.slice(1, 5).join() === "GCM_INTERACTIVE=0,GIT_TERMINAL_PROMPT=0,GIT_ASKPASS=,git" && c[5] === "push"));
  assert.ok(calls.some((c) => c[0] === "env" && c[5] === "pull"));
  // behind-only: fast-forwards
  assert.deepEqual(await run(b, { type: "sync" }), { ok: true });
  assert.equal(git(b, "rev-parse", "HEAD"), git(a, "rev-parse", "HEAD"));

  // diverged, non-conflicting: rebase leaves linear history and pushes
  commit(a, "a2.txt", "x\n", "remote side"); git(a, "push", "-q");
  commit(b, "b.txt", "y\n", "local side");
  git(b, "fetch", "-q");
  assert.equal(syncPlan({ branch: "main", head: "x", upstream: upstreamOf(b), ahead: 1, behind: 1, remotes: ["origin"] }).kind, "diverged");
  assert.equal((await run(b, { type: "sync" })).ok, false); // ff-only refuses
  assert.deepEqual(await run(b, { type: "pullRebase", upstream: "origin/main" }), { ok: true });
  assert.equal(git(b, "rev-list", "--merges", "--count", "HEAD"), "0");
  assert.equal(git(bare, "rev-parse", "main"), git(b, "rev-parse", "HEAD"));

  for (const [type, op] of [["pullRebase", "rebase"], ["pullMerge", "merge"]]) {
    ({ bare, a, b } = dirs());
    commit(a, "f.txt", "remote\n", "r"); git(a, "push", "-q");
    commit(b, "f.txt", "local\n", "l");
    const pre = git(b, "rev-parse", "HEAD"), remotePre = git(bare, "rev-parse", "main");
    const r = await run(b, { type, upstream: "origin/main" });
    assert.equal(r.ok, false); assert.equal(r.conflict, true);
    assert.equal(git(bare, "rev-parse", "main"), remotePre); // nothing pushed
    const live = await operationOf(async (x) => { const q = spawnSync("git", x, { cwd: b, env, encoding: "utf8" }); return { code: q.status, stdout: q.stdout }; },
      async (p) => spawnSync("test", ["-d", p], { cwd: b }).status === 0);
    assert.equal(live, op);
    assert.equal(repoOperation(join(b, ".git"), (p) => spawnSync("test", ["-e", p]).status === 0), op);
    // abort must run although HEAD is detached mid-rebase
    const wrong = op === "rebase" ? "merge" : "rebase";
    const refused = await executeAction({ type: "abortOperation", op: wrong }, {}, ctxOf(b), exec(b));
    assert.equal(refused.ok, false); assert.equal(refused.stale, true);
    assert.equal((await executeAction({ type: "continueOperation", op: wrong }, {}, ctxOf(b), exec(b))).ok, false);
    assert.equal((await executeAction({ type: "abortOperation", op }, {}, { ...ctxOf(b), head: "0".repeat(40) }, exec(b))).stale, true); // stale panel
    assert.equal(await operationOf(async (x) => { const q = spawnSync("git", x, { cwd: b, env, encoding: "utf8" }); return { code: q.status, stdout: q.stdout }; }, async (p) => spawnSync("test", ["-d", p], { cwd: b }).status === 0), op); // still in progress
    assert.equal((await executeAction({ type: "abortOperation", op }, {}, ctxOf(b), exec(b))).ok, true);
    assert.equal(git(b, "rev-parse", "HEAD"), pre);
    assert.equal(git(b, "status", "--porcelain"), "");

    // continue after resolving
    assert.equal((await run(b, { type, upstream: "origin/main" })).conflict, true);
    writeFileSync(join(b, "f.txt"), "resolved\n"); git(b, "add", "f.txt");
    assert.equal((await executeAction({ type: "continueOperation", op }, {}, ctxOf(b), exec(b))).ok, true);
    assert.equal(git(b, "status", "--porcelain"), "");
    assert.equal(git(b, "show", "HEAD:f.txt"), "resolved");
  }

  // publish a new branch sets upstream
  ({ bare, a, b } = dirs());
  git(a, "checkout", "-q", "-b", "feat"); commit(a, "n.txt", "n\n", "n");
  // name is advisory: the checked-out branch is what gets published
  const refsBefore = git(bare, "for-each-ref");
  assert.equal((await executeAction({ type: "publish", name: "other" }, {}, { ...ctxOf(a), current: null }, exec(a))).ok, false);
  assert.equal(git(bare, "for-each-ref"), refsBefore);
  assert.deepEqual(await run(a, { type: "publish", name: "other" }), { ok: true });
  assert.equal(upstreamOf(a), "origin/feat");
  assert.equal(dialogFor({ type: "publish", name: "feat" }, { remotes: ["origin"] }), null);
  assert.equal(dialogFor({ type: "publish", name: "feat" }, { remotes: ["origin", "up"] }).choice.value, "origin");
  assert.throws(() => commandsFor({ type: "publish", name: "feat" }, { remote: "evil" }, { remotes: ["origin"], current: "feat" }), /remote/);
  assert.throws(() => commandsFor({ type: "abortOperation", op: "x" }, {}, {}), /operation/);
  const dd = dialogFor({ type: "pullRebase", upstream: "origin/main" }, ctxOf(a));
  assert.equal(dd.title, "Your branch and origin/main have diverged");
  assert.deepEqual(dd.buttons.map((x) => x.label), ["Pull with rebase", "Pull with merge", "Cancel"]);
  assert.equal(dialogFor({ type: "abortOperation", op: "rebase" }, ctxOf(a)).danger, true);

  // detached head: sync/publish refuse, remote untouched
  git(a, "checkout", "-q", "--detach");
  const refsDet = git(bare, "for-each-ref");
  for (const t of ["sync", "publish", "pullRebase", "pullMerge"]) assert.equal((await run(a, { type: t, name: "feat" })).ok, false, t);
  assert.equal(git(bare, "for-each-ref"), refsDet);
  assert.equal(syncPlan({ branch: null, upstream: null, ahead: 0, behind: 0, remotes: ["origin"] }).kind, "none");
  console.log("sync ok");
} catch (e) { console.error(e); process.exitCode = 1; }
