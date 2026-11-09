// The panel's top half, VS Code's Source Control: the commit box and the
// Staged Changes / Changes groups, plus the header's sync button and its menu.
// The data (groups, upstream counts, operation, stashes) is read by the Graph
// that owns this; a row's click opens its diff in the Graph's bottom half.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, notify, openOverlay, readTextFile } from "herdr";
import { READ, menuHeight, hasConflictMarkers } from "./git.js";
import { syncPlan, commitValues, parseAheadBehind } from "./scm.js";
import { perform, openDialog } from "./act.js";
import { icon } from "./menu.js";
import * as K from "./kit.js";

// Rows drawn per group; a bigger group says how many more there are.
const MAX_ROWS = 500;
const STASHES = 10;
const STATUS_WORD = { M: "modified", A: "added", D: "deleted", U: "untracked", R: "renamed", "!": "conflicted" };
export const statusColor = (t, s) => ({ A: t.ansi2, U: t.ansi2, D: t.ansi1, "!": t.ansi1 })[s] ?? t.ansi3;
const item = (label, glyph, action) => ({ label, icon: glyph, action });

export class Changes {
  constructor(graph) { this.g = graph; }

  init(cx) {
    this.message = ""; this.typing = false; this.hover = null; this.collapsed = { staged: false, changes: false };
    this.input = InputState.new({ placeholder: "Message (⌘⏎)" });
    this.input.on("change", (_e, cx) => { this.message = this.input.value(); cx.notify(); });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
  }

  // The commit message belongs to the repository it was typed in: showing
  // another repository clears it (a folder that isn't one leaves it alone).
  follow(root, on) {
    const key = root && `${on ?? ""}\0${root}`;
    if (!key || key === this.repo) return;
    this.repo = key; this.message = ""; this.input.set_value("");
  }

  // The files in the order they're drawn: what ↑/↓ steps through while a diff is open.
  order() {
    const { staged, changes, conflicts } = this.g.groups;
    return [...staged.map((file) => ({ file, group: "staged" })), ...[...conflicts, ...changes].map((file) => ({ file, group: "changes" }))];
  }

  // A conflicted file's +: asks first, saying whether it still holds conflict markers.
  markResolved(file, cx) {
    const ctx = this.g.ctx;
    if (!ctx) return;
    cx.spawn(async () => {
      const text = await readTextFile(`${ctx.root}/${file.path}`, { on: ctx.on }).catch(() => null);
      openDialog({ type: "markResolved", path: file.path, markers: text === null ? undefined : hasConflictMarkers(text) }, ctx);
    });
  }

  // Asks first when the action has a dialog, else runs it; every copy refreshes after.
  act(action, cx) {
    const ctx = this.g.ctx;
    if (!ctx || openDialog(action, ctx)) return;
    cx.spawn(async (cx) => { await perform(action, {}, ctx); cx.notify(); });
  }

  commit(cx) {
    const g = this.g, values = commitValues(g.groups, this.message);
    if (!values || this.committing || !g.ctx) return;
    this.committing = true;
    const ctx = g.ctx;
    cx.spawn(async (cx) => {
      // Through the commit action, so staging everything keeps its unmerged-files guard.
      const result = await perform({ type: "commit" }, values, ctx);
      this.committing = false;
      if (result.ok) { this.input.set_value(""); this.message = ""; }
      cx.notify();
    });
    cx.notify();
  }

  plan() {
    const g = this.g;
    return syncPlan({ branch: g.current, head: g.head, upstream: g.upstream, ahead: g.ahead, behind: g.behind, remotes: g.remoteNames });
  }

