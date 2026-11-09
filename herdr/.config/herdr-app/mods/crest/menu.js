// The right-click menu of crest, drawn by the crest mod itself when opened as a popup. For a space: pin, folders, worktrees, rename, close.
// For a folder: rename, color, fold others, delete. Folders live in shared("crest.folders").
import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, shared, setShared, exec, appHome, knownAgents, pickFolder } from "herdr";
import { PALETTE, assign, renameFolder, hashColor, stepFolder, removeFolder, moveToFolder } from "./crest.js";

const ICON = (name) => (name === "chevron-up" ? "mods/crest/icons/chevron-up.svg" : `mods/workspace-chrome/${name}.svg`);

const folders = () => shared("crest.folders") ?? {};

// crest.json in the default text editor; made from the defaults the first time.
async function openSettings() {
  const path = `${appHome()}/crest.json`;
  const seed = JSON.stringify({ group: "owner", icon: "auto", size: 24, radius: 8, dot: true, pr: true, dirty: true, agents: "active", programs: false, folders: {}, icons: {} }, null, 2);
  await exec("sh", ["-c", '[ -f "$1" ] || printf "%s\\n" "$2" > "$1"; open -t "$1" 2>/dev/null || xdg-open "$1"', "sh", path, seed]).catch(() => null);
}

const DANGER = { danger: true };

function spaceItems(p) {
  const list = [];
  list.push([p.pinned ? "Unpin" : "Pin to top", p.pinned ? "pin-off" : "pin", () => {
    const pins = new Set(shared("crest.pinned") ?? []);
    p.pinned ? pins.delete(p.key) : pins.add(p.key);
    setShared("crest.pinned", [...pins]);
  }]);
  list.push(["Move to folder…", "folder", "mode:move"]);
  list.push(["—"]);
  if (p.git) list.push(["New worktree…", "git-branch", () => openOverlay({ mod: "worktree", kind: "dialog", width: 440, height: 260, props: { space: p.id, action: "new" } })]);
  if (p.git) list.push(["Open worktree…", "git-branch", () => openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { space: p.id, action: "open" } })]);
  list.push(["Rename…", "square-pen", () => run("space.rename", { id: p.id })]);
  list.push(["Crest settings…", "settings", () => openSettings()]);
  list.push(["—"]);
  if (p.git === "linked") list.push(["Remove worktree…", "git-branch", () => openOverlay({ mod: "worktree", kind: "dialog", width: 440, height: 260, props: { space: p.id, action: "remove" } }), null, DANGER]);
  list.push(["Close space", "x", () => run("space.close", { id: p.id }), null, DANGER]);
  return list;
}

// "Move to folder…": every folder, the current one checked, plus a new one or none.
function moveItems(p) {
  const move = (to) => () => {
    const next = moveToFolder({ manual: folders(), loose: shared("crest.loose") ?? [] }, p.key, to);
    setShared("crest.folders", next.manual);
    setShared("crest.loose", next.loose);
  };
  const list = (p.allFolders ?? []).map((f) => [f.label, `folder:${f.color}`, move(f.key), null, f.key === p.folder ? { checked: true } : null]);
  if (list.length) list.push(["—"]);
  list.push(["New folder…", "folder-plus", "input:new"]);
  list.push(["No folder", "minus", move(null), null, p.folder ? null : { checked: true }]);
  if (p.hidden) list.push(["Show removed folders", "layers", () => setShared("crest.hidden", [])]);
  return list;
}

// "+" on a space row: a terminal or an agent in that space.
function newItems(p, agents) {
  const list = [["Terminal", "terminal", () => run("tab.new", { space: p.id })]];
  for (const a of agents) list.push([a.name, a.icon ? `prog:${a.icon}:${a.tint ? 1 : 0}` : "terminal", () => run("tab.new", { name: a.name, space: p.id, argv: a.run })]);
  list.push(["—"]);
  if (p.git) list.push(["New worktree…", "git-branch", () => openOverlay({ mod: "worktree", kind: "dialog", width: 440, height: 260, props: { space: p.id, action: "new" } })]);
  list.push(["New space", "plus", () => run("space.new", {})]);
  return list;
}

