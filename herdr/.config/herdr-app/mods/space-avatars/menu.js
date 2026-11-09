// The space menu (right-click a space): the shipped `menu` mod's space items, plus
// "Set icon…" and "Remove icon" (when one is set).
// Opened as a popup of this mod with props { view: "menu", space }.
// ↑/↓ move, Enter runs, Esc closes.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, spaces, panes, exec, shared } from "herdr";
import { SHARED_KEY } from "./avatars.js";
import { MOD, removeIcon } from "./files.js";

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

// [label, command, args]; "worktree", "icon.set" and "icon.remove" are handled here.
function items(id, git) {
  const space = spaces().find((s) => s.id === id);
  const has = Boolean((shared(SHARED_KEY) ?? {})[id]);
  return [
    ["Rename", "space.rename", { id }],
    ...(git ? [["New worktree", "worktree", { space: id, action: "new" }], ["Open worktree", "worktree", { space: id, action: "open" }]] : []),
    ...(git === "linked" ? [["Remove worktree", "worktree", { space: id, action: "remove" }]] : []),
    ...(space ? [["Set icon…", "icon.set", { space: id }]] : []),
    ...(has ? [["Remove icon", "icon.remove", { space: id }]] : []),
    ["Close", "space.close", { id }],
  ];
}

function menuIcon(command) {
  if (command.startsWith("icon.")) return `mods/${MOD}/image.svg`;
  const name = command.endsWith(".close") ? "x" : command.endsWith(".rename") ? "square-pen" : command === "worktree" ? "git-branch" : "terminal";
  return `mods/workspace-chrome/${name}.svg`;
}

// The key bound to a command, for the hint on the right.
function shortcut(name, args) {
  const value = args && Object.values(args)[0];
  const k = keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${value}`));
  return k ? k.keys : "";
}

export class SpaceMenu {
  init(p, cx) {
    this.id = p?.space;
    this.at = 0;
    this.git = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const space = spaces().find((s) => s.id === this.id);
    const folder = space && place(space);
    if (folder)
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, space.machine).catch(() => null);
        cx.notify();
      });
  }

  choose(i, cx) {
    const it = items(this.id, this.git)[i];
    if (!it) return;
    const overlay = props()?.overlay;
    if (it[1] === "icon.remove") {
      // Remove before closing: closing cancels this copy's unfinished tasks.
      cx.spawn(async () => {
        await removeIcon(it[2].space).catch(() => {});
        closeOverlay(overlay);
      });
      return;
    }
    closeOverlay(overlay);
    if (it[1] === "worktree") openOverlay({ mod: "worktree", kind: "dialog", ...(it[2].action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: it[2] });
    else if (it[1] === "icon.set") openOverlay({ mod: MOD, kind: "dialog", width: 460, height: 250, props: { view: "pick", space: it[2].space } });
    else run(it[1], it[2]);
  }

  render() {
    const t = theme();
    const list = items(this.id, this.git);
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(
        list.map((it, i) =>
          v_flex()
            .when(i > 0 && it[1].endsWith(".close"), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
            .child(h_flex()
              .id(`mi-${i}`)
              .h(31)
              .px(8)
              .gap(9)
              .rounded(7)
              .items_center()
              .justify_between()
              .text_color(t.foreground)
              .when(i === this.at, (el) => el.bg(t.selected))
              .hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => this.choose(i, cx))
              .child(svg(menuIcon(it[1])).size(14).flex_none().text_color(t.muted))
              .child(div().flex_1().child(it[0]))
              .child(div().text_size(11).text_color(t.dim).child(shortcut(it[1], it[2])))),
        ),
      );
  }
}
