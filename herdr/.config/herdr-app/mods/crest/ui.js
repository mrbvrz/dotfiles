// crest: drawing. Every function returns a GPUI element and keeps no state.
import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";

const ICON = (name) => `mods/workspace-chrome/${name}.svg`;

/** A status color that exists in every theme. */
export function statusColor(t, status) {
  return status === "blocked" ? (t.blocked ?? t.ansi1) : status === "done" ? (t.done ?? t.ansi2) : (t.working ?? t.accent);
}

/** The pulse that says "look here" (blocked) or "busy" (working). Done stays still. */
function pulse(el, status) {
  if (status === "blocked") return el.loop("opacity", { from: 0.35, to: 1, period: 900 });
  if (status === "working") return el.loop("opacity", { from: 0.3, to: 0.9, period: 1800 });
  return el;
}

/** The status dot that sits on a tile's corner, with a ring in the sidebar color so it reads on any picture. */
export function dot(t, status, size = 8) {
  return pulse(
    div().absolute().right(-2).bottom(-2).size(size).rounded(size / 2).bg(statusColor(t, status))
      .border(1.5).border_color(t.chrome ?? t.background),
    status,
  );
}

/**
 * A space's tile: its picture (rounded like the rest), else a letter on its color.
 * @param {{ t: any, size: number, radius: number, icon: string | null, letter: string, fill: string, status?: string | null }} o
 */
export function tile({ t, size, radius, icon, letter, fill, status }) {
  const face = icon
    ? h_flex().size(size).flex_none().rounded(radius).overflow_hidden().child(image(icon).size(size).rounded(radius))
    : h_flex().size(size).flex_none().rounded(radius).bg(fill).items_center().justify_center()
      .text_size(Math.round(size * 0.5)).font_bold().text_color("#ffffff").child(letter);
  return div().relative().size(size).flex_none()
    .child(face)
    .when(Boolean(status), (el) => el.child(dot(t, status, size >= 22 ? 8 : 7)));
}

/** Small tiles in a row: who is inside a shut folder. */
export function stack(t, icons, more) {
  return h_flex().flex_none().gap(3).items_center()
    .children(icons.map((icon) => h_flex().size(15).flex_none().rounded(4).overflow_hidden().child(image(icon).size(15).rounded(4))))
    .when(more > 0, (el) => el.child(div().pl(1).text_size(10.5).text_color(t.dim).child(`+${more}`)));
}

/** A filled two-tone folder in the folder's color: the back sheet lighter, the front solid. Shut folders sit a little lower. */
export function folderGlyph(color, shut) {
  return div().relative().size(16).flex_none()
    .child(svg("mods/crest/icons/folder-back.svg").size(16).absolute().left(0).top(0).text_color(color).opacity(0.5))
    .child(svg("mods/crest/icons/folder-front.svg").size(16).absolute().left(0).top(0).text_color(color).opacity(shut ? 0.75 : 1));
}

/**
 * A folder header: its name in the folder's color and how many spaces it holds.
 * Click folds it (Alt+click: only this one stays open). Drag it onto another header to reorder.
 * While a space is dragged, it is a drop target; while a folder is dragged, a line shows where it lands.
 */
export function folderHeader({ t, key, label, color, count, shut, status, icons, more, hot, landing, hovered, onHover, onAdd, onClick, onMenu, onDown, onMove, onUp }) {
  return v_flex().flex_none().mt(8).relative()
    .child(h_flex().id(`crest-folder-${key}`).h(30).flex_none().pl(10).pr(8).gap(7).items_center().rounded(8)
      .bg(hot ? t.selected : (t.surface ?? t.raised ?? t.hover))
      .hover((s) => s.bg(t.hover))
      .on_click(onClick)
      .on_mouse_down("left", onDown)
      .on_mouse_down("right", onMenu)
      .on_mouse_move(onMove)
      .on_mouse_up("left", onUp)
      .on_hover(onHover)
      .child(folderGlyph(color, shut))
      .child(div().flex_shrink(1).min_w(0).truncate().font_medium().text_size(12.5).text_color(t.foreground).child(label))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(String(count)))
      .child(div().flex_1().min_w(4))
      .when(hovered, (el) => el.child(iconButton({ t, id: `crest-fadd-${key}`, icon: "plus", tip: "Add spaces to this folder", onClick: onAdd })))
      .when(shut && icons.length > 0 && !hovered, (el) => el.child(stack(t, icons, more)))
      .when(Boolean(status) && shut, (el) => el.child(pulse(div().size(7).flex_none().rounded(4).bg(statusColor(t, status)), status)))
      .child(svg(ICON(shut ? "chevron-right" : "chevron-down")).size(11).flex_none().text_color(t.dim)))
    .when(landing, (el) => el.child(div().absolute().left(4).right(4).top(-5).h(2).rounded(1).bg(t.accent)));
}

/** An empty folder of your own: a little room to drop into, no words. */
export function emptyHint(_t, name) {
  return div().id(`crest-empty-${name}`).h(10).flex_none();
}

