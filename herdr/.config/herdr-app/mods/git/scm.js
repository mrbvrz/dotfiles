// Pure SCM parsing for the changes panel: status groups, upstream counts and
// the in-progress repo operation. No "herdr" import, so node tests load it.
import { READ } from "./git.js";

const UNMERGED = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
const KNOWN = new Set(["M", "A", "D", "R", "T"]);
const letter = (c) => (KNOWN.has(c) ? c : c === "C" ? "A" : "M");

// Input: `git status --porcelain=v1 -z --no-renames --untracked-files=all`.
export function parseGroups(statusZ) {
  const out = { staged: [], changes: [], conflicts: [] };
  for (const entry of statusZ.split("\0")) {
    if (entry.length < 4) continue;
    const x = entry[0], y = entry[1], path = entry.slice(3), xy = x + y;
    if (xy === "!!") continue;
    if (xy === "??") out.changes.push({ path, x, y, status: "U", untracked: true });
    else if (UNMERGED.has(xy)) out.conflicts.push({ path, x, y, status: "!", untracked: false });
    else {
      if (x !== " ") out.staged.push({ path, x, y, status: letter(x), untracked: false });
      if (y !== " ") out.changes.push({ path, x, y, status: letter(y), untracked: false });
    }
  }
  return out;
}

// Input: `rev-list --left-right --count HEAD...@{upstream}`.
export function parseAheadBehind(stdout) {
  const [ahead, behind] = stdout.trim().split(/\s+/).map(Number);
  return { ahead: ahead || 0, behind: behind || 0 };
}

export function repoOperation(gitDir, exists) {
  if (exists(`${gitDir}/rebase-merge`) || exists(`${gitDir}/rebase-apply`)) return "rebase";
  if (exists(`${gitDir}/MERGE_HEAD`)) return "merge";
  return null;
}

// Live detection for executeAction. git(args) -> {code, stdout}; isDir(path) -> Promise<boolean>.
// Paths from --git-path are relative to the repo root (the exec cwd) and honour worktrees.
export async function operationOf(git, isDir) {
  for (const dir of ["rebase-merge", "rebase-apply"]) {
    const r = await git([...READ, "rev-parse", "--git-path", dir]);
    if (r.code === 0 && r.stdout.trim() && await isDir(r.stdout.trim())) return "rebase";
  }
  const m = await git([...READ, "rev-parse", "-q", "--verify", "MERGE_HEAD"]);
  return m.code === 0 ? "merge" : null;
}

// What the sync button does for this branch state.
// head: the HEAD commit or null (unborn repo: nothing to sync).
export function syncPlan({ branch, head, upstream, ahead = 0, behind = 0, remotes = [] }) {
  if (!branch || !head) return { kind: "none", label: "Sync" };
  if (!upstream) return remotes.length ? { kind: "publish", label: "Publish" } : { kind: "none", label: "Sync" };
  if (ahead > 0 && behind > 0) return { kind: "diverged", label: `Sync ↑${ahead} ↓${behind}` };
  if (behind > 0) return { kind: "pull", label: `Sync ↓${behind}` };
  if (ahead > 0) return { kind: "push", label: `Sync ↑${ahead}` };
  return { kind: "none", label: "Sync" };
}

export const STASH_LIST = [...READ, "stash", "list", "--format=%gd%x1f%H%x1f%ct%x1f%s"];

// Input: STASH_LIST output, newest first. hash pins the entry: stash@{n} shifts
// whenever a stash is pushed or dropped elsewhere.
export function parseStashes(stdout) {
  return stdout.split("\n").filter(Boolean).map((line) => {
    const [ref, hash, time, ...message] = line.split("\x1f");
    return { ref, hash, message: message.join("\x1f"), time: Number(time) || 0 };
  });
}

// Smart commit: staged files commit as-is; with nothing staged the existing
// `commit` action stages everything first (and keeps its unmerged-files guard).
// smart: "all" was inferred from this read, so executeAction refuses it if
// something has been staged since.
export function commitValues(groups, message) {
  const text = message.trim();
  if (!text) return null;
  if (groups.staged.length) return { message: text, all: false };
  if (groups.changes.length || groups.conflicts.length) return { message: text, all: true, smart: true };
  return null;
}
