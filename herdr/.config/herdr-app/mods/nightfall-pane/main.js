// Nightfall's pane header (28 px): the program's icon, the agent's name or the
// terminal's title, the folder and the agent's state dot. The focused pane's header
// is lighter (theme hover) with a white name; the rest sit on the chrome color.
// No colored border. On hover: split right, split down, zoom, close.
// Props from the app: { pane, terminal }. Click: focus the pane.
// Corners are 4 px.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home, settings } from "herdr";

const R = 4;
const ICONS = "mods/nightfall-chrome";
const bright = (t) => (settings()?.dark === false ? t.foreground : t.ansi15);

// Agent state, the same table in every Nightfall mod: its theme color, the color of
// its time on a card, and how that time reads.
const STATES = {
  blocked: { color: "blocked", tone: "blocked", since: (m) => `waiting ${m}` },
  working: { color: "working", tone: "dim", since: (m) => `working ${m}` },
  done: { color: "done", tone: "done", since: (m) => `done ${m} ago` },
  idle: { color: "idle", tone: "dim", since: null },
};

// The one state mark: a dot (blocked, done), a turning arc (working), a ring (idle).
function dot(t, st, size = 9, spin = size + 2) {
  const color = t[STATES[st]?.color] ?? t.dim;
  if (st === "working") return svg(`${ICONS}/dot-spin.svg`).size(spin).flex_none().text_color(color).spin(900);
  if (st === "idle") return div().size(size).flex_none().rounded_full().border(1.5).border_color(color);
  return st ? div().size(size).flex_none().rounded_full().bg(color) : null;
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

export default class Pane extends View {
  init() { this.hovered = false; }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, icon, command, args) {
    return div()
      .id(id)
      .size(22)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(R)
      .text_color(t.dim)
      .hover((s) => s.bg(t.input).text_color(bright(t)))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/nightfall-pane/${icon}.svg`).size(13));
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = p.pane;
    const on = p.focused;
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .pl(10)
      .pr(3)
      .gap(8)
      .items_center()
      .bg(on ? t.raised : t.chrome)
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .text_color(t.dim)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(on ? bright(t) : t.muted).child(name))
      .child(div().flex_1().min_w(0).truncate().child(folder(p.cwd)))
      .when(Boolean(st) && st !== "idle", (el) => el.child(h_flex().w(14).flex_none().justify_center().child(dot(t, st, 9))))
      .when(this.hovered, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
  }
}
