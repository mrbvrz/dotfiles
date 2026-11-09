// crest: pure logic. No Herdr or GPUI imports, so all of it runs under `node --test`.

/**
 * @typedef {"auto" | "project" | "owner" | "letter"} IconMode
 * @typedef {{
 *   size: number, radius: number, dot: boolean, group: "none" | "owner",
 *   icon: IconMode, pr: boolean, dirty: boolean, agents: "active" | "all" | "none", programs: boolean,
 *   folders: Record<string, string[]>, icons: Record<string, string>
 * }} Config
 * @typedef {{ color?: string, members: string[] }} Folder
 * @typedef {{ w: { id: string, name?: string, status?: string, folder?: string, machine?: string | null },
 *             g?: { avatar?: string, owner?: string, name?: string, repo?: string } | null,
 *             tree?: string | null }} Row
 */

/** @type {Readonly<Config>} */
export const DEFAULTS = Object.freeze({
  size: 24, radius: 8, dot: true, group: "owner",
  icon: "auto", pr: true, dirty: true, agents: "active", programs: false, folders: {}, icons: {},
});

export const PALETTE = Object.freeze([
  "#5b8def", "#2fb39f", "#e5a13b", "#e0699a", "#9a7bea",
  "#e57a5a", "#4cb574", "#45a7d6", "#c46fd1", "#c9a23d",
]);