  sync(cx) {
    const g = this.g, ctx = g.ctx, plan = this.plan();
    if (!ctx || this.syncing) return;
    if (plan.kind === "publish") return this.act({ type: "publish", name: ctx.current }, cx);
    if (plan.kind === "diverged") return this.act({ type: "pullRebase", upstream: g.upstream }, cx);
    if (!g.upstream || !ctx.current || !ctx.head) return;
    this.syncing = true;
    cx.spawn(async (cx) => {
      const result = await perform({ type: "sync" }, {}, ctx, { toast: false });
      if (!result.ok && !result.stale) {
        // The pull fetched first: a refused fast-forward may be a divergence only now visible.
        const r = await exec("git", [...READ, "rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd: ctx.root, on: ctx.on }).catch(() => null);
        const { ahead, behind } = parseAheadBehind(r?.code === 0 ? r.stdout : "");
        if (ahead > 0 && behind > 0) openDialog({ type: "pullRebase", upstream: g.upstream }, { ...ctx, ahead, behind });
        else notify({ title: "Couldn't sync", body: result.message, level: "error" });
      } else if (result.stale) notify({ title: "Couldn't sync", body: result.message, level: "error" });
      this.syncing = false;
      cx.notify();
    });
    cx.notify();
  }

  // Fetch, Pull, Push, Stash…, then each stash's Apply / Pop / Drop (the menu has no submenus).
  menuItems() {
    const g = this.g, ctx = g.ctx, remote = ctx.remotes.length > 0, dirty = this.order().length > 0;
    const sections = [
      [remote && item("Fetch", "refresh", { type: "fetch" }),
        g.upstream && ctx.current && item("Pull…", "fetch", { type: "pull", upstream: g.upstream }),
        remote && ctx.current && item("Push…", "push", { type: "push", name: ctx.current })],
      [dirty && item("Stash…", "stash", { type: "stash" })],
      g.stashes.slice(0, STASHES).flatMap((s) => {
        const what = `${s.ref}${s.message ? `: ${s.message}` : ""}`, a = { ref: s.ref, hash: s.hash, message: s.message };
        return [item(`Apply ${what}`, "stash", { type: "stashApply", ...a }), item(`Pop ${what}`, "check", { type: "stashPop", ...a }),
          item(`Drop ${what}`, "trash", { type: "stashDrop", ...a })];
      }),
      [g.workspace && g.opened && item("Fetch all (Manygit)", "fetch", { type: "fetchAll", root: g.workspace.root })],
    ].map((s) => s.filter(Boolean)).filter((s) => s.length);
    return sections.flatMap((s, i) => (i ? [{ separator: true }, ...s] : s));
  }

  openMenu() {
    const ctx = this.g.ctx, items = ctx && this.menuItems();
    if (!items?.length) return;
    openOverlay({ mod: "git", kind: "popup", at: "pointer", width: 300, height: menuHeight(items), props: { role: "menu", items, ctx } });
  }

  // A short text control (Continue, Abort): h 26, rounded 6, 11px, hover fill.
  textButton(id, text, tip, color, t, action) {
    return h_flex().id(id).h(26).px(6).flex_none().items_center().rounded(6).text_size(K.SIZE.meta).font_medium().cursor_pointer()
      .text_color(color).hover((s) => s.bg(t.hover)).tooltip(tip).accessibility_label(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((e, cx) => { cx.stop_propagation(); action(e, cx); })
      .child(text);
  }

  // The header's right side: the operation in progress with Continue / Abort, else sync and its menu.
  syncButton(t) {
    const g = this.g, op = g.operation;
    if (op) {
      return h_flex().flex_none().gap(4).items_center()
        .child(div().pr(4).text_size(K.SIZE.meta).text_color(t.blocked).child(op === "rebase" ? "Rebasing…" : "Merging…"))
        // Continue only once every conflicted file is marked resolved.
        .when(g.groups.conflicts.length === 0, (e) => e
          .child(this.textButton("git-continue", "Continue", `Continue the ${op}`, t.accent, t, (_e, cx) => this.act({ type: "continueOperation", op }, cx))))
        .child(this.textButton("git-abort", "Abort", `Abort the ${op}`, t.blocked, t, (_e, cx) => this.act({ type: "abortOperation", op }, cx)));
    }
    const plan = this.plan(), usable = plan.kind !== "none" || Boolean(g.upstream && g.current && g.head);
    const tip = plan.kind === "publish" ? "Publish this branch" : plan.kind === "diverged" ? "Diverged: pull with rebase or merge"
      : usable ? "Sync: pull, then push" : g.current ? "No upstream to sync with" : "Nothing to sync";
    const button = h_flex().id("git-sync").h(26).px(8).gap(4).flex_none().items_center().rounded(6).text_size(K.SIZE.meta).font_medium()
      .text_color(usable ? t.muted : t.dim).when(usable, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .tooltip(tip).accessibility_label(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.openMenu(); })
      .on_click((_e, cx) => { if (usable) this.sync(cx); })
      .child(svg(icon(plan.kind === "publish" ? "push" : "sync")).size(14).flex_none().when(Boolean(this.syncing), (e) => e.spin(900)))
      .when(plan.kind === "publish", (e) => e.child("Publish"))
      .when(plan.kind !== "publish" && g.ahead > 0, (e) => e.child(div().text_color(t.ansi2).child(`↑${g.ahead}`)))
      .when(plan.kind !== "publish" && g.behind > 0, (e) => e.child(div().text_color(t.ansi1).child(`↓${g.behind}`)));
    return h_flex().flex_none().items_center().child(button)
      .child(K.iconButton(t, "git-sync-menu", "chevron-down", () => this.openMenu(), { tip: "More git actions", size: 12 }).w(20));
  }

  // A row's hover action: a Crew icon button, 22px, that keeps the click from opening the row.
  rowButton(id, glyph, tip, t, action) {
    return K.iconButton(t, id, icon(glyph), (e, cx) => { cx.stop_propagation(); action(e, cx); }, { tip, size: 13 }).size(22);
  }

  // The message field (Crew's field: h 32, rounded 8, accent while typing) and the commit button.
  commitBox(t) {
    const values = commitValues(this.g.groups, this.message), ready = Boolean(values) && !this.committing;
    return h_flex().flex_none().px(8).pt(8).pb(4).gap(8).items_center()
      .child(div().id("git-commit-message").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(8).border_1()
        .border_color(this.typing ? t.accent : t.input).bg(t.background).cursor_text()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_key_down((e, cx) => { if (e.keystroke === "cmd-enter") { this.commit(cx); cx.stop_propagation(); } })
        .child(Input.new(this.input).h_full().w_full().text_size(K.SIZE.body).text_color(t.foreground)))
      .child(K.button(t, "git-commit", this.committing ? "Committing…" : values?.all ? "Commit all" : "Commit", (_e, cx) => this.commit(cx),
        { primary: true, disabled: !ready }).h(32)
        .tooltip(values?.all ? "Stage everything and commit (⌘⏎)" : "Commit the staged changes (⌘⏎)"));
  }

  // A group's header, as Crew's section: 11px muted words, count and chevron on the right; on hover its "all" buttons.
  groupHeader(key, title, files, t) {
    const hovered = this.hover === `h-${key}`, collapsed = this.collapsed[key];
    const changes = files.filter((f) => f.status !== "!");
    return h_flex().id(`git-group-${key}`).h(28).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
      .text_size(K.SIZE.meta).text_color(hovered ? t.foreground : t.muted)
      .accessibility_label(`${collapsed ? "Show" : "Hide"} ${title.toLowerCase()}`)
      .on_hover((h, cx) => this.hovered(`h-${key}`, h, cx))
      .on_click((_e, cx) => { this.collapsed[key] = !collapsed; cx.notify(); })
      .child(div().flex_1().min_w(0).truncate().child(title))
      .when(hovered && key === "staged", (e) => e.child(this.rowButton("git-unstage-all", "minus", "Unstage all", t,
        (_e, cx) => this.act({ type: "unstage", paths: files.map((f) => f.path) }, cx))))
      .when(hovered && key === "changes" && changes.length > 0, (e) => e
        .child(this.rowButton("git-discard-all", "discard", "Discard all changes", t, (_e, cx) => this.act(this.discardOf(changes), cx)))
        .child(this.rowButton("git-stage-all", "plus", "Stage all changes", t, (_e, cx) => this.act({ type: "stage", paths: changes.map((f) => f.path) }, cx))))
      .child(div().flex_none().text_color(t.dim).child(String(files.length)))
      .child(svg(K.ICON(collapsed ? "chevron-right" : "chevron-down")).size(12).flex_none().text_color(t.dim));
  }

  discardOf(files) {
    return { type: "discard", tracked: files.filter((f) => !f.untracked).map((f) => f.path), untracked: files.filter((f) => f.untracked).map((f) => f.path) };
  }

  hovered(key, on, cx) {
    if (on) this.hover = key; else if (this.hover === key) this.hover = null; else return;
    cx.notify();
  }

  // A Crew row: the status letter in the 16px gutter, the name (12 medium: a long list in semibold reads as a wall), its folder (11 dim), hover actions.
  fileRow(file, group, i, t) {
    const g = this.g, key = `${group}-${i}`, hovered = this.hover === key;
    const selected = g.diffFile?.path === file.path && g.diffFile.group === group;
    const slash = file.path.lastIndexOf("/"), name = file.path.slice(slash + 1), folder = slash >= 0 ? file.path.slice(0, slash) : "";
    return h_flex().id(`git-file-${key}`).h(28).flex_none().px(8).gap(8).items_center().rounded(8).cursor_pointer()
      .when(selected, (e) => e.bg(t.selected)).hover((s) => s.bg(selected ? t.selected : t.hover))
      .accessibility_label(`${file.path} (${STATUS_WORD[file.status] ?? file.status})`)
      .on_hover((h, cx) => this.hovered(key, h, cx))
      .on_click((_e, cx) => g.openFile(file, group, cx))
      .child(div().w(16).flex_none().text_center().text_size(K.SIZE.meta).font_semibold().text_color(statusColor(t, file.status)).child(file.status))
      .child(h_flex().flex_1().min_w(0).gap(8).items_center()
        .child(div().flex_none().max_w_full().truncate().text_size(K.SIZE.body).font_medium().text_color(file.status === "D" ? t.muted : t.foreground).child(name))
        .child(div().flex_1().min_w(0).truncate().text_size(K.SIZE.meta).text_color(t.dim).child(folder)))
      .when(hovered && group === "staged", (e) => e.child(this.rowButton(`git-unstage-${key}`, "minus", "Unstage", t,
        (_e, cx) => this.act({ type: "unstage", paths: [file.path] }, cx))))
      .when(hovered && group === "changes" && file.status !== "!", (e) => e
        .child(this.rowButton(`git-discard-${key}`, "discard", file.untracked ? "Delete" : "Discard changes", t, (_e, cx) => this.act(this.discardOf([file]), cx)))
        .child(this.rowButton(`git-stage-${key}`, "plus", "Stage", t, (_e, cx) => this.act({ type: "stage", paths: [file.path] }, cx))))
      .when(hovered && file.status === "!", (e) => e.child(this.rowButton(`git-resolve-${key}`, "plus", "Mark as resolved", t,
        (_e, cx) => this.markResolved(file, cx))));
  }

  group(key, title, files, t) {
    if (!files.length) return [];
    const rows = this.collapsed[key] ? [] : files.slice(0, MAX_ROWS).map((f, i) => this.fileRow(f, key, i, t));
    const more = !this.collapsed[key] && files.length > MAX_ROWS
      ? [div().h(24).flex_none().pl(32).flex().items_center().text_size(K.SIZE.meta).text_color(t.dim).child(`and ${files.length - MAX_ROWS} more`)] : [];
    return [this.groupHeader(key, title, files, t), ...rows, ...more];
  }

  render(t) {
    const g = this.g, { staged, changes, conflicts } = g.groups, clean = !staged.length && !changes.length && !conflicts.length;
    return v_flex().size_full().min_h(0)
      .child(this.commitBox(t))
      .when(clean, (e) => e.child(K.empty(t, { glyph: svg(K.ICON("circle-check")).size(20).text_color(t.dim), title: "No changes", hint: "Edits in this repository show up here" }).min_h(0)))
      .when(!clean, (e) => e.child(v_flex().id(`${g.listId}-changes`).flex_1().min_h(0).px(8).pt(4).pb(8).overflow_y_scrollbar()
        .children(this.group("staged", "Staged changes", staged, t))
        .children(this.group("changes", "Changes", [...conflicts, ...changes], t))));
  }
}
