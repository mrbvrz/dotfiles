// Nightfall's spaces: unified project folder view with agents tree directly underneath each space card.
// Each project is a card with its avatar, branch, uncommitted changes, and toggleable worktrees and agents tree.
// Agents of each space are rendered directly underneath with their status, runtime, and sub-agents.
// Corners are 4 px.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { spaces, machines, panes, agents, terminals, run, openOverlay, closeOverlay, props, exec, hc, theme, shared, setShared, watchFolder, window, layout, settings } from "herdr";

const ICONS = "mods/nightfall-chrome";
const R = 4;
const MONO = "Geist Mono";
const uiSize = () => Number(settings()?.ui_font_size) || 14;
const bright = (t) => (settings()?.dark === false ? t.foreground : t.ansi15);
const PINS = "nightfall.spaces.pinned";
// { space, panel, at }: nightfall-tabs shows that panel when that space comes into view.
const OPEN_PANEL = "nightfall.panel.open";
// Herdr's spaces mod and picker read the same key, and take a #rrggbb as it is.
const COLORS = "space.colors";
// { [space id]: { add, del } }: the lines a space's uncommitted changes add and remove
// (git diff HEAD --numstat, as nightfall-changes counts them), for nightfall-tabs' Changes button.
const LINES = "nightfall.changes.lines";

// Agent state, the same table in every Nightfall mod: its theme color, the color of
// its time on a card, and how that time reads.
const STATES = {
  blocked: { color: "blocked", tone: "blocked", since: (m) => `waiting ${m}` },
  working: { color: "working", tone: "dim", since: (m) => `working ${m}` },
  done: { color: "done", tone: "done", since: (m) => `done ${m} ago` },
  idle: { color: "idle", tone: "dim", since: null },
};
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

const kidStatus = (k, listed) => {
  const s = listed?.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};

// The one state mark: a dot (blocked, done), a turning arc (working), a ring (idle).
function dot(t, st, size = 9, spin = size + 2) {
  const color = t[STATES[st]?.color] ?? t.dim;
  if (st === "working") return svg(`${ICONS}/dot-spin.svg`).size(spin).flex_none().text_color(color).spin(900);
  if (st === "idle") return div().size(size).flex_none().rounded_full().border(1.5).border_color(color);
  return st ? div().size(size).flex_none().rounded_full().bg(color) : null;
}

// The lists' scrollbar, always there, at 45% until the pointer is over the list
// (`lit`). The theme draws it 6 px wide at the list's edge whatever box holds it
// (measured); the box only carries the opacity. Same in nightfall-agents.
const thinBar = (id, lit) => div().absolute().top(2).bottom(2).right(1).w(3).opacity(lit ? 1 : 0.45)
  .child(Scrollbar.vertical(id).mode("always").size_full());

