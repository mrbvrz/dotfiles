// Workspace spaces: stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind. Agent state lives in the agents list, not here. Click to
// switch, right-click for its menu, drag to reorder.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, agents, run, openOverlay, props, exec, hc, theme, shared, setShared, watchFolder, window, layout, appHome, readTextFile } from "herdr";
import * as C from "./crest.js";
import * as U from "./ui.js";
import { Menu } from "./menu.js";

const CACHE = "crest-cache"; // under the Herdr home, where image() can read
const PR_TTL = 5 * 60 * 1000;

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
const rowHeight = ({ tree }) => (tree ? 28 : 30);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

// Same repo, same color: hash the repo (or the space) into a soft palette.

export default class Spaces extends View {
  init(_props, cx) {
    // Opened as crest's own right-click menu: draw only that.
    if (props()?.crestMenu) { this.popup = new Menu(cx); return; }
    // Optional ~/.config/herdr-app/crest.json (see README). Read once per layout load.
    this.cfg = C.normalizeConfig(null);
    (async () => {
      const raw = (await readTextFile(`${appHome()}/crest.json`).catch(() => null)) ?? (await readTextFile(`${appHome()}/spaces-pretty.json`).catch(() => null));
      try { this.cfg = C.normalizeConfig(JSON.parse(raw ?? "null")); } catch { /* keep defaults */ }
      cx.notify();
    })();
    this.prs = {}; // where() -> { pr, at }
    this.icons = {}; // repo top -> project icon path under CACHE ("" when none)
    this.rowsById = {}; // space id -> its row, for drops on folder headers
    this.dropOver = null; // folder name under a dragged space
    this.folderDrag = null; // folder whose header is being dragged
    this.folderOver = null;
    this.folderMoved = false;
    this.skipClick = false;
    this.since = {}; // agent address -> { status, at }: how long it has been doing that
    this.hover = null; // "row:<id>", "folder:<name>" or "line:<id>": shows that thing's quick buttons
    exec("mkdir", ["-p", `${appHome()}/${CACHE}`]).catch(() => null);
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
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
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
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

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
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
      await this.refreshPrs(cx).catch(() => null);
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
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
      const info = { name, branch: null, ahead: 0, behind: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${top.stdout.trim()}/.git` };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      info.top = top.stdout.trim();
      info.dirty = C.countDirty(r.stdout);
      if (!on) await this.identify(info, cwd);
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
    const row = this.rowsById[w.id];
    const manual = shared("crest.folders") ?? {};
    const key = row ? C.memberKey(row) : null;
    const inFolder = row ? this.folderCtx().nameOf(row) : null;
    openOverlay({ mod: "crest", kind: "popup", width: 230, height: 420, props: {
      crestMenu: true, kind: "space", id: w.id, key, folder: inFolder ?? null, folders: Object.keys(manual),
      pinned: Boolean(key && (shared("crest.pinned") ?? []).includes(key)), git: row?.g ? (row.g.linked ? "linked" : "main") : null,
      hidden: (shared("crest.hidden") ?? []).length,
      allFolders: this.lastFolders ?? [],
    } });
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    // Keep each folder together so Cmd+1..9 follows what the sidebar shows.
    const out = C.arrange(C.nest(list), this.folderCtx());
    // Stand-in repo rows aren't spaces: they take no place in the space order.
    const real = out.filter(r => !r.ghost);
    // Simulate the batch so later indexes include earlier moves. An attempted
    // write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map(w => w.id);
    const target = real.map(r => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < real.length; i++) {
        const from = order.indexOf(real[i].w.id);
        if (from === i) continue;
        run("space.move", { id: real[i].w.id, index: i + 1 });
        moved.add(real[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    const vis = out.filter(r => r.ghost || this.shown.has(r.w.id));
    // A stand-in shows only while worktrees are listed under it.
    return vis.filter((r, n) => !r.ghost || Boolean(vis[n + 1]?.tree));
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed) {
    const rows = this.ordered();
    const draw = (r) => (collapsed ? this.compact(r, t) : this.block(r, t));
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => div().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(8).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : this.sectioned(rows, draw, t, collapsed);
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const folded = this.folded.has(m);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 2 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none())
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected && !rebuilt, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .child(svg("mods/workspace-chrome/plus.svg").size(12)).when(!collapsed, el => el.child("New space there"));
      if (!collapsed && rebuilt) return [head];
      return [head, ...(folded ? [] : mine.length ? this.sectioned(mine, draw, t, collapsed) : [loading(m) ? loadingRow(m) : empty])];
    });
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one.
  // A space row and, under it, what is running there: agents that need a look or are busy, and programs.
  block(r, t) {
    if (r.ghost) return this.ghostRow(r, t);
    const lines = this.subLines(r.w, t);
    if (!lines.length) return this.row(r, t);
    return v_flex().flex_none().child(this.row(r, t)).children(lines);
  }

  subLines(w, t) {
    const mode = this.cfg.agents;
    if (mode === "none") return [];
    const tabs = new Set((w.tabs ?? []).map((x) => x.id));
    const now = Date.now();
    const list = agents().filter((a) => a.space === w.id && (mode === "all" || a.status !== "idle"));
    const progs = this.cfg.programs ? panes().filter((p) => tabs.has(p.tab) && p.terminal && !p.program?.shell && !p.program?.agent && p.program?.key !== "program") : [];
    const items = [
      ...list.map((a) => ({ id: `crest-a-${a.address}`, program: a.program, text: C.agentTitle(a), status: a.status, age: C.ago(now - this.age(a, now)), pane: a.pane, go: () => run("pane.focus", { pane: a.pane }) })),
      ...progs.map((p) => ({ id: `crest-p-${p.pane}`, program: p.program, text: p.program?.name ?? "program", status: null, age: "", pane: p.pane, go: () => run("pane.focus", { pane: p.pane }) })),
    ];
    return items.map((it, i) => U.subLine({
      t, ...it, last: i === items.length - 1,
      hovered: this.hover === `line:${it.id}`,
      onHover: (on, cx) => this.setHover(`line:${it.id}`, on, cx),
      armed: this.armed?.id === it.id && Date.now() - this.armed.at < 3000,
      onClose: it.pane ? (_e, cx) => {
        // The first click arms, a second one within 3 s closes: an agent's work is easy to lose.
        if (this.armed?.id === it.id && Date.now() - this.armed.at < 3000) { this.armed = null; run("pane.close", { pane: it.pane }); }
        else { this.armed = { id: it.id, at: Date.now() }; cx.timer.after(3100, (cx) => cx.notify()); }
        cx.notify();
      } : null,
      onClick: (_e, cx) => { run("space.select", { id: w.id }); it.go(); cx.notify(); },
    }));
  }

  age(a, now) {
    const s = this.since[a.address];
    if (!s || s.status !== a.status) this.since[a.address] = { status: a.status, at: now };
    return this.since[a.address].at;
  }

  // Who owns the repo and what it looks like: owner picture, project icon. Local only.
  async identify(info, cwd) {
    // Git changes come often; who owns a repo and what it looks like do not. Ask once per checkout every 10 minutes.
    const memo = (this.idents ??= {})[info.top];
    if (memo && Date.now() - memo.at < 10 * 60 * 1000) { Object.assign(info, memo.fields); return; }
    await this.identifyNow(info, cwd);
    this.idents[info.top] = { at: Date.now(), fields: { owner: info.owner, host: info.host, avatar: info.avatar, project: info.project, custom: info.custom } };
  }

  async identifyNow(info, cwd) {
    const rem = await exec("git", ["config", "--get", "remote.origin.url"], { cwd }).catch(() => null);
    const url = (rem?.stdout ?? "").trim();
    let hit = C.parseRemote(url);
    // An ssh host alias (git@github-work:o/r): ask ssh's config which host it is. Reads config only.
    const alias = C.sshAlias(url);
    if (alias) {
      const r = await exec("ssh", ["-G", "--", alias]).catch(() => null);
      const host = r?.code === 0 ? C.sshHostname(r.stdout) : null;
      // ssh lowercases the name: the same name back means no alias.
      if (host && host !== alias.toLowerCase()) hit = C.parseRemote(C.withHost(url, alias, host));
    }
    if (hit) {
      info.owner = hit.owner;
      info.host = hit.host;
      const key = C.avatarKey(hit.host, hit.owner);
      info.avatar = `${CACHE}/${key}.png`;
      await exec("sh", [`${appHome()}/mods/crest/fetch-avatar.sh`, hit.host, hit.owner]).catch(() => null);
      await this.label(hit.host, hit.owner);
    }
    if (this.cfg.icon === "auto" || this.cfg.icon === "project") info.project = await this.projectIcon(info.top);
    const custom = this.cfg.icons[info.name] ?? null;
    if (custom) info.custom = await this.copyIcon(custom, `c_${C.hashKey(custom)}`);
  }

  // A folder's automatic name: the owner's display name on GitHub (public API, once per owner).
  async label(host, owner) {
    const labels = shared("crest.labels") ?? {};
    if (host !== "github.com" || owner in labels || this.asked?.has(owner)) return;
    (this.asked ??= new Set()).add(owner);
    const r = await exec("curl", ["-fsSL", "-m", "8", "-H", "Accept: application/vnd.github+json", `https://api.github.com/users/${owner}`]).catch(() => null);
    if (!r || r.code !== 0) return;
    let api = null;
    try { api = JSON.parse(r.stdout); } catch { return; }
    setShared("crest.labels", { ...(shared("crest.labels") ?? {}), [owner]: C.labelFrom(api, owner) });
  }

  async projectIcon(top) {
    if (!top) return null;
    if (top in this.icons) return this.icons[top] || null;
    const ls = await exec("git", ["-C", top, "ls-files", "--", "*favicon.svg", "*favicon.png", "*apple-touch-icon.png", "*icon.svg", "*icon.png", "*logo.svg", "*logo.png", ".crest.*"]).catch(() => null);
    const pick = C.pickIcon((ls?.stdout ?? "").split("\n").filter(Boolean));
    this.icons[top] = pick ? (await this.copyIcon(`${top}/${pick}`, `p_${C.hashKey(top)}`)) ?? "" : "";
    return this.icons[top] || null;
  }

  // image() reads only under the Herdr home, so pictures are copied into the cache.
  async copyIcon(path, stem) {
    const ext = (path.match(/\.(png|svg|jpe?g)$/i)?.[1] ?? "png").toLowerCase();
    const rel = `${CACHE}/${stem}.${ext}`;
    const r = await exec("cp", ["-f", path, `${appHome()}/${rel}`]).catch(() => null);
    return r && r.code === 0 ? rel : null;
  }

  // Pull request chips: one `gh` call per branch, at most every few minutes.
  async refreshPrs(cx) {
    if (!this.cfg.pr) return;
    const now = Date.now();
    for (const [key, g] of Object.entries(this.git)) {
      const [on, cwd] = JSON.parse(key);
      if (!g || on || g.host !== "github.com" || C.isTrunk(g.branch)) continue;
      const seen = this.prs[key];
      if (seen && seen.branch === g.branch && now - seen.at < PR_TTL) continue;
      this.prs[key] = { branch: g.branch, at: now, pr: seen?.branch === g.branch ? seen.pr : null };
      // Through direnv when present, so the repo's .envrc picks the gh account
      // (GH_CONFIG_DIR); exec has no env option. Plain gh if that fails.
      if (this.direnv === undefined) this.direnv = (await exec("/bin/sh", ["-c", "command -v direnv"]).catch(() => null))?.code === 0;
      const view = ["pr", "view", "--json", "number,state,isDraft,url"];
      let r = this.direnv ? await exec("direnv", ["exec", cwd, "gh", ...view], { cwd }).catch(() => null) : null;
      // gh's own "no PR for this branch" is an answer: asking again would only double the API calls.
      if (!r || (r.code !== 0 && !C.noPr(r.stderr))) r = await exec("gh", view, { cwd }).catch(() => null);
      this.prs[key].pr = r && r.code === 0 ? C.parsePr(r.stdout) : null;
      cx.notify();
    }
  }

  iconFor(g) {
    if (!g) return null;
    return C.chooseIcon(this.cfg.icon, { custom: g.custom ?? null, project: g.project ?? null, owner: g.avatar ?? null });
  }

  setHover(key, on, cx) {
    const next = on ? key : this.hover === key ? null : this.hover;
    if (next !== this.hover) { this.hover = next; cx.notify(); }
  }

  // A space made from a folder's "New space here": put it in that folder once its git is known.
  claimPending(rows) {
    const p = shared("crest.pending");
    if (!p) return;
    if (p.at && Date.now() - p.at > 2 * 60 * 1000) { setShared("crest.pending", null); return; }
    const row = rows.find((r) => !r.tree && (r.w.folder === p.folder || r.g?.top === p.folder));
    if (row && row.g) { this.joinFolder(row, p.to); setShared("crest.pending", null); }
  }

  quickNew(w) {
    const row = this.rowsById[w.id];
    openOverlay({ mod: "crest", kind: "popup", width: 230, height: 340, props: { crestMenu: true, kind: "new", id: w.id, spaceName: w.name, machine: w.machine ?? null, git: Boolean(row?.g) } });
  }

  quickAdd(sec, label, secs) {
    const cands = secs.filter((x) => x.name !== sec.name).flatMap((x) => x.tops).map((r) => {
      const colors = shared("space.colors") ?? {};
      const fill = String(colors[r.w.id] ?? "").startsWith("#") ? colors[r.w.id] : C.hashColor(r.g?.repo ?? r.w.folder ?? r.w.id);
      return { key: C.memberKey(r), name: r.w.name, icon: this.iconFor(r.g), letter: C.initial(r.w.name), fill };
    });
    openOverlay({ mod: "crest", kind: "popup", width: 260, height: 420, props: { crestMenu: true, kind: "add", name: sec.name, label, candidates: cands } });
  }

  endDrags(cx) {
    if (this.pressed === null && this.folderDrag === null && this.dropOver === null) return;
    this.pressed = null; this.over = null; this.dropOver = null;
    this.folderDrag = null; this.folderMoved = false; this.folderOver = null;
    cx.notify();
  }

  // Put a space (and its worktrees) into a folder, or out of every folder with null.
  joinFolder(row, to) {
    const next = C.moveToFolder({ manual: shared("crest.folders") ?? {}, loose: shared("crest.loose") ?? [] }, C.memberKey(row), to);
    setShared("crest.folders", next.manual);
    setShared("crest.loose", next.loose);
  }

  folderCtx() {
    const manual = shared("crest.folders") ?? {};
    const hidden = shared("crest.hidden") ?? [];
    const loose = shared("crest.loose") ?? [];
    return { manual, pinned: shared("crest.pinned") ?? [], order: shared("crest.order") ?? [], nameOf: (r) => C.folderFor(r, { manual, cfg: this.cfg, hidden, loose }) };
  }

  // Rows under folder headers. Pinned and loose spaces come first, without a header.
  sectioned(rows, draw, t, collapsed) {
    for (const r of rows) this.rowsById[r.w.id] = r;
    this.claimPending(rows);
    const ctx = this.folderCtx();
    const secs = C.sections(rows, ctx);
    if (!C.needsHeaders(secs)) return secs.flatMap((sec) => sec.rows.map(draw));
    const folded = shared("crest.folded") ?? [];
    const names = secs.filter((sec) => sec.name !== null).map((sec) => sec.name);
    const overrides = { ...(shared("crest.colors") ?? {}) };
    for (const [n, f] of Object.entries(ctx.manual)) if (f.color) overrides[n] = f.color;
    const colors = C.folderColors(names, overrides);
    const labelOf = (sec) => (sec.kind === "manual" ? sec.name : C.folderLabel(sec.name, { renamed: shared("crest.names") ?? {}, labels: shared("crest.labels") ?? {} }));
    this.lastFolders = secs.filter((x) => x.name !== null).map((x) => ({ key: x.name, label: labelOf(x), color: colors[x.name] }));
    const dragging = this.pressed !== null;
    return secs.flatMap((sec) => {
      if (sec.name === null) return sec.rows.map(draw);
      const shut = folded.includes(sec.name);
      if (collapsed) {
        const compactColor = colors[sec.name];
        const compactLabel = sec.kind === "manual" ? sec.name : C.folderLabel(sec.name, { renamed: shared("crest.names") ?? {}, labels: shared("crest.labels") ?? {} });
        const st = this.cfg.dot ? C.topStatus(C.summarize(sec.rows)) : null;
        const head = U.compactFolder({
          t, key: sec.name, label: `${compactLabel} (${sec.tops.length})`, color: compactColor, shut, status: st,
          onClick: (_e, cx) => { setShared("crest.folded", C.toggleFold(folded, sec.name, names, false)); cx.notify(); },
          onMenu: () => openOverlay({ mod: "crest", kind: "popup", width: 230, height: 380, props: { crestMenu: true, kind: "folder", name: sec.name, label: compactLabel, color: compactColor, manual: sec.kind === "manual", names, members: sec.tops.map((r) => C.memberKey(r)) } }),
        });
        return [U.compactGroup(t, sec.name, head, shut ? [] : sec.rows.map(draw))];
      }
      const pics = C.stackOf(sec.tops, (r) => this.iconFor(r.g), 3);
      const more = Math.max(0, sec.tops.length - pics.length);
      const status = this.cfg.dot ? C.topStatus(C.summarize(sec.rows)) : null;
      const color = colors[sec.name];
      const label = sec.kind === "manual" ? sec.name : C.folderLabel(sec.name, { renamed: shared("crest.names") ?? {}, labels: shared("crest.labels") ?? {} });
      const movingFolder = this.folderDrag !== null && this.folderDrag !== undefined && this.folderMoved;
      const head = U.folderHeader({
        t, key: sec.name, label, color, count: sec.tops.length, shut, status, icons: pics, more,
        hot: dragging && this.dropOver === sec.name,
        hovered: !dragging && this.folderDrag == null && this.hover === `folder:${sec.name}`,
        onHover: (on, cx) => this.setHover(`folder:${sec.name}`, on, cx),
        onAdd: () => this.quickAdd(sec, label, secs),
        landing: movingFolder && this.folderOver === sec.name && this.folderDrag !== sec.name,
        onClick: (e, cx) => {
          if (dragging || this.skipClick) { this.skipClick = false; return; }
          setShared("crest.folded", C.toggleFold(folded, sec.name, names, Boolean(e?.modifiers?.alt)));
          // A double-click folds and unfolds (no change) and opens the name field.
          if (e?.click_count === 2) openOverlay({ mod: "crest", kind: "popup", width: 240, height: 140, props: { crestMenu: true, kind: "folder", startRename: true, name: sec.name, label, color, manual: sec.kind === "manual", names } });
          cx.notify();
        },
        onMenu: () => openOverlay({ mod: "crest", kind: "popup", width: 230, height: 380, props: { crestMenu: true, kind: "folder", name: sec.name, label, color, manual: sec.kind === "manual", names, members: sec.tops.map((r) => C.memberKey(r)) } }),
        onDown: () => { this.folderDrag = sec.name; this.folderMoved = false; this.folderOver = sec.name; this.skipClick = false; },
        onMove: (_e, cx) => {
          if (dragging && this.dropOver !== sec.name) { this.dropOver = sec.name; cx.notify(); }
          if (this.folderDrag != null && (this.folderOver !== sec.name || this.dropOver !== sec.name)) {
            if (this.folderOver !== sec.name) this.folderMoved = true;
            this.folderOver = sec.name;
            this.dropOver = sec.name;
            cx.notify();
          }
        },
        onUp: (_e, cx) => {
          if (dragging) {
            const row = this.rowsById[this.pressed];
            this.pressed = null; this.over = null; this.dropOver = null;
            if (row) this.joinFolder(row, sec.name);
          } else if (this.folderDrag != null && this.folderMoved && this.folderDrag !== sec.name) {
            setShared("crest.order", C.moveFolder(names, this.folderDrag, sec.name));
            this.skipClick = true;
          }
          this.folderDrag = null; this.folderMoved = false; this.folderOver = null;
          cx.notify();
        },
      });
      const body = shut ? [] : sec.rows.length ? sec.rows.map(draw) : [U.emptyHint(t, sec.name)];
      return [head, ...body];
    }).concat(collapsed ? [] : [this.endZone(t, secs, names, dragging)]);
  }

  // Below the last folder: folders dropped here go last; spaces dropped here join the last folder, at its end.
  endZone(t, secs, names, dragging) {
    const last = secs[secs.length - 1];
    const movingFolder = this.folderDrag != null && this.folderMoved;
    return U.endZone({
      t,
      landing: (movingFolder || dragging) && this.dropOver === "\u0000end",
      onMove: (_e, cx) => {
        if ((this.folderDrag != null || dragging) && this.dropOver !== "\u0000end") {
          this.dropOver = "\u0000end";
          if (this.folderDrag != null) this.folderMoved = true;
          cx.notify();
        }
      },
      onUp: (_e, cx) => {
        if (this.folderDrag != null && this.folderMoved) setShared("crest.order", C.moveFolder(names, this.folderDrag, null));
        else if (dragging) {
          const row = this.rowsById[this.pressed];
          if (row && last) {
            this.joinFolder(row, last.name);
            run("space.move", { id: row.w.id, index: spaces().length });
          }
        }
        this.endDrags(cx);
      },
    });
  }

  gitTail(g, tree, name, t, key) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)))
      .when(this.cfg.dirty && g.dirty > 0, (el) => el.child(U.dirtyMark(t, g.dirty)))
      .when(Boolean(key && this.prs[key]?.pr), (el) => {
        const pr = this.prs[key].pr;
        return el.child(U.prChip(t, pr, (_e, cx) => { cx.stop_propagation?.(); if (pr.url) exec("open", [pr.url]).catch(() => null); }));
      });
  }

  row({ w, i, g, tree }, t) {
    const on = w.active;
    const fromIndex = this.pressed === null ? -1 : spaces().findIndex(s => s.id === this.pressed);
    const colors = shared("space.colors") ?? {};
    const fill = String(colors[w.id] ?? "").startsWith("#") ? colors[w.id] : C.hashColor(g?.repo ?? w.folder ?? w.id);
    const key = where(w, panes());
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(this.pressed === w.id && this.over !== w.id, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === w.id && this.pressed !== w.id, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(fromIndex < i, line => line.bottom(0))
          .when(fromIndex > i, line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.pressed = w.id;
        this.over = w.id;
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces().find(s => s.id === this.pressed);
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? w.id : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === w.id && from !== w.id) {
          const src = this.rowsById[from], dst = this.rowsById[w.id];
          if (src && dst) {
            const nameOf = this.folderCtx().nameOf;
            const to = nameOf(dst);
            if (to !== nameOf(src)) this.joinFolder(src, to);
          }
          const index = spaces().findIndex(s => s.id === w.id);
          if (index !== -1) run("space.move", { id: from, index: index + 1 });
        } else if (from === w.id) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .on_hover((on, cx) => this.setHover(`row:${w.id}`, on, cx))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => el.pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).text_color(fill)))
          .when(!tree, el => el.child(U.tile({ t, size: this.cfg.size, radius: this.cfg.radius, icon: this.iconFor(g), letter: C.initial(w.name), fill, status: this.cfg.dot && (["blocked", "done"].includes(w.status) || (w.status === "working" && this.cfg.agents === "none")) ? w.status : null })))
          .child(div().flex_shrink(0).max_w(150).truncate().text_color(t.foreground).child(w.name))
          .child(g ? this.gitTail(g, tree, w.name, t, key) : div().flex_1())
          .when(this.hover === `row:${w.id}` && this.pressed === null, (el) => el.child(h_flex().flex_none().gap(2)
            .child(U.iconButton({ t, id: `crest-new-${w.id}`, icon: "plus", tip: "New terminal or agent here", onClick: () => this.quickNew(w) }))
            .child(U.iconButton({ t, id: `crest-close-${w.id}`, icon: "x", tip: "Close space", onClick: () => run("space.close", { id: w.id }) })))),
      );
  }

  // A repo whose main checkout isn't open, over its worktrees: its picture and name, dimmed.
  // Click opens the checkout (it then takes this row's place); + makes another worktree.
  openMain(r) {
    if (r.w.folder) run("space.new", { folder: r.w.folder, machine: r.w.machine ?? "" });
  }

  newWorktree(r) {
    openOverlay({ mod: "worktree", kind: "dialog", width: 440, height: 260, props: { space: r.first, folder: r.w.folder ?? undefined, action: "new" } });
  }

  ghostRow(r, t) {
    const { w, g } = r;
    const fill = C.hashColor(g.repo);
    const hovered = this.hover === `row:${w.id}` && this.pressed === null;
    return h_flex().id(`space-${w.id}`).px(8).h(rowHeight({})).flex_none().gap(9).items_center().rounded(8)
      .hover((s) => s.bg(t.hover))
      .when(Boolean(w.folder), (el) => el.tooltip(`Open ${w.name}`).on_click(() => this.openMain(r)))
      .on_mouse_up("left", (_e, cx) => this.endDrags(cx))
      .on_hover((on, cx) => this.setHover(`row:${w.id}`, on, cx))
      .child(div().opacity(0.6).child(U.tile({ t, size: this.cfg.size, radius: this.cfg.radius, icon: this.iconFor(g), letter: C.initial(w.name), fill })))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(w.name))
      .when(hovered, (el) => el.child(U.iconButton({ t, id: `crest-wt-${w.id}`, icon: "plus", tip: "New worktree", onClick: () => this.newWorktree(r) })));
  }

  // The narrow sidebar: just the tiles, with their status dot.
  compact(r, t) {
    const { w, g, tree } = r;
    if (r.ghost) {
      return h_flex().id(`space-${w.id}`).h(36).w_full().flex_none().justify_center().items_center()
        .tooltip(w.name)
        .when(Boolean(w.folder), (el) => el.on_click(() => this.openMain(r)))
        .child(h_flex().size(32).flex_none().rounded(9).items_center().justify_center().opacity(0.6).hover((s) => s.bg(t.hover))
          .child(U.tile({ t, size: 24, radius: Math.min(this.cfg.radius, 12), icon: this.iconFor(g), letter: C.initial(w.name), fill: C.hashColor(g.repo) })));
    }
    const colors = shared("space.colors") ?? {};
    const fill = String(colors[w.id] ?? "").startsWith("#") ? colors[w.id] : C.hashColor(g?.repo ?? w.folder ?? w.id);
    const face = tree
      ? svg("mods/workspace-chrome/branch.svg").size(11).text_color(fill).opacity(0.85)
      : U.tile({ t, size: 24, radius: Math.min(this.cfg.radius, 12), icon: this.iconFor(g), letter: C.initial(w.name), fill, status: this.cfg.dot && ["blocked", "done", "working"].includes(w.status) ? w.status : null });
    // Only the tile is highlighted, so the column reads as icons, not as stretched rows.
    return h_flex()
      .id(`space-${w.id}`)
      .h(tree ? 22 : 36)
      .w_full()
      .flex_none()
      .justify_center()
      .items_center()
      .tooltip(w.name)
      .on_click(() => run("space.select", { id: w.id }))
      .on_mouse_down("right", () => this.menu(w))
      .child(h_flex().size(tree ? 22 : 32).flex_none().rounded(tree ? 6 : 9).items_center().justify_center()
        .when(w.active, (el) => el.bg(t.selected))
        .hover((s) => s.bg(t.hover))
        .child(face));
  }

  render() {
    if (this.popup) return this.popup.render();
    const t = theme();
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(!collapsed, el => el.child(div().flex_1().child("Spaces")))
        .when(!collapsed, el => el.child(div().id("crest-folder-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).tooltip("New folder")
          .hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => openOverlay({ mod: "crest", kind: "popup", width: 240, height: 140, props: { crestMenu: true, kind: "newfolder" } }))
          .child(svg("mods/workspace-chrome/folder-plus.svg").size(14))))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("space.new")).child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .child(v_flex().flex_1().min_h(0).px(8).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => this.endDrags(cx))
        // A button let go outside the list never reaches it: leaving the list ends any drag.
        .on_hover((inside, cx) => { if (!inside) this.endDrags(cx); })
        .children(this.grouped(t, collapsed)));
  }
}
