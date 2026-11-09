// crew-kit: the Crew collection's look, as builders. Canonical copy: ~/.config/herdr-app/crew-kit/kit.js.
// Mods can't import across mod folders, so `crew-kit/sync.sh` copies this file into each mod as
// ./kit.js. Edit it HERE, then run sync.sh. Every value comes from the Claude Crew panel.
//
// Anatomy (DESIGN.md has the why):
//   panel    rounded 10, background, 1px border, 13px text            panel(t, id)
//   header   42px, px 16, gap 8, border-bottom; glyph · title · count pill · spacer · status
//   card     rounded 8, surface, 1px border; hover → input border; focused → accent border
//   row      36px title row, 16px icon gutter (spinner or 8px dot), 13px semibold title
//   line     12px, indented 36 (under the title, past the gutter)
//   meta     11px dim; micro 10.5px (pills, stats, percentages)
//   footer   px 12, py 8, border-top
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";

export const CORAL = "#D97757"; // Claude's brand: live Claude states only, never decoration
export const ICON = (name) => `mods/workspace-chrome/${name}.svg`; // shipped icon set, kept by Herdr

// Type scale and spacing. Nothing else: 4/8/12/16 rhythm, 13/12/11/10.5 text.
export const SIZE = { title: 13, body: 12, meta: 11, micro: 10.5 };

// ---- status ---------------------------------------------------------------------------------
/** The dot color for an agent / tab / space status (working draws a spinner instead). */
export const statusColor = (t, s) => ({ working: t.working, blocked: t.blocked, done: t.done, idle: t.idle })[s] ?? t.dim;

export const spinner = (color, size = 12) => svg(ICON("spinner")).size(size).flex_none().text_color(color).spin(900);
export const dot = (color, size = 8) => div().size(size).flex_none().rounded(size / 2).bg(color);

/** The 16px gutter every row starts with: a spinner while working, else a status dot (or any element). */
export function gutter(t, status, color) {
  const inner = status === "working" ? spinner(color ?? t.working) : status && typeof status === "string" ? dot(color ?? statusColor(t, status)) : status ?? null;
  return div().w(16).flex_none().flex().justify_center().when(Boolean(inner), (el) => el.child(inner));
}

// ---- containers -----------------------------------------------------------------------------
/** A side panel: the bordered rounded card Crew, Files, Git and Tâches all are. */
export const panel = (t, id) => v_flex().id(id).size_full().min_h(0).rounded(10).overflow_hidden()
  .bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(SIZE.title);

/** A panel without its own frame, for sidebars and bars that sit on chrome. */
export const surfaceless = (t, id) => v_flex().id(id).size_full().min_h(0).bg(t.chrome).text_color(t.foreground).text_size(SIZE.title);

/**
 * Panel header: [glyph] Title [count] ............ [status].
 * glyph: an element (mascot, svg) or null; count: string for the bordered pill; status: element or string.
 */
export function header(t, { glyph, title, count, status, actions = [] }) {
  return h_flex().h(42).flex_none().px(16).gap(8).items_center().border_b(1).border_color(t.border)
    .when(Boolean(glyph), (el) => el.child(glyph))
    .child(div().flex_none().font_semibold().child(title))
    .when(count != null && count !== "", (el) => el.child(tag(t, count)))
    .child(div().flex_1().min_w(0))
    .when(Boolean(status), (el) => el.child(typeof status === "string" ? div().flex_none().text_size(SIZE.meta).text_color(t.dim).child(status) : status))
    .children(actions);
}

/** Live status for a header's right side: spinner + "n working" in the live color. */
export const liveStatus = (t, text, color) => h_flex().flex_none().gap(8).items_center()
  .child(spinner(color, 11)).child(div().text_size(SIZE.meta).text_color(color).child(text));

/** The scrolling body under a header: p 8, gap 8 between cards. */
export const list = (id) => v_flex().id(id).flex_1().min_h(0).overflow_y_scrollbar().p(8).gap(8);

/** A Crew card. Click handlers etc. are chained by the caller. */
export const card = (t, id, { focused = false, accent } = {}) => v_flex().id(id).flex_none().rounded(8).bg(t.surface).border_1()
  .border_color(focused ? t.accent : accent ?? t.border).hover((s) => s.border_color(focused ? t.accent : t.input));

/** A card's 36px title row: gutter · title · ...extras (pills, tags, meta pushed right by the caller). */
export function titleRow(t, { status, color, title, muted = false, extras = [] }) {
  return h_flex().h(36).px(12).gap(8).items_center()
    .child(gutter(t, status, color))
    .child(div().flex_1().min_w(48).truncate().font_semibold().text_size(SIZE.title).text_color(muted ? t.muted : t.foreground).child(title))
    .children(extras);
}

