// Split a unified diff into hunks and rebuild single-hunk patches for git apply.
import { READ } from "./git.js";

// Path is appended by the caller, after "--". Explicit a/ b/ prefixes: git apply
// strips one level, whatever diff.noprefix or diff.mnemonicPrefix say.
const OPTS = ["--no-ext-diff", "--no-textconv", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "-U3", "--"];
export const HUNK_DIFF = {
  unstaged: [...READ, "--literal-pathspecs", "diff", ...OPTS],
  staged: [...READ, "--literal-pathspecs", "diff", "--cached", ...OPTS],
};

// Fixed flags per action; the patch itself only ever travels as $1.
export const HUNK_APPLY = {
  stageHunk: "--cached --whitespace=nowarn",
  unstageHunk: "--cached --reverse --whitespace=nowarn",
  discardHunk: "--reverse --whitespace=nowarn",
};

export function parseHunks(diffText) {
  let lines = String(diffText).split("\n");
  if (lines.at(-1) === "") lines.pop();
  // Only the first file: a later "diff --git" must never lend hunks to this header.
  const next = lines.findIndex((l, i) => i > 0 && l.startsWith("diff --git "));
  if (next > 0) lines = lines.slice(0, next);
  const first = lines.findIndex((l) => l.startsWith("@@ "));
  if (first < 0) return { head: lines.join("\n"), hunks: [] };
  const hunks = [];
  for (const l of lines.slice(first)) {
    if (l.startsWith("@@ ")) hunks.push({ header: l, body: [] });
    else hunks.at(-1).body.push(l);
  }
  return { head: lines.slice(0, first).join("\n"), hunks };
}

export function patchFor(diffText, i) {
  const { head, hunks } = parseHunks(diffText);
  const h = hunks[i];
  if (!h) throw new Error("No such hunk");
  return [head, h.header, ...h.body].join("\n") + "\n";
}