/** `#123` in the color of its state; click opens it. */
export function prChip(t, pr, onClick) {
  const color = pr.state === "merged" ? t.ansi5 : pr.state === "closed" ? t.ansi1 : pr.state === "draft" ? t.dim : t.ansi2;
  return div().id(`crest-pr-${pr.number}`).flex_none().text_size(11).text_color(color).cursor_pointer()
    .tooltip(`PR #${pr.number}, ${pr.state}`)
    .hover((s) => s.opacity(0.7))
    .on_click(onClick)
    .child(`#${pr.number}`);
}

/** Uncommitted changes: a small dot, the count on hover. */
export function dirtyMark(t, n) {
  return div().flex_none().size(5).rounded(3).bg(t.warning ?? t.ansi3).tooltip(`${n} uncommitted`);
}

/** What an agent is doing, the way the Agents list says it. */
export function agentStatus(t, status) {
  if (status === "working") return svg(ICON("spinner")).size(11).flex_none().text_color(t.working ?? t.accent).spin(900);
  if (status === "blocked") return pulse(div().size(7).mx(2).flex_none().rounded(4).bg(t.blocked ?? t.ansi1), "blocked");
  if (status === "done") return div().size(7).mx(2).flex_none().rounded(4).bg(t.done ?? t.ansi2);
  return div().size(7).mx(2).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
}

function programIcon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

/**
 * One line under a space: an agent (status, icon, what it's on, how long) or a running program.
 * The thin rail on the left ties it to the space above.
 */
export function subLine({ t, id, program, text, age, status, last, hovered, armed, onHover, onClose, onClick }) {
  const pic = programIcon(program, 13, t.muted);
  return h_flex().id(id).h(24).flex_none().pl(19).pr(8).items_center().rounded(6)
    .hover((s) => s.bg(t.hover))
    .on_click(onClick)
    .child(div().w(10).h(24).flex_none().border_l(1.5).border_color(t.border).when(last, (el) => el.h(12).border_b(1.5).rounded_bl(5).mb(12)))
    .child(h_flex().w(18).flex_none().justify_center().items_center().child(status ? agentStatus(t, status) : svg(ICON("terminal")).size(11).text_color(t.dim)))
    .when(Boolean(pic), (el) => el.child(div().mr(6).child(pic)))
    .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(status === "blocked" ? t.foreground : t.muted).child(text))
    .on_hover(onHover)
    .when(Boolean(age) && !hovered, (el) => el.child(div().flex_none().pl(6).text_size(10.5).text_color(t.dim).child(age)))
    .when((hovered || armed) && Boolean(onClose), (el) => el.child(iconButton({ t, id: `${id}-x`, icon: "x", tip: armed ? "Click again to close" : "Close this terminal", danger: armed, onClick: onClose })));
}

/** The space after the last folder: drop here to move a folder (or a space) to the very end. */
export function endZone({ t, landing, onMove, onUp }) {
  return div().id("crest-end").h(36).flex_none().relative()
    .on_mouse_move(onMove)
    .on_mouse_up("left", onUp)
    .when(landing, (el) => el.child(div().absolute().left(4).right(4).top(4).h(2).rounded(1).bg(t.accent)));
}

/** A small square button that shows on hover: an icon, a tooltip, no text. */
export function iconButton({ t, id, icon, tip, onClick, danger }) {
  return h_flex().id(id).size(20).flex_none().rounded(5).items_center().justify_center().cursor_pointer()
    .text_color(danger ? (t.blocked ?? t.ansi1) : t.dim).tooltip(tip)
    .when(Boolean(danger), (el) => el.bg((t.blocked ?? "#ef4444") + "22"))
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_mouse_up("left", (_e, cx) => cx.stop_propagation())
    .on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); })
    .child(svg(icon.includes("/") ? icon : ICON(icon)).size(13));
}

/** A folder in the narrow sidebar: its glyph, centered; the name on hover; a dot when shut and an agent there needs you. */
export function compactFolder({ t, key, label, color, shut, status, onClick, onMenu }) {
  return h_flex().id(`crest-cfolder-${key}`).h(26).w_full().flex_none().justify_center().items_center().rounded(7).relative()
    .tooltip(label)
    .hover((s) => s.bg(t.hover))
    .on_click(onClick)
    .on_mouse_down("right", onMenu)
    .child(folderGlyph(color, shut))
    .when(shut && Boolean(status), (el) => el.child(pulse(div().absolute().right(10).top(5).size(6).rounded(3).bg(statusColor(t, status)), status)));
}

/** A folder in the narrow sidebar: a rounded column holding its glyph and its spaces, so the group is visible. */
export function compactGroup(t, key, head, members) {
  return h_flex().id(`crest-cgroup-${key}`).mt(6).flex_none().justify_center()
    .child(v_flex().w(44).flex_none().py(3).gap(1).items_center().rounded(12).bg(t.surface ?? t.raised ?? t.hover)
      .child(head)
      .children(members));
}