/** The 12px line under a title, past the gutter. */
export const line = (t, text, color) => div().px(12).pl(36).pb(12).truncate().text_size(SIZE.body).text_color(color ?? t.muted).child(text);

/**
 * A plain list row (sidebars, menus, subagent rows): px 8, py 4, rounded 8, hover fill.
 * Two-line when `sub` is given: 12px semibold title, 11px sub-line indented past the gutter.
 */
export function row(t, id, { status, color, icon, title, sub, subColor, right = [], active = false, muted = false }) {
  const top = h_flex().gap(8).items_center()
    .child(icon !== undefined ? div().w(16).flex_none().flex().justify_center().when(Boolean(icon), (el) => el.child(icon)) : gutter(t, status, color))
    .child(div().flex_1().min_w(0).truncate().text_size(SIZE.body).font_semibold().text_color(muted ? t.muted : t.foreground).child(title))
    .children(right);
  return v_flex().id(id).gap(4).px(8).py(4).rounded(8).cursor_pointer()
    .when(active, (el) => el.bg(t.selected)).hover((s) => s.bg(active ? t.selected : t.hover))
    .child(top)
    .when(Boolean(sub), (el) => el.child(div().pl(24).truncate().text_size(SIZE.meta).text_color(subColor ?? t.dim).child(sub)));
}

/** A group label inside a list: 11px muted words, count on the right. Sentence case, never tracked caps. */
export const section = (t, id, label, count, { onClick, open } = {}) => h_flex().id(id).px(8).pt(8).pb(4).gap(8).items_center()
  .text_size(SIZE.meta).text_color(t.muted)
  .when(Boolean(onClick), (el) => el.cursor_pointer().rounded(6).hover((s) => s.text_color(t.foreground)).on_click(onClick))
  .child(div().flex_1().min_w(0).truncate().child(label))
  .when(count != null, (el) => el.child(div().flex_none().text_color(t.dim).child(String(count))))
  .when(open != null, (el) => el.child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(12).flex_none().text_color(t.dim)));

/** Footer band: border-top, px 12, py 8. */
export const footer = (t, id) => v_flex().id(id).flex_none().px(12).py(8).gap(8).border_t(1).border_color(t.border);

/** Empty state: a glyph, 13px muted sentence, 11px dim hint. */
export const empty = (t, { glyph, title, hint }) => v_flex().flex_1().items_center().justify_center().gap(12).p(24)
  .when(Boolean(glyph), (el) => el.child(glyph))
  .child(div().text_size(SIZE.title).text_color(t.muted).child(title))
  .when(Boolean(hint), (el) => el.child(div().text_size(SIZE.meta).text_color(t.dim).child(hint)));

/** Error band under a header. */
export const errorBand = (t, text) => div().px(16).py(8).text_size(SIZE.meta).text_color(t.blocked).border_b(1).border_color(t.border).child(text);

// ---- small parts ----------------------------------------------------------------------------
/** Bordered tag: counts, tab names, keys. */
export const tag = (t, label, color) => div().flex_none().px(6).py(2).rounded(4).border_1().border_color(color ? color + "66" : t.border)
  .text_size(SIZE.micro).text_color(color ?? t.muted).child(label);

/** Filled pill (the model pill): tinted background in its color. */
export const pill = (t, label, color) => h_flex().flex_none().h(16).px(6).items_center().rounded(4).text_size(SIZE.micro).font_medium()
  .bg((color ?? t.dim) + "22").text_color(color ?? t.muted).child(label);

/** Round pill with an icon (the run timer): live = tinted in `color`. */
export const roundPill = (t, { icon, label, live = false, color }) => h_flex().flex_none().h(20).px(8).gap(4).items_center().rounded(10)
  .when(live, (el) => el.bg(color + "1f")).border_1().border_color(live ? color + "55" : t.border)
  .when(Boolean(icon), (el) => el.child(svg(ICON(icon)).size(11).text_color(live ? color : t.dim)))
  .child(div().text_size(SIZE.micro).font_medium().text_color(live ? color : t.muted).child(label));

/** "label value" pair, 10.5 dim + 11 muted. */
export const stat = (t, label, value) => h_flex().flex_none().gap(4).items_baseline()
  .child(div().text_size(SIZE.micro).text_color(t.dim).child(label))
  .child(div().text_size(SIZE.meta).text_color(t.muted).child(value));

