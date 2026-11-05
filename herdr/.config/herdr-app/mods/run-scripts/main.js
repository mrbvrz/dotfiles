// run-scripts: an Android Studio–style run control for JavaScript projects, for any layout.
// As a block (a bar) it shows "▾ script ▶" while the focused terminal's folder, or one above
// it, has a package.json with scripts, and nothing otherwise. ▶ runs the chosen script in a
// new terminal tab beside the shown one; ▾ opens this mod as a popup listing every script.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, theme, layout, props, closeOverlay, exec, notify, window } from "herdr";
import { MOD, findProject, control, selectedScript, recentScripts, select, runScript, commandFor } from "./scripts.js";

const ICON = (name) => `mods/${MOD}/${name}.svg`;

function where() {
  const f = focused(), space = spaces().find((s) => s.active);
  let pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  if (pane && !pane.terminal) pane = panes().find((p) => p.tab === pane.tab && p.terminal && p.cwd) ?? null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd ?? f?.cwd ?? space?.folder ?? null, on };
}

// package.json in the system's default app (this machine only).
function openFile(path, on) {
  if (on) { notify({ title: "package.json is on another machine", body: path, level: "info", timeout: 3000 }); return; }
  const platform = window()?.platform;
  const [cmd, args] = platform === "macos" ? ["open", ["--", path]] : platform === "windows" ? ["explorer.exe", [path.replace(/\//g, "\\")]] : ["xdg-open", [path]];
  exec(cmd, args).catch(() => notify({ title: "Could not open package.json", body: path, level: "error", timeout: 3000 }));
}

// Corners follow the shown layout's pane frame: square in a flush layout, rounded in a card one.
function frameRadius() {
  let pane = null;
  const walk = (n) => { if (!n || pane) return; if (n.content?.tab && n.content.pane) pane = n.content.pane; for (const c of n.children ?? []) walk(c); };
  try { walk(layout()); } catch {}
  const r = Number(pane?.radius ?? 6);
  return Math.max(0, Math.min(6, Number.isFinite(r) ? r : 6));
}

export default class RunScripts extends View {
  init(_props, cx) {
    this.popup = props()?.popup ?? null;
    if (this.popup) return;
    this.project = null;
    cx.timer.every(15000, (cx) => this.detect(cx, true));
  }

  // Looks again when the focused folder changes, and every 15 s for edited scripts.
  detect(cx, force = false) {
    const { cwd, on } = where(), key = JSON.stringify([cwd, on]);
    if ((key === this.key && !force) || this.detecting) return;
    this.key = key; this.detecting = true;
    cx.spawn(async (cx) => {
      try { const p = await findProject(cwd, on); if (this.key === key) this.project = p; }
      catch { if (this.key === key) this.project = null; }
      finally { this.detecting = false; cx.notify(); }
    });
  }

  renderPopup() {
    const t = theme(), R = frameRadius(), p = this.popup.project, close = () => closeOverlay(props().overlay);
    const chosen = selectedScript(p).name, recent = recentScripts(p);
    const caption = (text) => div().px(10).pt(8).pb(3).text_size(10.5).font_semibold().text_color(t.dim).child(text);
    const row = (s, key) => h_flex().id(`rs-${key}-${s.name}`).h(30).flex_none().pl(10).pr(4).gap(8).items_center().rounded(R).cursor_pointer()
      .when(s.name === chosen, (el) => el.bg(t.selected)).when(s.name !== chosen, (el) => el.hover((st) => st.bg(t.hover)))
      .on_click(() => { select(p, s.name); close(); })
      .child(div().flex_none().max_w(130).truncate().text_size(12.5).text_color(t.foreground).child(s.name))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(s.cmd))
      .child(div().id(`rs-run-${key}-${s.name}`).size(24).flex_none().flex().items_center().justify_center().rounded(R).tooltip("Run in a new tab")
        .hover((st) => st.bg(t.raised)).on_click((_e, cx) => { cx.stop_propagation(); close(); runScript(p, s.name, cx); })
        .child(svg(ICON("play")).size(13).text_color(t.ansi2)))
      .child(div().id(`rs-split-${key}-${s.name}`).size(24).flex_none().flex().items_center().justify_center().rounded(R).tooltip("Run beside the focused pane")
        .hover((st) => st.bg(t.raised)).on_click((_e, cx) => { cx.stop_propagation(); close(); runScript(p, s.name, cx, "split"); })
        .child(svg(ICON("columns-2")).size(13).text_color(t.dim)));
    return v_flex().id("rs-menu").size_full().p(5).bg(t.popover ?? t.surface).text_color(t.foreground)
      .child(h_flex().px(10).pt(4).pb(2).gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12).font_medium().child(p.name))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(commandFor(p.pm, "…").slice(0, -1).join(" "))))
      // The popup sizes to its content, so the list states its own height (a flex_1 list
      // would get none); it scrolls past 12 rows.
      .child(v_flex().id("rs-scroll").flex_none().h(Math.min(360, (recent.length + p.scripts.length) * 30 + (recent.length ? 2 : 1) * 25)).overflow_y_scrollbar()
        .when(recent.length > 0, (el) => el.child(caption("RECENT")).children(recent.map((n) => row(p.scripts.find((s) => s.name === n), "recent"))))
        .child(caption("ALL SCRIPTS"))
        .children(p.scripts.map((s) => row(s, "all"))))
      .child(div().h(1).mx(6).my(4).flex_none().bg(t.border))
      .child(h_flex().id("rs-edit").h(28).flex_none().px(10).gap(8).items_center().rounded(R).cursor_pointer().text_size(12.5).hover((st) => st.bg(t.hover))
        .on_click(() => { close(); openFile(`${p.root}/package.json`, p.on); })
        .child(svg(ICON("file-json")).size(13).text_color(t.dim)).child("Open package.json"));
  }

  render(cx) {
    if (this.popup) return this.renderPopup();
    this.detect(cx);
    const t = theme();
    return h_flex().id(MOD).size_full().items_center().justify_center()
      .when(Boolean(this.project), (el) => el.child(control(t, frameRadius(), this.project)));
  }
}