// "+" on a folder header: put spaces in it with one click each, or start a new one there.
function addItems(p) {
  const list = [["New space here…", "plus", async () => {
    const folder = await pickFolder({ prompt: "Open" });
    if (!folder) return;
    setShared("crest.pending", { folder, to: p.name, at: Date.now() });
    run("space.new", { folder });
  }]];
  list.push(["—"]);
  for (const c of p.candidates ?? []) list.push([c.name, c.icon ? `pic:${c.icon}` : `letter:${c.letter}:${c.fill}`, () => {
    const next = moveToFolder({ manual: folders(), loose: shared("crest.loose") ?? [] }, c.key, p.name);
    setShared("crest.folders", next.manual);
    setShared("crest.loose", next.loose);
  }, c.key]);
  return list;
}

function folderItems(p) {
  const names = p.names ?? [];
  const folded = shared("crest.folded") ?? [];
  const othersOpen = names.some((n) => n !== p.name && !folded.includes(n));
  const list = [];
  list.push(["Rename…", "square-pen", "input:rename"]);
  list.push(["colors"]);
  if (names.length > 1) list.push(["order"]);
  list.push(othersOpen
    ? ["Fold the others", "layers", () => setShared("crest.folded", names.filter((n) => n !== p.name))]
    : ["Open all folders", "layers", () => setShared("crest.folded", [])]);
  list.push(["—"]);
  list.push(["Remove folder", "x", () => {
    const next = removeFolder({ manual: folders(), hidden: shared("crest.hidden") ?? [] }, p.name);
    setShared("crest.folders", next.manual);
    setShared("crest.hidden", next.hidden);
    setShared("crest.folded", (shared("crest.folded") ?? []).filter((n) => n !== p.name));
  }, null, DANGER]);
  return list;
}

// The left cell of a menu row: a theme icon, a program's icon, a space's picture, or its letter.
function cell(t, spec) {
  if (spec.startsWith("folder:")) {
    const color = spec.slice(7);
    return div().relative().size(16).flex_none()
      .child(svg("mods/crest/icons/folder-back.svg").size(16).absolute().left(0).top(0).text_color(color).opacity(0.5))
      .child(svg("mods/crest/icons/folder-front.svg").size(16).absolute().left(0).top(0).text_color(color));
  }
  if (spec.startsWith("pic:")) return h_flex().size(16).flex_none().rounded(5).overflow_hidden().child(image(spec.slice(4)).size(16).rounded(5));
  if (spec.startsWith("letter:")) {
    const [, letter, fill] = spec.split(":");
    return h_flex().size(16).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(9.5).font_bold().text_color("#ffffff").child(letter);
  }
  if (spec.startsWith("prog:")) {
    const [, icon, tint] = spec.split(":");
    return tint === "1" ? svg(icon).size(14).flex_none().text_color(t.muted) : image(icon).w(14).h(14).flex_none();
  }
  return svg(ICON(spec)).size(14).flex_none().text_color(t.muted);
}

export class Menu {
  constructor(cx) {
    this.mode = null; // "new" | "rename" while the name field is open
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.at = 0;
    this.agents = [];
    this.added = new Set(); // spaces put in the folder from this popup
    const p = props() ?? {};
    if (p.kind === "new") cx.spawn(async (cx) => {
      this.agents = (await knownAgents({ on: p.machine ?? null }).catch(() => [])).filter((a) => a.installed);
      cx.notify();
    });
    if (p.kind === "newfolder") this.openInput("new", cx);
    if (p.startRename) this.openInput("rename", cx);
  }

  openInput(mode, cx) {
    const p = props();
    this.mode = mode;
    const value = mode === "rename" ? (p.label ?? p.name) : "";
    this.input = InputState.new({ value });
    if (value) this.input.set_selected_range({ start: 0, end: value.length });
    this.input.on("submit", () => this.submit());
    this.input.focus();
    cx.timer.after(50, () => this.input.focus());
    cx.notify();
  }

  submit() {
    const p = props();
    const name = String(this.input?.value() ?? "").trim();
    closeOverlay(p.overlay);
    if (!name) return;
    const m = folders();
    if (this.mode === "new") {
      const withFolder = m[name] ? m : { ...m, [name]: { members: [] } };
      setShared("crest.folders", p.key ? assign(withFolder, p.key, name) : withFolder);
    } else if (this.mode === "rename" && !p.manual) {
      setShared("crest.names", { ...(shared("crest.names") ?? {}), [p.name]: name });
    } else if (this.mode === "rename") {
      setShared("crest.folders", renameFolder(m, p.name, name));
      const swap = (list) => list.map((n) => (n === p.name ? name : n));
      setShared("crest.folded", swap(shared("crest.folded") ?? []));
      setShared("crest.order", swap(shared("crest.order") ?? []));
    }
  }

