// Tests scm.js (status groups, upstream counts, repo operation) against real
// throwaway repos. Run: node tests/scm.test.mjs
import { parseGroups, parseAheadBehind, repoOperation } from "../scm.js";
import * as G from "../git.js";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const env = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null" };
const sh = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const tryGit = (cwd, ...args) => spawnSync("git", args, { cwd, env, encoding: "utf8" });
const put = (cwd, name, text) => writeFileSync(join(cwd, name), text);
const status = (cwd) => parseGroups(sh(cwd, ...G.READ, ...G.STATUS));
const base = mkdtempSync(join(tmpdir(), "herdr-git-scm-")), repo = join(base, "repo");
sh(base, "init", "-q", "-b", "main", repo);

// ---- groups
put(repo, "a b.txt", "1\n"); put(repo, "gone.txt", "x\n"); put(repo, "ñ.txt", "1\n");
sh(repo, "add", "."); sh(repo, "commit", "-qm", "init");
put(repo, "a b.txt", "2\n"); sh(repo, "add", "a b.txt"); put(repo, "a b.txt", "3\n"); // staged + modified
put(repo, "-dash.txt", "u\n");                                                   // untracked
rmSync(join(repo, "gone.txt"));                                                   // deleted (worktree)
put(repo, "ñ.txt", "2\n");                                                        // modified unicode
put(repo, "new.txt", "n\n"); sh(repo, "add", "new.txt");                          // added
let g = status(repo);
const by = (list, p) => list.find((f) => f.path === p);
assert.equal(by(g.staged, "a b.txt").status, "M");
assert.equal(by(g.changes, "a b.txt").status, "M");
assert.equal(by(g.staged, "new.txt").status, "A");
assert.equal(by(g.changes, "new.txt"), undefined);
assert.deepEqual([by(g.changes, "-dash.txt").status, by(g.changes, "-dash.txt").untracked], ["U", true]);
assert.equal(by(g.staged, "-dash.txt"), undefined);
assert.equal(by(g.changes, "gone.txt").status, "D");
assert.equal(by(g.changes, "ñ.txt").status, "M");
assert.equal(by(g.changes, "a b.txt").untracked, false);
assert.deepEqual(g.conflicts, []);
assert.deepEqual(parseGroups(""), { staged: [], changes: [], conflicts: [] });

// ---- conflicts (merge)
const m = join(base, "m");
sh(base, "init", "-q", "-b", "main", m);
put(m, "c.txt", "base\n"); sh(m, "add", "."); sh(m, "commit", "-qm", "base");
sh(m, "checkout", "-qb", "other"); put(m, "c.txt", "other\n"); sh(m, "commit", "-qam", "other");
sh(m, "checkout", "-q", "main"); put(m, "c.txt", "main\n"); sh(m, "commit", "-qam", "main");
assert.notEqual(tryGit(m, "merge", "other").status, 0);
g = status(m);
assert.deepEqual(g.conflicts.map((f) => [f.path, f.status, f.x + f.y]), [["c.txt", "!", "UU"]]);
assert.deepEqual([g.staged, g.changes], [[], []]);
assert.equal(repoOperation(join(m, ".git"), existsSync), "merge");
assert.equal(repoOperation(join(repo, ".git"), existsSync), null);

// ---- rebase
sh(m, "merge", "--abort");
assert.notEqual(tryGit(m, "rebase", "other").status, 0);
assert.equal(repoOperation(join(m, ".git"), existsSync), "rebase");

// ---- ahead/behind
assert.deepEqual(parseAheadBehind("2\t1\n"), { ahead: 2, behind: 1 });
assert.deepEqual(parseAheadBehind(""), { ahead: 0, behind: 0 });

rmSync(base, { recursive: true, force: true });
console.log("scm tests passed");
