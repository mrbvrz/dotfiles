// The branch chip's popup, opened with props { role: "branches", ctx }: a filter,
// "+ Create branch…", the local branches (the current one checked), then remote
// branches that have no local twin. Picking one checks it out; git's error stays here.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme, exec } from "herdr";
import { READ, parseBranches, pickerStart } from "./git.js";
import { perform, openDialog } from "./act.js";
import { icon } from "./menu.js";
import * as K from "./kit.js";

const REFS = ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"];

export class Branches {
  init(cx) {
    this.all = []; this.at = 0; this.error = null; this.busy = false; this.loaded = false;
    this.state = InputState.new({ value: "" });
    this.state.on("change", (_e, cx) => {
      const rows = this.rows(), q = this.state.value();
      this.at = pickerStart(rows.filter((r) => !r.create).length, q, rows.some((r) => r.create));
      this.error = null; cx.notify();
    });
    this.state.on("submit", (_e, cx) => this.choose(this.at, cx));
    this.state.focus();
    cx.timer.after(300, () => this.state.focus());
    const { ctx } = props();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("git", [...READ, ...REFS], { cwd: ctx.root, on: ctx.on });
        if (r.code === 0) this.all = parseBranches(r.stdout, ctx.remotes ?? []);
        else this.error = r.stderr?.trim() || "Couldn't read the branches";
      } catch (e) { this.error = String(e?.message ?? e); }
      this.loaded = true;
      cx.notify();
    });
  }

  // Row 0 is "Create branch…" (only with a commit to branch from), then the matches.
  rows() {
    const { ctx } = props(), q = this.state.value().trim().toLowerCase();
    const list = this.all.filter((b) => b.name.toLowerCase().includes(q));
    return [...(ctx.head ? [{ create: true }] : []), ...list];
  }

  choose(i, cx) {
    const { ctx, overlay } = props(), b = this.rows()[i];
    if (!b || this.busy !== false) return;
    if (b.create) {
      // From the picker, a new branch is one to switch to.
      if (openDialog({ type: "createBranch", hash: ctx.head, short: ctx.head.slice(0, 8), checkout: true }, ctx)) closeOverlay(overlay);
      return;
    }
    if (b.name === ctx.current) { closeOverlay(overlay); return; }
    const action = b.remote ? { type: "checkoutRemote", name: b.name, remote: b.remote, branch: b.branch } : { type: "checkout", name: b.name };
    this.busy = i; this.error = null;
    // Runs here, then closes: a closed popup's tasks would be cancelled.
    cx.spawn(async (cx) => {
      const result = await perform(action, b.remote ? { name: b.branch } : {}, ctx, { toast: false });
      this.busy = false;
      if (result.ok) closeOverlay(overlay);
      else { this.error = result.message; cx.notify(); }
    });
    cx.notify();
  }

  render() {
    const t = theme(), { ctx } = props(), rows = this.rows();
    this.at = Math.min(this.at, Math.max(rows.length - 1, 0));
    // Crew's menu anatomy: popover, p 4, a 32px field, 30px items (check in the gutter for the current branch).
    return v_flex().id("git-branches").size_full().p(4).gap(4).bg(t.popover).text_size(K.SIZE.body).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % Math.max(rows.length, 1);
        else if (e.key === "up") this.at = (this.at - 1 + rows.length) % Math.max(rows.length, 1);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(K.field(t, Input.new(this.state), true).flex_none())
      .when(Boolean(this.error), (el) => el.child(div().px(8).py(4).text_size(K.SIZE.meta).text_color(t.blocked).child(this.error)))
      .child(v_flex().id("git-branches-list").flex_1().min_h(0).overflow_y_scrollbar().children(rows.map((b, i) => {
        const cur = !b.create && b.name === ctx.current;
        return K.menuItem(t, `gb-${i}`, { icon: b.create ? icon("plus") : cur ? svg(icon("check")).size(13).text_color(t.accent) : null,
          label: b.create ? "Create branch…" : b.name, onClick: (_e, cx) => this.choose(i, cx) })
          .flex_none().when(i === this.at || i === this.busy, (el) => el.bg(t.selected))
          .when(cur, (el) => el.font_medium()).when(Boolean(b.remote), (el) => el.text_color(t.muted));
      })))
      .when(this.loaded && rows.length === (ctx.head ? 1 : 0), (el) => el.child(div().px(8).py(8).text_size(K.SIZE.meta).text_color(t.dim).child("No matching branches")));
  }
}