  choose(it, cx) {
    const action = it[2];
    if (typeof action === "string" && action.startsWith("input:")) return this.openInput(action.slice(6), cx);
    if (action === "mode:move") { this.mode = "move"; this.at = 0; cx.notify(); return; }
    if (props()?.kind === "add" && it[3]) {
      // Adding spaces: stay open so several can go in, mark the ones done.
      if (!this.added.has(it[3])) { action?.(); this.added.add(it[3]); }
      cx.notify();
      return;
    }
    closeOverlay(props()?.overlay);
    action?.();
  }

  setColor(color) {
    const p = props();
    const m = folders();
    if (p.manual) setShared("crest.folders", { ...m, [p.name]: { ...m[p.name], color } });
    else setShared("crest.colors", { ...(shared("crest.colors") ?? {}), [p.name]: color });
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const list = this.mode === "move" ? moveItems(p) : p.kind === "folder" ? folderItems(p) : p.kind === "new" ? newItems(p, this.agents) : p.kind === "add" ? addItems(p) : spaceItems(p);
    const real = list.filter((it) => !["—", "colors", "order"].includes(it[0]));
    const box = v_flex().id("crest-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (this.mode && this.mode !== "move") { if (e.key === "escape") closeOverlay(p.overlay); return; }
        if (e.key === "down") this.at = (this.at + 1) % real.length;
        else if (e.key === "up") this.at = (this.at + real.length - 1) % real.length;
        else if (e.key === "enter") this.choose(real[this.at], cx);
        else if (e.key === "escape") closeOverlay(p.overlay);
        else return;
        cx.notify();
      });

    if (this.mode && this.mode !== "move") {
      return box.p(10).gap(8)
        .child(div().text_size(11.5).text_color(t.dim).child(this.mode === "new" ? "New folder" : "Rename folder"))
        .child(Input.new(this.input).h(32).px(9).rounded(8).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground))
        .child(div().text_size(11).text_color(t.dim).child("Enter to save, Esc to cancel"));
    }

    const current = p.color ?? hashColor(p.name ?? "");
    const heading = this.mode === "move" ? "Move to folder" : p.kind === "add" ? `Add to ${p.label ?? p.name}` : p.kind === "new" ? `New in ${p.spaceName ?? "this space"}` : null;
    return box.when(Boolean(heading), (el) => el.child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child(heading))).children(list.map((it, i) => {
      if (it[0] === "—") return div().mx(7).my(4).h(1).bg(t.border);
      if (it[0] === "colors") {
        return h_flex().px(8).py(7).gap(5).justify_between()
          .children(PALETTE.map((c) => div().id(`crest-c-${c}`).size(14).flex_none().rounded(7).bg(c).cursor_pointer()
            .when(c === current, (el) => el.border(2).border_color(t.foreground))
            .hover((s) => s.opacity(0.75))
            .on_click(() => { this.setColor(c); closeOverlay(p.overlay); })));
      }
      if (it[0] === "order") {
        const names = p.names ?? [];
        const at = names.indexOf(p.name);
        const step = (dir) => () => { setShared("crest.order", stepFolder(names, p.name, dir)); closeOverlay(p.overlay); };
        const arrow = (id, icon, ok, dir) => h_flex().id(id).size(24).rounded(6).items_center().justify_center()
          .when(ok, (el) => el.cursor_pointer().text_color(t.foreground).hover((s) => s.bg(t.hover)).on_click(step(dir)))
          .when(!ok, (el) => el.text_color(t.dim).opacity(0.4))
          .child(svg(ICON(icon)).size(14));
        return h_flex().h(30).px(8).gap(9).items_center().text_color(t.foreground)
          .child(svg(ICON("layers")).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().child("Move"))
          .child(arrow("crest-up", "chevron-up", at > 0, -1))
          .child(arrow("crest-down", "chevron-down", at !== -1 && at < names.length - 1, 1));
      }
      const k = real.indexOf(it);
      const flags = it[4] ?? {};
      return h_flex().id(`crest-mi-${i}`).h(30).px(8).gap(9).rounded(7).items_center().text_color(flags.danger ? (t.blocked ?? t.ansi1) : t.foreground)
        .when(k === this.at, (el) => el.bg(t.selected))
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.choose(it, cx))
        .child(flags.danger ? svg(ICON(it[1])).size(14).flex_none() : cell(t, it[1]))
        .child(div().flex_1().truncate().child(it[0]))
        .when((Boolean(it[3]) && this.added.has(it[3])) || Boolean(flags.checked), (el) => el.child(svg(ICON("check")).size(13).flex_none().text_color(t.done ?? t.ansi2)));
    }));
  }
}