/** A 4px bar whose fill is a true fraction of any width (flex, no math). */
export function bar(t, id, frac, color, { live = false } = {}) {
  const f = Math.max(0, Math.min(1, frac ?? 0));
  return h_flex().id(id).flex_1().min_w(24).h(4).rounded(2).overflow_hidden().bg(t.border)
    .child(div().h_full().rounded(2).flex_basis(0).flex_grow(f).bg(color).when(live, (b) => b.loop("opacity", { from: 0.55, to: 1, period: 1200 })))
    .child(div().h_full().flex_basis(0).flex_grow(1 - f));
}

/** Icon button (26px, rounded 6), like the tab bar's panel buttons. */
export const iconButton = (t, id, icon, onClick, { tip, on = false, size = 14 } = {}) => div().id(id).size(26).flex_none().flex().items_center().justify_center()
  .rounded(6).cursor_pointer().when(on, (el) => el.bg(t.selected)).text_color(on ? t.foreground : t.muted)
  .hover((s) => s.bg(t.hover).text_color(t.foreground))
  .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(onClick)
  .when(Boolean(tip), (el) => el.tooltip(tip).accessibility_label(tip))
  .child(typeof icon === "string" ? svg(icon.includes("/") ? icon : ICON(icon)).size(size) : icon);

/** Text button. primary: solid; else raised with an input border. h 28, rounded 6, 12px. */
export const button = (t, id, label, onClick, { primary = false, danger = false, disabled = false } = {}) => h_flex().id(id).h(28).px(12).flex_none()
  .items_center().justify_center().rounded(6).text_size(SIZE.body).font_medium()
  .bg(danger ? t.blocked : primary ? t.solid : t.raised).border_1().border_color(danger ? t.blocked : primary ? t.solid : t.input)
  .text_color(danger ? t.background : primary ? t.solid_foreground : t.foreground)
  .when(disabled, (el) => el.opacity(0.45)).when(!disabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(onClick))
  .child(label);

/** A text field frame for an `Input.new(state)`: h 32, rounded 8, accent border while focused. */
export const field = (t, input, focused) => input.h(32).px(10).rounded(8).border_1().border_color(focused ? t.accent : t.input)
  .bg(t.background).text_size(SIZE.body).text_color(t.foreground);

/** A keyboard hint: ⌘K, Esc, ⏎. */
export const kbd = (t, label) => div().flex_none().px(5).h(18).flex().items_center().rounded(4).border_1().border_color(t.border)
  .text_size(SIZE.micro).text_color(t.dim).child(label);

// ---- dialogs and menus ----------------------------------------------------------------------
/** A dialog: popover background, the panel header anatomy, then the body (p 16, gap 12). */
export const dialog = (t, id, { title, glyph, status }) => ({
  root: v_flex().id(id).w_full().min_h(0).bg(t.popover).text_color(t.foreground).text_size(SIZE.title),
  header: header(t, { glyph, title, status: status ?? kbd(t, "Esc") }),
  body: v_flex().p(16).gap(12),
  actions: h_flex().px(16).pb(16).gap(8).justify_end(),
});

/** A menu item: 30px, rounded 6, icon gutter, label, shortcut on the right. */
export const menuItem = (t, id, { icon, label, hint, danger = false, disabled = false, onClick }) => h_flex().id(id).h(30).px(8).gap(8)
  .items_center().rounded(6).text_size(SIZE.body).text_color(disabled ? t.dim : danger ? t.blocked : t.foreground)
  .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(onClick))
  .child(div().w(16).flex_none().flex().justify_center().when(Boolean(icon), (el) => el.child(typeof icon === "string" ? svg(icon.includes("/") ? icon : ICON(icon)).size(14).text_color(danger ? t.blocked : t.muted) : icon)))
  .child(div().flex_1().min_w(0).truncate().child(label))
  .when(Boolean(hint), (el) => el.child(div().flex_none().text_size(SIZE.micro).text_color(t.dim).child(hint)));

export const menuSeparator = (t) => div().h(1).mx(8).my(4).bg(t.border);

// ---- time -----------------------------------------------------------------------------------
/** "42s", "4m 12s", "1h 04m": a running clock. */
export const clock = (s) => {
  s = Math.max(0, Math.floor(s));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
};
/** "8s", "12m", "3h05": how long ago (ms or ISO or unix seconds). */
export function ago(when, now = Date.now()) {
  const ms = typeof when === "number" ? (when < 1e12 ? when * 1000 : when) : Date.parse(when ?? "");
  if (!ms) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${Math.floor(m / 1440)}d`;
}
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
