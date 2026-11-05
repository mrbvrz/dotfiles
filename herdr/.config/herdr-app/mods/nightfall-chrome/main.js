// Nightfall's sidebar ends. Top (the "brand" block, 66 px): the Herdr logo and the fold
// button, then Search and the filter (both the picker) and + for a new space. New
// agents start from the + on the tab bar. With props().footer: Settings, Machines and
// the shown space's machine; on the rail only the top shows.
// Corners are 4 px.

import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout, keys, settings, spaces } from "herdr";

const ICONS = "mods/nightfall-chrome";
const R = 4;
// The brightest text: white on a dark theme, the theme's text on a light one.
const bright = (t) => (settings()?.dark === false ? t.foreground : t.ansi15);

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

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 300) : window()?.platform === "macos" ? 76 : 52 });
}

// The picker's key as people read it ("ctrl-shift-k" -> "Ctrl Shift K"), from keys.json.
function pickerKey() {
  const k = keys().find((b) => b.action === "mod.open:picker" && b.section === "global") ?? keys().find((b) => b.action === "mod.open:picker");
  if (!k) return null;
  const mac = window()?.platform === "macos";
  const word = { ctrl: "Ctrl", shift: "Shift", alt: mac ? "⌥" : "Alt", cmd: "⌘", super: "Super" };
  return k.keys.split("-").map((p) => word[p] ?? p.toUpperCase()).join(" ");
}

const openPicker = () => run("mod.open", { name: "picker" });

export default class NightfallChrome extends View {
  // A square icon button; presses stop here so the block's window drag doesn't take them.
  button(id, icon, action, { size = 28, icon: glyph = 14, color, tip } = {}) {
    const t = theme();
    return div().id(id).size(size).flex_none().flex().items_center().justify_center().rounded(R)
      .text_color(color ?? t.dim).hover((s) => s.bg(t.hover).text_color(bright(t)))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action)
      .child(svg(`${ICONS}/${icon}.svg`).size(glyph));
  }

  // 36 px with a border on top, 8 px taller than the status bar beside it on purpose.
  footer(t, collapsed) {
    const bar = h_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border);
    if (collapsed) return bar;
    const ready = Boolean(updates().app.ready);
    const machine = spaces().find((s) => s.active)?.machine ?? "This computer";
    const settingsButton = div().relative().flex_none()
      .child(this.button("settings", "settings", () => run("app.settings"), { size: 30, icon: 18, tip: ready ? "Settings (update ready)" : "Settings" }))
      .when(ready, (el) => el.child(div().absolute().top(3).right(3).size(6).rounded(R).bg(t.accent)));
    return bar.px(6).gap(4).items_center()
      .child(settingsButton)
      .child(this.button("machines", "monitor", () => run("mod.open", { name: "machine-add" }), { size: 30, icon: 18, tip: "Machines" }))
      .child(div().flex_1())
      .child(div().pr(10).min_w(0).truncate().text_size(13).text_color(t.muted).child(machine));
  }

  // The rail, as in T3: the Herdr logo, which turns into the open button under the
  // pointer, and Search, in the rows of the tab bar (38) and the pane header (28).
  // On macOS the traffic lights take the first row, so both buttons share the second.
  rail(t, mac) {
    const open = div().id("sidebar-open").size(28).flex_none().flex().items_center().justify_center().rounded(R)
      .text_color(bright(t)).hover((s) => s.bg(t.hover)).tooltip("Show sidebar")
      .on_hover((hovered, cx) => { this.logoHovered = hovered; cx.notify(); })
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(toggleSidebar)
      .child(mac || this.logoHovered ? svg(`${ICONS}/sidebar.svg`).size(14) : image("frame/welcome/herdr.png").size(16).rounded(R));
    const search = this.button("search", "search", openPicker, { size: 24, tip: "Search" });
    return v_flex().size_full().bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().h(38).flex_none().justify_center().items_center().when(!mac, (el) => el.child(open)))
      .child(h_flex().h(28).flex_none().justify_center().items_center().gap(2).when(mac, (el) => el.child(open)).child(search));
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    if (props()?.footer) return this.footer(t, collapsed);
    const mac = window()?.platform === "macos";
    if (collapsed) return this.rail(t, mac);
    const hint = pickerKey();
    // 38 + 28 px: the same lines as the tab bar and the pane header beside it.
    const top = h_flex().h(38).flex_none().pl(mac ? 76 : 14).pr(6).gap(9).items_center()
      .child(image("frame/welcome/herdr.png").size(16).rounded(R).flex_none())
      .child(div().flex_1().text_size(13.5).font_semibold().text_color(bright(t)).child("Herdr"))
      .child(this.button("sidebar-toggle", "sidebar", toggleSidebar, { tip: "Hide sidebar" }));
    const search = h_flex().id("search").flex_1().min_w(0).h(24).px(9).gap(8).items_center()
      .bg(t.canvas).border(1).border_color(t.input).rounded(R)
      .text_size(12.5).text_color(t.dim).cursor_pointer()
      .hover((s) => s.text_color(t.muted))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(openPicker)
      .tooltip(hint ? `Search (${hint})` : "Search")
      .child(svg(`${ICONS}/search.svg`).size(13).flex_none())
      .child(div().flex_1().truncate().child("Search"));
    return v_flex().size_full().bg(t.chrome).border_b(1).border_color(t.border)
      .child(top)
      .child(h_flex().h(28).flex_none().px(8).pb(4).gap(2).items_center()
        .child(search)
        .child(this.button("filter", "list-filter", openPicker, { size: 24, tip: "Find a space" }))
        .child(this.button("space-new", "plus", () => run("space.new"), { size: 24, tip: "New space" })));
  }
}