const elapsed = (ms) => {
  const m = Math.floor(ms / 60000);
  return m < 1 ? "<1 min" : m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`;
};

// Two letters: the first two words' initials, or one word's first letter and the
// first consonant after it (notes: NT, dashboard: DS).
function initials(name) {
  const words = (name ?? "").split(/[-_.\s]+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0];
  const c = w.slice(1).match(/[bcdfghjklmnpqrstvwxz]/i);
  return (w[0] + (c ? c[0] : w[1] ?? "")).toUpperCase();
}

// 12 powdery colors from Sanzo Wada's A Dictionary of Color Combinations, in the order
// spaces take them: each next one the farthest in hue from those before it.
const PALETTE = ["#dda8c8", "#78b79e", "#d6a582", "#a5ae77", "#aa9fd3", "#8fc7c6", "#b39fbf", "#bab37c", "#95c9a4", "#caa1cc", "#78c1b6", "#e4ac92"];
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (a) => "#" + a.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const lighten = (hex, k) => toHex(rgb(hex).map((c) => c + (255 - c) * k));
const mix = (hex, a, base) => { const b = rgb(base); return toHex(rgb(hex).map((c, i) => c * a + b[i] * (1 - a))); };
// OKLCH hue, in degrees.
function hue(hex) {
  const [r, g, b] = rgb(hex).map((u) => { u /= 255; return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return (Math.atan2(B, A) * 180 / Math.PI + 360) % 360;
}
const HUE = Object.fromEntries(PALETTE.map((c) => [c, hue(c)]));
const hueGap = (a, b) => { const d = Math.abs(HUE[a] - HUE[b]) % 360; return d > 180 ? 360 - d : d; };

// Each open space keeps its palette color unless another open space had it first;
// the rest take, in order, the free color farthest in hue from those in use (past 12,
// the least used). Old theme names (ansi6…) and closed spaces drop out.
function assignColors(ids, saved) {
  const out = {};
  for (const id of ids) if (PALETTE.includes(saved?.[id]) && !Object.values(out).includes(saved[id])) out[id] = saved[id];
  for (const id of ids) {
    if (out[id]) continue;
    const used = Object.values(out);
    const uses = (c) => used.filter((u) => u === c).length;
    const least = Math.min(...PALETTE.map(uses));
    const far = (c) => (used.length ? Math.min(...used.map((u) => hueGap(c, u))) : 0);
    out[id] = PALETTE.filter((c) => uses(c) === least).reduce((best, c) => (far(c) > far(best) ? c : best));
  }
  return out;
}

const colorOf = (id, t) => {
  const c = (shared(COLORS) ?? {})[id];
  const hex = typeof c === "string" && c.startsWith("#") ? c : t[c] ?? t.dim;
  return /^#[0-9a-f]{6}/i.test(hex) ? hex.slice(0, 7) : "#8f8f8f";
};

// The space's avatar: its letters in its color lightened 12% on that color at 16% over
// `under` (what the avatar sits on, which the seal's 2 px cut-out takes too), and the
// state dot 3 px out of its corner. Idle and no agent: no dot. `pin`: an element for
// the top left corner.
// On the shown space (inverted: the card is the text color) the tile is the space's color,
// solid, with its letters in the card's old fill.
function avatar(t, name, color, size, under, st, pin = null, inverted = false) {
  const k = size / 28;
  const d = Math.round(11 * k), off = Math.round(3 * k);
  const font = Math.round(11.5 * k * 2) / 2;
  return h_flex().relative().size(size).flex_none().rounded(Math.round(6 * k)).bg(inverted ? color : mix(color, 0.16, under)).items_center().justify_center()
    // A line box as tall as the font: centered, it puts the capitals in the middle
    // (measured: 10 px above and 9 below in 28; the 16 px line box left them 1 px high).
    .child(div().line_height(`${font}px`).text_size(font).font_weight(600).text_color(inverted ? t.chrome : lighten(color, 0.12)).child(initials(name)))
    .when(Boolean(st) && st !== "idle", (el) => el.child(h_flex().absolute().right(-off - 2).bottom(-off - 2).size(d + 4).rounded_full().bg(under).items_center().justify_center()
      .child(dot(t, st, d, d))))
    .when(Boolean(pin), (el) => el.child(pin));
}

// The pin on an avatar's top left corner, half out, no fill: white at 80% on a pinned
// space, at 50% on another under the pointer.
const PIN = 12;
const pinInk = (t, pinned) => bright(t).slice(0, 7) + (pinned ? "cc" : "80");

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();

// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;
// Row heights in the list, each with the space under it.
const H = { card: 61, tree: 28, treesEnd: 4, machine: 26, line: 28, top: 6, bottom: 10, agent: 28, subAgent: 26 };

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

// How long the space has been in its state, as its card says it; null when idle or unknown.
function sinceLabel(w, now) {
  const st = w.status, say = STATES[st]?.since;
  if (!say) return null;
  const tabs = (w.tabs ?? []).filter((c) => c.status === st);
  const times = tabs.map((c) => (st === "working" ? c.working_since : c.changed_at)).filter((x) => typeof x === "number");
  if (!times.length) return null;
  // Waiting and working: since the longest; done: since the latest.
  const at = st === "done" ? Math.max(...times) : Math.min(...times);
  return { st, text: say(elapsed(now - at)) };
}

export default class Spaces extends View {
  init(_props, cx) {
    if (props()?.agentMenu) return;
    this.git = {}; // where() -> { name, branch, ahead, behind, add, del, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    // Repos (git.repo) whose worktrees are open under their card.
    this.open = new Set(JSON.parse(localStorage.getItem("worktrees.open") ?? "[]"));
    this.closedAgents = new Set(JSON.parse(localStorage.getItem("spaces.agents.closed") ?? "[]"));
    this.foldedSubs = new Set();
    this.agentChanged = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
    // The cards' "waiting 14 min" counts in minutes.
    cx.timer.every(60000, (cx) => cx.notify());
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id))) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.publishLines();
      this.refreshing = false;
      cx.notify();
    });
  }

  // Each space's lines, written only when they changed. No spaces is herdr-app check's
  // empty run against the real shared state: nothing then.
  publishLines() {
    const sp = spaces(), ps = panes();
    if (!sp.length) return;
    const lines = {};
    for (const s of sp) {
      const g = this.git[where(s, ps)];
      if (g && (g.add || g.del)) lines[s.id] = { add: g.add, del: g.del };
    }
    if (JSON.stringify(lines) !== JSON.stringify(shared(LINES) ?? {})) setShared(LINES, lines);
  }

  // One place's git: branch, ahead/behind, lines changed, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, branch: null, ahead: 0, behind: 0, add: 0, del: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${top.stdout.trim()}/.git` };
      let dirty = false, initial = false;
      for (const line of r.stdout.split("\n")) {
        if (line && !line.startsWith("#")) dirty = true;
        else if (line === "# branch.oid (initial)") initial = true;
        else if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      // nightfall-changes' numbers: tracked files against HEAD (before the first commit,
      // staged plus unstaged); new files git doesn't track yet add nothing.
      if (dirty) {
        const diff = (args) => exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false", diff, ...args, "--numstat", "-z", "--no-renames"], { cwd, on });
        for (const d of await Promise.all(initial ? [diff(["--cached"]), diff([])] : [diff(["HEAD"])])) {
          if (d.code !== 0) continue;
          for (const entry of d.stdout.split("\0")) {
            const [a, del, ...path] = entry.split("\t");
            if (!path.length) continue;
            info.add += Number(a) || 0;
            info.del += Number(del) || 0;
          }
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  // An agent row's right-click menu.
  agentMenu(t) {
    const { tab } = props().agentMenu;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(h_flex()
        .id("agent-rename")
        .h(31)
        .px(8)
        .gap(9)
        .rounded(R)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          closeOverlay(props().overlay);
          run("tab.rename", { id: tab });
        })
        .child(svg(`${ICONS}/square-pen.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child("Rename")));
  }

  // Spaces in order as groups: a card, and under a repo's first card the worktree
  // spaces of that repo. Pinned groups first, in their order.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null, known: where(w, ps) in this.git })).filter((r) => this.shown.has(r.w.id));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const groups = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      const owns = Boolean(r.g) && !r.g.linked && !placed.has(r.g.repo);
      if (owns) placed.add(r.g.repo);
      groups.push({ head: r, trees: owns ? list.filter((k) => nested(k) && k.g.repo === r.g.repo) : [] });
    }
    const pins = this.pins();
    const pinned = (b) => pins.includes(b.head.w.id);
    return [...groups.filter(pinned), ...groups.filter((b) => !pinned(b))];
  }

  toggleTrees(repo) {
    this.open.has(repo) ? this.open.delete(repo) : this.open.add(repo);
    localStorage.setItem("worktrees.open", JSON.stringify([...this.open]));
  }

  toggleAgents(spaceId) {
    this.closedAgents.has(spaceId) ? this.closedAgents.delete(spaceId) : this.closedAgents.add(spaceId);
    localStorage.setItem("spaces.agents.closed", JSON.stringify([...this.closedAgents]));
  }

  pins() {
    const p = shared(PINS);
    return Array.isArray(p) ? p : [];
  }

  togglePin(id) {
    const pins = this.pins();
    setShared(PINS, pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id]);
  }

  since(a) {
    return this.agentChanged[a.address]?.at ?? 0;
  }

  trackAgents(list, now) {
    for (const a of list) {
      const was = this.agentChanged[a.address];
      if (!was || was.status !== a.status) this.agentChanged[a.address] = { status: a.status, at: now };
    }
    localStorage.setItem("changed", JSON.stringify(this.agentChanged));
  }

  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  // The list as rows of known height, { key, h, el }, under a header per machine once
  // one isn't this computer. The heights add up to the block's height (D2).
  rows(t) {
    const groups = this.ordered();
    const ps = panes();
    const allAgents = agents();
    const allTerms = terminals();
    this.agentListed = new Map(allAgents.map((a) => [a.address, a.status]));
    const now = Date.now();
    this.trackAgents(allAgents, now);

    const draw = (b) => {
      const { head, trees } = b;
      const myAgents = allAgents.filter((a) => a.space === head.w.id);
      const agentsOpen = myAgents.length > 0 && !this.closedAgents.has(head.w.id);
      const treesOpen = trees.length > 0 && this.open.has(head.g?.repo);
      const out = [{ key: `card-${head.w.id}`, h: H.card, el: () => this.card(head, t, ps, trees, treesOpen, myAgents, agentsOpen, now) }];

      if (agentsOpen) {
        for (let i = 0; i < myAgents.length; i++) {
          const a = myAgents[i];
          const subs = this.tree(allTerms, a.address);
          const isLastAgent = i === myAgents.length - 1 && (!treesOpen || trees.length === 0);
          out.push({ key: `ag-${a.address}`, h: H.agent, el: () => this.agentRow(a, t, now, isLastAgent, subs.length) });
          if (!this.foldedSubs.has(a.address)) {
            for (const s of subs) {
              out.push({ key: `sub-${s.t.address}`, h: H.subAgent, el: () => this.subRow(s, t) });
            }
          }
        }
      }

      if (treesOpen) {
        for (const r of trees) out.push({ key: `tree-${r.w.id}`, h: H.tree, el: () => this.worktree(r, t) });
        out.push({ key: `trees-end-${head.w.id}`, h: H.treesEnd, el: () => div() });
      }
      return out;
    };

    const remote = [...new Set([...groups.map(b => b.head.w.machine).filter(Boolean), ...this.machines.map(m => m.name)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => ({ key: `loading-${m ?? "local"}`, h: H.line, el: () => div().h(28).px(16).flex().items_center().text_size(12).text_color(t.dim).child("Loading…") });
    let body;
    if (!remote.length) body = loading(null) && !groups.length ? [loadingRow(null)] : groups.flatMap(draw);
    else body = [null, ...remote].flatMap((m) => {
      const mine = groups.filter((b) => (b.head.w.machine ?? null) === m);
      const folded = this.folded.has(m);
      const head = { key: `machine-${m ?? "local"}`, h: H.machine, el: () => this.machineHead(m, t, folded) };
      const empty = { key: `machine-empty-${m ?? "local"}`, h: H.line, el: () => h_flex().id(`machine-new-${m ?? "local"}`).h(28).mx(8).px(8).gap(7).items_center().rounded(R)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", m ? { machine: m } : {}))
        .child(svg(`${ICONS}/plus.svg`).size(12)).child("New space there") };
      return [head, ...(folded ? [] : mine.length ? mine.flatMap(draw) : [loading(m) ? loadingRow(m) : empty])];
    });
    return [{ key: "top", h: H.top, el: () => div() }, ...body, { key: "bottom", h: H.bottom, el: () => div() }];
  }

  machineHead(m, t, folded) {
    const machine = this.machines.find(k => k.name === m);
    const connected = !m || machine?.state === "connected";
    return h_flex().id(`machine-${m ?? "local"}`).h(26).mx(8).px(8).gap(7).items_center().text_size(11).text_color(t.dim)
      .cursor_pointer().hover(s => s.bg(t.hover))
      .on_click((_e, cx) => {
        folded ? this.folded.delete(m) : this.folded.add(m);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        cx.notify();
      })
      .child(svg(`${ICONS}/${m ? "server" : "monitor"}.svg`).size(13).flex_none())
      .child(div().flex_1().truncate().child(m ?? "This computer"))
      .when(!connected, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
      .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(R).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", m ? { machine: m } : {}); }).child("+")))
      .child(div().size(6).rounded_full().flex_none().bg(connected ? t.done : t.dim))
      .child(svg(`${ICONS}/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none());
  }

  // Ahead and behind in dim, only when there are any.
  counts(g, t, ink = t.dim) {
    if (!g) return [];
    const n = (text) => div().flex_none().text_size(11.5).text_color(ink).child(text);
    return [...(g.ahead > 0 ? [n(`↑${g.ahead}`)] : []), ...(g.behind > 0 ? [n(`↓${g.behind}`)] : [])];
  }

  // Line 2: the shown tab's name if someone named it, else what its agent calls itself.
  heading(w, ps) {
    const tab = (w.tabs ?? []).find((c) => c.active) ?? w.tabs?.[0];
    if (!tab) return "";
    if (tab.named) return tab.name;
    const mine = ps.filter((p) => p.tab === tab.id && p.terminal);
    const lead = mine.find((p) => p.program?.agent) ?? mine.find((p) => p.focused) ?? mine[0];
    const live = clean(lead?.title);
    const telling = live && live !== lead?.program?.name && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== lead?.program?.key;
    return telling ? live : lead?.program?.name || tab.name;
  }

  // ↑↓ as a button that opens the Changes panel on that space. It handles the mouse
  // itself: the card selects on mouse up.
  changesLink(w, g, t, ink) {
    const parts = this.counts(g, t, ink);
    if (!parts.length) return null;
    return h_flex().id(`changes-${w.id}`).flex_none().gap(6).px(3).mx(-3).rounded(R).items_center()
      .hover((s) => s.bg(t.input)).tooltip("Show changes")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_up("left", (_e, cx) => {
        cx.stop_propagation();
        this.openChanges(w);
      })
      .children(parts);
  }

  openChanges(w) {
    if (w.active) {
      run("layout.select", { stack: "panel-body", child: "changes" });
      run("layout.show", { id: "panel" });
      return;
    }
    setShared(OPEN_PANEL, { space: w.id, panel: "changes", at: Date.now() });
    run("space.select", { id: w.id });
  }

  press(w, i) {
    return (el) => el
      .when(this.pressed !== null && this.over === i && this.pressed !== i, (el) => el.border_t(2).border_color(theme().accent))
      .on_mouse_down("left", () => {
        this.pressed = i;
        this.over = i;
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        this.pressed = null;
        if (from !== null && from !== i) run("space.move", { id: spaces()[from].id, index: i + 1 });
        else run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .on_hover((on, cx) => {
        if (on) this.hovered = w.id;
        else if (this.hovered === w.id) this.hovered = null;
        cx.notify();
      });
  }

  // The branch with its icon in the space's color, in mono.
  branchTag(t, color, name, max = 120, ink = null) {
    return h_flex().flex_none().max_w(max).gap(4).items_center().text_color(ink ?? t.dim)
      .child(svg(`${ICONS}/git-branch.svg`).size(12).flex_none().text_color(ink ?? lighten(color, 0.12)))
      .child(div().min_w(0).truncate().font_family(MONO).text_size(11).child(name));
  }

  // The branch a card shows: git's, Herdr's until git answers, none outside a repo.
  branchOf({ w, g, known }) {
    if (g) return g.branch ?? "detached";
    return known ? null : w.branch;
  }

  // A worktree under its open repo: a 28 px line from the card's text column, with
  // its branch and its state.
  worktree({ w, i, g }, t) {
    const on = w.active, soft = t.dim;
    return h_flex().id(`space-${w.id}`).h(28).mx(8).pl(42).pr(10).gap(8).items_center().rounded(R).text_size(uiSize() - 1.5)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .map(this.press(w, i))
      .child(div().w(8).flex_none().self_stretch().flex().items_center().justify_center()
        .child(div().w(6).h(14).border_l(1.5).border_b(1.5).border_color(t.input).rounded_bl(R)))
      .child(svg(`${ICONS}/fork.svg`).size(12).flex_none().text_color(soft))
      .child(div().flex_1().min_w(0).truncate().text_color(on ? bright(t) : t.muted).child(w.name))
      .when(Boolean(g?.branch), (el) => el.child(div().flex_none().max_w(84).truncate().font_family(MONO).text_size(11).text_color(soft).child(g.branch)))
      .child(h_flex().w(16).flex_none().justify_center().child(dot(t, w.status ?? null, 9) ?? div()));
  }

  // Worktree button on line 2 of the space card
  wtButton(head, trees, open, t) {
    const label = `${trees.length} worktree${trees.length > 1 ? "s" : ""}`;
    const red = !open && trees.some((r) => r.w.status === "blocked");
    const hides = !open && trees.some((r) => r.w.active);
    return h_flex().id(`trees-button-${head.w.id}`).h(20).flex_none().px(6).gap(5).items_center().rounded(R)
      .text_color(red ? t.blocked : open || hides || head.w.active ? bright(t) : t.dim)
      .when(open, (el) => el.bg(t.input))
      .when(hides, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.input))
      .tooltip(open ? `Hide ${label}` : `Show ${label}`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_up("left", (_e, cx) => {
        cx.stop_propagation();
        this.toggleTrees(head.g?.repo);
        cx.notify();
      })
      .child(svg(`${ICONS}/fork.svg`).size(12).flex_none())
      .child(div().flex_none().font_family(MONO).text_size(11.5).child(String(trees.length)));
  }

  // Agent button on line 2 of the space card
  agentButton(head, myAgents, open, t) {
    const count = myAgents.length;
    const label = `${count} agent${count > 1 ? "s" : ""}`;
    const red = !open && myAgents.some((a) => a.status === "blocked");
    const working = !open && myAgents.some((a) => a.status === "working");
    const hides = !open && myAgents.some((a) => a.focused);
    return h_flex().id(`agents-button-${head.w.id}`).h(20).flex_none().px(6).gap(5).items_center().rounded(R)
      .text_color(red ? t.blocked : working ? t.working : open || hides || head.w.active ? bright(t) : t.dim)
      .when(open, (el) => el.bg(t.input))
      .when(hides, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.input))
      .tooltip(open ? `Hide ${label}` : `Show ${label}`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_up("left", (_e, cx) => {
        cx.stop_propagation();
        this.toggleAgents(head.w.id);
        cx.notify();
      })
      .child(svg(`${ICONS}/terminal.svg`).size(12).flex_none())
      .child(div().flex_none().font_family(MONO).text_size(11.5).child(String(count)))
      .child(svg(`${ICONS}/chevron-${open ? "down" : "right"}.svg`).size(10).flex_none().text_color(t.dim));
  }

  // An agent row rendered directly under its parent project/space card
  agentRow(a, t, now, isLast, subsCount = 0) {
    const on = a.focused;
    const pic = icon(a.program, 14, t.foreground) ?? svg(`${ICONS}/terminal.svg`).size(13).flex_none().text_color(on ? bright(t) : t.dim);
    const when = this.since(a);
    const idle = a.status === "idle" && !on;
    const name = a.title || a.program?.name || a.space_name || a.address;
    const subsOpen = !this.foldedSubs.has(a.address);

    return h_flex()
      .id(`ag-${a.address}`)
      .h(28)
      .mx(8)
      .pl(28)
      .pr(10)
      .gap(8)
      .items_center()
      .rounded(R)
      .text_size(uiSize() - 1.5)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .cursor_pointer()
      .on_click(() => run("pane.focus", { pane: a.pane }))
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        if (a.tab) openOverlay({ mod: "nightfall-spaces", kind: "popup", width: 180, height: 52, props: { agentMenu: { tab: a.tab } } });
      })
      .child(div().w(8).flex_none().self_stretch().flex().items_center().justify_center()
        .child(div().w(6).h(14).border_l(1.5).border_b(1.5).border_color(t.input).rounded_bl(R)))
      .child(div().flex_none().child(pic))
      .child(div().flex_1().min_w(0).truncate().text_color(on ? bright(t) : idle ? t.muted : t.foreground).child(name))
      .when(subsCount > 0, (el) => el.child(
        h_flex().id(`fold-${a.address}`).h(18).px(3).gap(2).items_center().rounded(R).text_size(10.5).text_color(t.dim)
          .hover((s) => s.bg(t.input).text_color(t.foreground))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            subsOpen ? this.foldedSubs.add(a.address) : this.foldedSubs.delete(a.address);
            cx.notify();
          })
          .child(svg(`${ICONS}/chevron-${subsOpen ? "down" : "right"}.svg`).size(10).flex_none())
          .child(String(subsCount))
      ))
      .when(Boolean(when), (el) => el.child(div().flex_none().font_family(MONO).text_size(11).text_color(t.dim).child(duration(now - when))))
      .child(h_flex().w(16).flex_none().justify_center().child(dot(t, a.status ?? null, 8) ?? div()));
  }

  // Sub-agent / terminal process row indented under agent
  subRow(s, t) {
    const k = s.t;
    const st = kidStatus(k, this.agentListed);
    const pic = icon(k.program, 12, t.foreground) ?? svg(`${ICONS}/terminal.svg`).size(12).flex_none().text_color(t.dim);
    return h_flex()
      .id(`sub-${k.address}`)
      .h(26)
      .mx(8)
      .pl(46)
      .pr(10)
      .gap(6)
      .items_center()
      .rounded(R)
      .text_size(11.5)
      .hover((s) => s.bg(t.hover))
      .cursor_pointer()
      .on_click(() => run("terminal.peek", { terminal: k.address }))
      .children(s.lines.map((l) => div().self_start().mt(-3).w(8).h(16).mr(2).flex_none()
        .when(Boolean(l), (el) => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", (el) => el.border_b(1.5).rounded_bl(R))))
      .child(div().flex_none().child(pic))
      .child(div().flex_1().truncate().text_color(t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(h_flex().w(16).flex_none().justify_center().child(dot(t, st, 7) ?? div()));
  }

  // A11: avatar, then two lines. Line 1: name, pin, and the branch, or how long the
  // space has been in its state (the branch then moves to line 2). Line 2: the title,
  // ↑↓, agent chip, and the worktree button.
  card(head, t, ps, trees, open, myAgents, agentsOpen, now) {
    const { w, i } = head;
    const on = w.active;
    const color = colorOf(w.id, t);
    const pinned = this.pins().includes(w.id);
    const hovered = this.hovered === w.id;
    // The shown space: the selected fill (as the focused agent's row), bright text, and a
    // solid avatar tile.
    const under = on ? t.selected : hovered ? t.hover : t.chrome;
    const ink = bright(t), soft = t.dim;
    const title = this.heading(w, ps);
    const quiet = !on && (!w.status || w.status === "idle");
    const branch = this.branchOf(head);
    const since = sinceLabel(w, now);
    // Hovering a pinned card turns its pin into pin-off: a click there unpins.
    const pin = div().id(`pin-${w.id}`).absolute().left(-PIN / 2).top(-PIN / 2).size(PIN)
      .text_color(pinInk(t, pinned))
      .hover((s) => s.text_color(bright(t)))
      .tooltip(pinned ? "Unpin" : "Pin to the top")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.togglePin(w.id);
        this.hovered = null;
        cx.notify();
      })
      .child(svg(`${ICONS}/${pinned && hovered ? "pin-off" : "pin"}.svg`).size(PIN));
    const card = h_flex().id(`space-${w.id}`).h(57).px(10).gap(12).items_center().rounded(R)
      .bg(under)
      .map(this.press(w, i))
      .child(avatar(t, w.name, color, 28, under, w.status, pinned || hovered ? pin : null, on || hovered))
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(h_flex().h(18).gap(8).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(uiSize() - 1.5).text_color(on ? ink : t.muted).child(w.name))
          .when(Boolean(since), (el) => el.child(div().flex_none().font_family(MONO).text_size(11).text_color(t[STATES[since.st].tone]).child(since.text)))
          .when(!since && Boolean(branch), (el) => el.child(this.branchTag(t, color, branch, 120, on ? soft : null))))
        .child(h_flex().h(20).gap(8).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(uiSize() - 0.5).font_weight(500).text_color(on ? ink : quiet ? t.muted : bright(t)).child(title || " "))
          .when(Boolean(since) && Boolean(branch), (el) => el.child(this.branchTag(t, color, branch, 90, on ? soft : null)))
          .children([this.changesLink(w, head.g, t, on ? soft : t.dim)].filter(Boolean))
          .when(myAgents.length > 0, (el) => el.child(this.agentButton(head, myAgents, agentsOpen, t)))
          .when(trees.length > 0, (el) => el.child(this.wtButton(head, trees, open, t)))));
    return div().h(61).px(8).pb(4).child(card);
  }

  // M1: the rail's avatars under the brand block, a + for a new space; the shown
  // space on the selected fill. A space's dot is its most urgent, its worktrees and agents too.
  rail(t) {
    const groups = this.ordered();
    const pins = this.pins();
    const allAgents = agents();
    const top = (b) => {
      const agentStatuses = allAgents.filter((a) => a.space === b.head.w.id).map((a) => a.status);
      return [b.head, ...b.trees].map((r) => r.w.status).concat(agentStatuses).reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
    };
    return v_flex().id("rail").size_full().min_h(0).bg(t.chrome).pt(8).pb(8).gap(4).items_center().overflow_y_scroll()
      .children(groups.map((b) => {
        const w = b.head.w, on = w.active || b.trees.some((r) => r.w.active);
        const under = on ? t.selected : this.hovered === w.id ? t.hover : t.chrome;
        return h_flex().id(`rail-${w.id}`).size(36).flex_none().rounded(6).items_center().justify_center().bg(under)
          .tooltip(w.name)
          .on_hover((over, cx) => { if (over) this.hovered = w.id; else if (this.hovered === w.id) this.hovered = null; cx.notify(); })
          .on_click(() => run("space.select", { id: w.id }))
          .on_mouse_down("right", () => this.menu(w))
          .child(avatar(t, w.name, colorOf(w.id, t), 28, under, top(b), pins.includes(w.id)
            ? div().absolute().left(-PIN / 2).top(-PIN / 2).size(PIN).text_color(pinInk(t, true)).child(svg(`${ICONS}/pin.svg`).size(PIN))
            : null, on || this.hovered === w.id));
      }))
      .child(div().id("rail-new").size(28).flex_none().flex().items_center().justify_center().rounded(R).text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(bright(t))).tooltip("New space")
        .on_click(() => run("space.new"))
        .child(svg(`${ICONS}/plus.svg`).size(14)));
  }

  // Keeps every open space on a palette color (see assignColors). No spaces at all is
  // herdr-app check's empty run, which writes the real shared state: nothing then.
  syncColors(sp) {
    if (!sp.length) return;
    const saved = shared(COLORS) ?? {};
    const ids = sp.map((s) => s.id);
    const next = assignColors(ids, saved);
    if (ids.some((id) => next[id] !== saved[id]) || Object.keys(saved).length !== ids.length) setShared(COLORS, next);
  }

  render() {
    const t = theme();
    if (props()?.agentMenu) return this.agentMenu(t);
    this.syncColors(spaces());
    if (narrow()) return this.rail(t);
    const rows = this.rows(t);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(uiSize())
      .child(v_flex().id("spaces-box").relative().flex_1().min_h(0)
        .on_hover((on, cx) => { this.lit = on; cx.notify(); })
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .child(v_flex().id("spaces-list").size_full().overflow_y_scroll()
          .children(rows.map((row) => div().flex_none().h(row.h).child(row.el()))))
        .child(thinBar("spaces-list", this.lit)));
  }
}
