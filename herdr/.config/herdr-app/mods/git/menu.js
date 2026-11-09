// The right-click menu, opened as a popup at the pointer with props
// { role: "menu", target, ctx }, or { role: "menu", items, ctx } with its items
// already made (the sync button's). Crew's menu: popover, p 4, 30px items, danger in theme blocked.
import { image } from "gpui-kit";
import { v_flex } from "gpui-base";
import { props, closeOverlay, notify, theme, run, setShared } from "herdr";
import { menuFor } from "./git.js";
import * as K from "./kit.js";
import { perform, openDialog } from "./act.js";

// Rows drawn in the danger color.
const danger = (a) => a.type.startsWith("delete") || a.type === "stashDrop";
// A glyph of this mod, or another mod's icon by its path (Herdr's own Changes icon).
export const icon = (name) => (name.includes("/") ? name : `mods/git/icons/${name}.svg`);

export class Menu {
  init(cx) {
    const { target, ctx, items } = props();
    this.items = items ?? menuFor(target, ctx);
    this.at = -1;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  choose(i, cx) {
    const it = this.items[i], { overlay, ctx } = props();
    if (!it || it.separator || this.busy) return;
    const a = it.action;
    if (a.type === "newTab") {
      // As Herdr's + menu: a tab in the selected space, here in the repository.
      closeOverlay(overlay);
      run("tab.new", { folder: a.folder, ...(a.argv ? { name: a.name, argv: a.argv } : {}) });
    } else if (a.type === "openUrl") {
      closeOverlay(overlay);
      cx.open_url(a.url);
    } else if (a.type === "copy") {
      cx.write_to_clipboard(a.text);
      closeOverlay(overlay);
      notify({ title: "Copied", body: a.text, level: "success", timeout: 2000 });
    } else if (a.type === "fetchAll") {
      // The graph showing that Manygit list runs it, with its per-row progress.
      closeOverlay(overlay);
      setShared("git-graph.fetchAll", { root: a.root, at: Date.now() });
    } else if (openDialog(a, ctx)) {
      closeOverlay(overlay);
    } else {
      // Runs here, then closes: a closed popup's tasks would be cancelled.
      this.busy = i;
      cx.spawn(async (cx) => { await perform(a, {}, ctx); closeOverlay(overlay); cx.notify(); });
    }
    cx.notify();
  }

  move(step) {
    const n = this.items.length;
    for (let k = 1; k <= n; k++) {
      const i = (this.at + step * k + n * 2) % n;
      if (!this.items[i].separator) { this.at = i; return; }
    }
  }

  render(cx) {
    const t = theme();
    return v_flex().id("git-menu").track_focus(this.handle).w_full().min_h(0).p(4).bg(t.popover).text_color(t.foreground).text_size(K.SIZE.body)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.move(1);
        else if (e.key === "up") this.move(-1);
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .children(this.items.map((it, i) => it.separator
        ? K.menuSeparator(t).flex_none()
        // An agent's own icon keeps its colors when it isn't drawn tinted.
        : K.menuItem(t, `gm-${i}`, { icon: it.image ? image(it.icon).size(14).flex_none() : icon(it.icon), label: this.busy === i ? "Working…" : it.label,
          danger: danger(it.action), onClick: (_e, cx) => this.choose(i, cx) })
          .flex_none().when(i === this.at || this.busy === i, (el) => el.bg(t.selected))));
  }
}
