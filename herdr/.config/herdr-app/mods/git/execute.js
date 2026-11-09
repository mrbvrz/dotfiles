// Action execution is separate from the UI so context checks can be tested
// against disposable repositories. exec has Herdr's (program, argv, options) shape.
import { HUNK_APPLY } from "./hunks.js";
import { READ, commandsFor, gitError } from "./git.js";
import { operationOf } from "./scm.js";

const NETWORK = new Set(["fetch", "pull", "push"]);
const NEEDS_BRANCH = new Set(["sync", "publish", "pullRebase", "pullMerge"]);

export async function executeAction(action, values, ctx, exec) {
  const git = (args) => exec("git", args, { cwd: ctx.root, on: ctx.on });
  // Never pull or push a detached HEAD, nor guess a branch for it.
  if (NEEDS_BRANCH.has(action.type) && !ctx.current) return { ok: false, message: "Not on a branch. Check out a branch first." };
  const commands = commandsFor(action, values, ctx);
  // A dialog/menu describes this snapshot, not whatever HEAD happens to be
  // when the user confirms it. Fetch does not operate on the current branch.
  if (action.type !== "fetch") {
    const head = await git([...READ, "rev-parse", "--verify", "-q", "HEAD"]);
    const branch = await git([...READ, "symbolic-ref", "-q", "--short", "HEAD"]);
    // Exit 1 means unborn HEAD or detached HEAD, respectively. Other failures
    // are not empty states and must not authorize a mutation.
    if (![0, 1].includes(head.code) || ![0, 1].includes(branch.code)) {
      return { ok: false, message: "Cannot verify the repository state. Close this action and refresh the graph." };
    }
    const actualHead = head.code === 0 ? head.stdout.trim() : null;
    const actualBranch = branch.code === 0 ? branch.stdout.trim() : null;
    if (actualHead !== ctx.head || actualBranch !== ctx.current) {
      return { ok: false, stale: true, message: "The repository's branch or HEAD changed. Close this action, refresh the graph, and review it again." };
    }
  }
  // Abort/continue act on whatever operation is running: it must be the one the panel showed.
  if (action.type === "abortOperation" || action.type === "continueOperation") {
    const isDir = async (p) => (await exec("test", ["-d", p], { cwd: ctx.root, on: ctx.on })).code === 0;
    if (await operationOf(git, isDir) !== action.op) return { ok: false, stale: true, message: "The operation in progress changed. Close this action and refresh the graph." };
  }
  // Staging everything would mark unresolved conflicts resolved and commit their markers.
  if (action.type === "commit" && values.all) {
    const unmerged = await git([...READ, "ls-files", "--unmerged"]);
    if (unmerged.code !== 0 || unmerged.stdout.trim()) {
      return { ok: false, message: "There are unresolved merge conflicts. Resolve them first, or untick \"Stage every change\" to let git decide." };
    }
    // The commit box chose "everything" because nothing was staged when it last read
    // the repo. If something is staged now, committing all of it isn't what it showed.
    if (values.smart) {
      const staged = await git([...READ, "diff", "--cached", "--quiet"]);
      if (staged.code === 1) return { ok: false, stale: true, message: "Changes were staged since the panel last read the repository. Review them and commit again." };
      if (staged.code !== 0) return { ok: false, message: "Cannot verify the repository state. Close this action and refresh the graph." };
    }
  }
  // stash@{n} shifts when a stash is pushed or dropped elsewhere: it must still be the one the menu showed.
  if (["stashApply", "stashPop", "stashDrop"].includes(action.type)) {
    const at = await git([...READ, "rev-parse", "-q", "--verify", `${action.ref}^{commit}`]);
    if (at.code !== 0 || at.stdout.trim() !== action.hash) {
      return { ok: false, stale: true, message: "The stash list changed. Close this menu, refresh the graph, and pick the stash again." };
    }
  }
  // Hunks go through git apply; stdin is unavailable, so the patch is $1 of a
  // fixed script. Flags are code constants, never derived from the action's data.
  if (HUNK_APPLY[action.type]) {
    const result = await exec("sh", ["-c", `printf '%s' "$1" | git apply ${HUNK_APPLY[action.type]} -`, "_", action.patch], { cwd: ctx.root, on: ctx.on });
    return result.code === 0 ? { ok: true } : { ok: false, message: gitError(result) };
  }
  // Git has no transaction spanning these commands and other terminals. This
  // preflight detects an already changed context; it cannot lock out future edits.
  for (const args of commands) {
    // Never prompt for credentials: nobody can answer in a background exec.
    const result = NETWORK.has(args[0])
      ? await exec("env", ["GCM_INTERACTIVE=0", "GIT_TERMINAL_PROMPT=0", "GIT_ASKPASS=", "git", ...args], { cwd: ctx.root, on: ctx.on })
      : await git(args);
    if (result.code !== 0) {
      if (args[0] !== "pull") return { ok: false, message: gitError(result) };
      const isDir = async (p) => (await exec("test", ["-d", p], { cwd: ctx.root, on: ctx.on })).code === 0;
      return { ok: false, message: gitError(result), conflict: (await operationOf(git, isDir)) !== null };
    }
  }
  return { ok: true };
}