export const HOSTS = Object.freeze(["github.com", "gitlab.com", "codeberg.org", "bitbucket.org"]);
const REMOTE = /(github\.com|gitlab\.com|codeberg\.org|bitbucket\.org)[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;

// ---------------------------------------------------------------- identity

/** Same key, same color, everywhere. */
export function hashColor(key) {
  let h = 0;
  for (const c of String(key)) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** A short stable id for a path (FNV-1a, 32 bit, hex): cache file names that never collide by accident. */
export function hashKey(str) {
  let h = 0x811c9dc5;
  for (const c of String(str)) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** `git@github.com:o/r.git`, `https://gitlab.com/o/r` ... -> { host, owner, repo } */
export function parseRemote(url) {
  const hit = REMOTE.exec(String(url ?? "").trim());
  return hit ? { host: hit[1], owner: hit[2], repo: hit[3] } : null;
}

/** The ssh host alias in a remote parseRemote can't read (`git@github-work:o/r.git` -> "github-work"), else null.
 *  `ssh -G <alias>` says which host it is: see sshHostname and withHost. */
export function sshAlias(url) {
  const s = String(url ?? "").trim();
  if (parseRemote(s)) return null;
  // Never a leading "-": ssh would read the alias as an option.
  return /^(?:[^@\s/]+@)?([A-Za-z0-9_][A-Za-z0-9_.-]*):(?!\/)\S/.exec(s)?.[1] ?? null;
}

/** The real host from `ssh -G` output, or null. */
export function sshHostname(out) {
  return /^hostname (\S+)$/m.exec(String(out ?? ""))?.[1] ?? null;
}

/** `gh pr view` answering that the branch has no PR: a real answer, not a reason to ask again. */
export function noPr(stderr) {
  return /no (open )?pull requests? found/i.test(String(stderr ?? ""));
}

/** The remote with its ssh host alias swapped for the real host. */
export function withHost(url, alias, host) {
  return String(url ?? "").trim().replace(`${alias}:`, `${host}:`);
}

/** File stem of a downloaded owner picture. GitHub owners keep their bare name. */
export function avatarKey(host, owner) {
  return host === "github.com" ? owner : `${host}__${owner}`;
}

/** Project icon candidates, best first. Paths are repo-relative, from `git ls-files`. */
const ICON_NAMES = [
  [/^\.crest\.(png|svg|jpe?g)$/i, 0],
  [/(^|\/)apple-touch-icon\.png$/i, 1],
  [/(^|\/)favicon\.svg$/i, 2],
  [/(^|\/)icon\.svg$/i, 3],
  [/(^|\/)favicon\.png$/i, 4],
  [/(^|\/)icon\.png$/i, 5],
  [/(^|\/)logo\.svg$/i, 6],
  [/(^|\/)logo\.png$/i, 7],
];
const ICON_DIRS = /(^|\/)(public|static|app|src\/app|assets|images|img|\.github|docs)\//i;
const ICON_SKIP = /(^|\/)(node_modules|vendor|dist|build|out|\.next|coverage|fixtures?|tests?|__tests__|examples?)\//i;

/** The best project icon among repo files, or null. Shallow, conventional places win. */
export function pickIcon(files) {
  let best = null;
  for (const f of files ?? []) {
    if (ICON_SKIP.test(f)) continue;
    const rule = ICON_NAMES.find(([re]) => re.test(f));
    if (!rule) continue;
    const depth = f.split("/").length - 1;
    if (depth > 4) continue;
    const score = rule[1] * 10 + depth * 3 + (ICON_DIRS.test(f) || depth === 0 ? 0 : 8);
    if (!best || score < best.score || (score === best.score && f < best.f)) best = { f, score };
  }
  return best?.f ?? null;
}

/** Which picture a space shows, in order of what the user asked for. */
export function chooseIcon(mode, { custom, project, owner }) {
  if (custom) return custom;
  if (mode === "letter") return null;
  if (mode === "owner") return owner ?? null;
  if (mode === "project") return project ?? null;
  return project ?? owner ?? null;
}

/** The letter for a tile with no picture: the first letter or digit of the name. */
export function initial(name) {
  const str = String(name ?? "").trim();
  const m = str.match(/[\p{L}\p{N}]/u);
  return m ? m[0].toUpperCase() : [...str][0] ?? "?";
}

// ---------------------------------------------------------------- settings

/** Merge a user's crest.json over the defaults. Unknown keys and wrong types are dropped. */
export function normalizeConfig(raw) {
  /** @type {Config} */
  const out = { ...DEFAULTS, folders: {}, icons: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  if (Number.isFinite(raw.size) && raw.size >= 14 && raw.size <= 48) out.size = raw.size;
  if (Number.isFinite(raw.radius) && raw.radius >= 0) out.radius = Math.min(raw.radius, out.size / 2);
  for (const k of ["dot", "pr", "dirty", "programs"]) if (typeof raw[k] === "boolean") out[k] = raw[k];
  if (["active", "all", "none"].includes(raw.agents)) out.agents = raw.agents;
  if (raw.group === "owner" || raw.group === "none") out.group = raw.group;
  if (["auto", "project", "owner", "letter"].includes(raw.icon)) out.icon = raw.icon;
  if (raw.folders && typeof raw.folders === "object") {
    for (const [name, list] of Object.entries(raw.folders)) {
      const clean = [].concat(list).filter((x) => typeof x === "string" && x);
      if (name && clean.length) out.folders[name] = clean;
    }
  }
  if (raw.icons && typeof raw.icons === "object") {
    for (const [k, v] of Object.entries(raw.icons)) if (typeof v === "string" && v) out.icons[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------- folders

/** What a folder remembers a space by: its repo (so worktrees follow), else its folder. */
export function memberKey(row) {
  return row.g?.repo ?? JSON.stringify([row.w.machine ?? null, row.w.folder ?? row.w.id]);
}

/** A smart-folder rule: an owner, a repo name, or a space-name prefix ending in `*`. */
export function matches(rule, row) {
  if (rule.endsWith("*")) return String(row.w.name ?? "").toLowerCase().startsWith(rule.slice(0, -1).toLowerCase());
  const r = rule.toLowerCase();
  return [row.g?.owner, row.g?.name].some((v) => v && v.toLowerCase() === r);
}

/**
 * The folder a top-level row belongs to, or null for "no folder".
 * Your own folders win, then rules from crest.json, then the owner (group: "owner").
 * @param {Row} row
 * @param {{ manual: Record<string, Folder>, cfg: Config }} ctx
 */
export function folderFor(row, { manual, cfg, hidden = [], loose = [] }) {
  const key = memberKey(row);
  for (const [name, f] of Object.entries(manual ?? {})) if (f.members?.includes(key)) return name;
  if (loose.includes(key)) return null;
  const off = new Set(hidden);
  for (const [name, rules] of Object.entries(cfg.folders ?? {})) if (!off.has(name) && rules.some((rule) => matches(rule, row))) return name;
  if (cfg.group === "owner" && row.g?.owner && !off.has(row.g.owner)) return row.g.owner;
  return null;
}

/** Removing a folder: yours is deleted, an automatic one is turned off. Its spaces stay, ungrouped. */
export function removeFolder({ manual = {}, hidden = [] }, name) {
  const next = { ...manual };
  delete next[name];
  return { manual: next, hidden: hidden.includes(name) ? hidden : [...hidden, name] };
}

/** A repo's main checkout from its git-common-dir key `[machine, ".../repo/.git"]`; null for a bare repo. */
export function mainTop(repo) {
  try {
    const dir = JSON.parse(repo)[1];
    return typeof dir === "string" && dir.endsWith("/.git") ? dir.slice(0, -5) : null;
  } catch {
    return null;
  }
}

/**
 * Spaces in sidebar order, each worktree under its repo's main checkout.
 * When the main checkout isn't open, two or more worktrees of one repo go under a
 * stand-in row for the repo (`ghost: true`), so they still read as one group.
 * @param {Row[]} list spaces in their order, each `{ w, i, g }`
 */
export function nest(list) {
  const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
  const count = {};
  for (const r of list) if (r.g?.linked && !mains.has(r.g.repo)) count[r.g.repo] = (count[r.g.repo] ?? 0) + 1;
  const under = (r) => Boolean(r.g?.linked) && (mains.has(r.g.repo) || count[r.g.repo] > 1);
  const kids = (repo) => list.filter((k) => under(k) && k.g.repo === repo).map((k, n, all) => ({ ...k, tree: n === all.length - 1 ? "└─" : "├─" }));
  const out = [];
  const placed = new Set();
  for (const r of list) {
    if (under(r)) {
      if (mains.has(r.g.repo) || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const top = mainTop(r.g.repo);
      out.push({
        ghost: true, i: r.i, tree: null,
        w: { id: `ghost:${r.g.repo}`, name: r.g.name, folder: top, machine: r.w.machine ?? null, status: null, tabs: [] },
        g: { ...r.g, linked: false, branch: null, ahead: 0, behind: 0, dirty: 0, top },
        first: r.w.id,
      });
      out.push(...kids(r.g.repo));
      continue;
    }
    out.push({ ...r, tree: null });
    if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
    placed.add(r.g.repo);
    out.push(...kids(r.g.repo));
  }
  return out;
}

/** Rows (parents followed by their tree children) -> blocks that start at a top-level row. */
export function toBlocks(rows) {
  const blocks = [];
  for (const r of rows) {
    if (r.tree && blocks.length) blocks[blocks.length - 1].push(r);
    else blocks.push([r]);
  }
  return blocks;
}

/**
 * Sections in display order: pinned, then spaces with no folder, then your folders in the
 * order you made them (empty ones too, so you can drop into them), then the rest as first seen.
 * @returns {{ name: string | null, kind: "pinned" | "loose" | "manual" | "auto", rows: Row[], tops: Row[] }[]}
 */
export function sections(rows, { manual = {}, pinned = [], order = [], nameOf }) {
  const pins = new Set(pinned);
  const out = [{ name: null, kind: "pinned", rows: [], tops: [] }, { name: null, kind: "loose", rows: [], tops: [] }];
  for (const name of Object.keys(manual)) out.push({ name, kind: "manual", rows: [], tops: [] });
  for (const b of toBlocks(rows)) {
    const top = b[0];
    let sec;
    if (pins.has(memberKey(top))) sec = out[0];
    else {
      const name = nameOf(top);
      sec = name === null ? out[1] : out.find((s) => s.name === name);
      if (!sec) out.push((sec = { name, kind: "auto", rows: [], tops: [] }));
    }
    sec.rows.push(...b);
    sec.tops.push(top);
  }
  const kept = out.filter((s) => s.rows.length || s.kind === "manual");
  return order?.length ? sortFolders(kept, order) : kept;
}

/** Named sections in the order you set; ones you never placed keep their place after those. */
export function sortFolders(secs, order) {
  const rank = (s) => (s.name === null ? -1 : order.indexOf(s.name) === -1 ? order.length : order.indexOf(s.name));
  return secs.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map((x) => x.s);
}

/** Put folder `name` right before `before` (or last with null). Returns the full new order. */
export function moveFolder(names, name, before) {
  const list = names.filter((n) => n !== name);
  const at = before === null ? list.length : list.indexOf(before);
  list.splice(at === -1 ? list.length : at, 0, name);
  return list;
}

/** One step up (-1) or down (+1). */
export function stepFolder(names, name, dir) {
  const i = names.indexOf(name);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= names.length) return names;
  const list = [...names];
  [list[i], list[j]] = [list[j], list[i]];
  return list;
}

/** The order spaces should have so Cmd+1..9 follows what the sidebar shows. */
export function arrange(rows, opts) {
  return sections(rows, opts).flatMap((s) => s.rows);
}

/** Headers only help when there is more than one group to tell apart. */
export function needsHeaders(secs) {
  const named = secs.filter((s) => s.name !== null);
  return named.some((s) => s.kind === "manual") || named.length > 1;
}

/** Toggle a folder; `solo` keeps only this one open. */
export function toggleFold(folded, name, all, solo) {
  if (solo) return all.filter((n) => n !== name);
  const set = new Set(folded);
  set.has(name) ? set.delete(name) : set.add(name);
  return [...set];
}

/** Move a member into a folder (or out of every folder with `to` null). Pure: returns a new map. */
export function assign(manual, key, to) {
  const next = {};
  for (const [name, f] of Object.entries(manual ?? {})) next[name] = { ...f, members: (f.members ?? []).filter((m) => m !== key) };
  if (to !== null && to !== undefined) {
    next[to] ??= { members: [] };
    next[to].members.push(key);
  }
  return next;
}

export function renameFolder(manual, from, to) {
  if (!to || from === to || manual?.[to]) return manual;
  return Object.fromEntries(Object.entries(manual ?? {}).map(([n, f]) => [n === from ? to : n, f]));
}

// ---------------------------------------------------------------- status

/** Agent attention in a set of rows. */
export function summarize(rows) {
  const s = { blocked: 0, done: 0, working: 0 };
  for (const r of rows) if (r.w.status in s) s[r.w.status]++;
  return s;
}

/** The status that deserves the dot: blocked beats done beats working. */
export function topStatus(sum) {
  return sum.blocked ? "blocked" : sum.done ? "done" : sum.working ? "working" : null;
}

/** Distinct pictures of a folder's spaces, for the stack shown when it is shut. */
export function stackOf(tops, iconOf, limit = 4) {
  return [...new Set(tops.map(iconOf).filter(Boolean))].slice(0, limit);
}

// ---------------------------------------------------------------- git

/** Changed or untracked paths in `git status --porcelain=v2` output. */
export function countDirty(porcelain) {
  let n = 0;
  for (const line of String(porcelain ?? "").split("\n")) if (/^[12u?] /.test(line)) n++;
  return n;
}

/** `gh pr view --json number,state,isDraft,url` -> what the chip shows. */
export function parsePr(json) {
  try {
    const p = typeof json === "string" ? JSON.parse(json) : json;
    if (!p || !Number.isInteger(p.number)) return null;
    const state = p.state === "MERGED" ? "merged" : p.state === "CLOSED" ? "closed" : p.isDraft ? "draft" : "open";
    // Only a web page: the chip hands this to `open`, which would also launch a file:// app.
    return { number: p.number, state, url: typeof p.url === "string" && /^https:\/\//.test(p.url) ? p.url : null };
  } catch {
    return null;
  }
}

/** Branches that never get a PR chip. */
export function isTrunk(branch) {
  return !branch || ["main", "master", "trunk", "develop", "dev", "(detached)"].includes(branch);
}

// ---------------------------------------------------------------- lines under a space

/** "now", "40s", "12m", "3h", "2d". */
export function ago(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.floor(ms / 1000);
  if (s < 10) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/** An agent's terminal title without the spinner glyphs agents put in front. */
export function agentTitle(a) {
  const raw = String(a?.title ?? "").replace(/^[\s⠀-⣿✳✱✻✢·*•✳✶✻✽·⠂⠐]+/u, "").trim();
  return raw || a?.tab_name || a?.program?.name || a?.address || "agent";
}

/** A running program: its name, and the title when it says more (`vite` · "localhost:5173"). */
export function programTitle(p) {
  const name = p?.program?.name ?? "program";
  const title = String(p?.title ?? "").trim();
  return title && title.toLowerCase() !== name.toLowerCase() ? `${name} · ${title}` : name;
}

// ---------------------------------------------------------------- folder labels

/** A folder label from a GitHub `users/<login>` answer: the display name when it is short, else the login. */
export function labelFrom(api, login) {
  const name = typeof api?.name === "string" ? api.name.trim() : "";
  return name && name.length <= 24 ? name : login;
}

/** What a folder header says: your name for it, else the fetched label, else its key. */
export function folderLabel(key, { renamed = {}, labels = {} } = {}) {
  return renamed[key] ?? labels[key] ?? key;
}

/**
 * A space dropped among another folder's spaces joins that folder. `to` null means "no folder".
 * Returns the new { manual, loose } to store.
 */
export function moveToFolder({ manual = {}, loose = [] }, key, to) {
  const out = { manual: assign(manual, key, to), loose: loose.filter((k) => k !== key) };
  if (to === null) out.loose.push(key);
  return out;
}

/** Folder colors: yours if set, else each folder's own hue, nudged so no two folders share one. */
export function folderColors(names, overrides = {}) {
  const out = {};
  const used = new Set(names.map((n) => overrides[n]).filter(Boolean));
  for (const n of names) {
    if (overrides[n]) { out[n] = overrides[n]; continue; }
    let i = PALETTE.indexOf(hashColor(n));
    for (let k = 0; k < PALETTE.length && used.has(PALETTE[i]); k++) i = (i + 1) % PALETTE.length;
    out[n] = PALETTE[i];
    used.add(PALETTE[i]);
  }
  return out;
}
