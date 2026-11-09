// The "Set icon…" dialog: an image path, typed, pasted or dropped. Enter sets, Esc cancels.
// Opened as a dialog of this mod with props { view: "pick", space }.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme, spaces, home } from "herdr";
import { normalizePath } from "./avatars.js";
import { setIcon } from "./files.js";

export class PickIcon {
  init(p, cx) {
    this.id = p?.space;
    this.error = null;
    this.busy = false;
    this.input = InputState.new({ placeholder: "~/Pictures/icon.png" });
    this.input.on("submit", (_e, cx) => this.submit(cx));
    this.input.on("change", (_e, cx) => { if (this.error) { this.error = null; cx.notify(); } });
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  submit(cx) {
    if (this.busy) return;
    const path = normalizePath(this.input.value(), home());
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const error = await setIcon(this.id, path).catch((e) => `Couldn't set it: ${e?.message ?? e}`);
      this.busy = false;
      if (!error) return closeOverlay(props().overlay);
      this.error = error;
      cx.notify();
    });
  }

  key(e, cx) {
    if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const name = spaces().find((s) => s.id === this.id)?.name ?? "space";
    const label = (text) => div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child(text);
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover(s => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("pick").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_drop((e, cx) => { if (e.paths?.[0]) { this.input.set_value(e.paths[0]); this.error = null; cx.notify(); } })
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().child(`Icon for ${name}`))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(label("Image file"))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(div().pt(6).text_size(11.5).text_color(this.error ? t.blocked : t.dim)
        .child(this.error ?? "PNG, JPG, GIF, WebP or SVG. Paste a path or drop a file here."))
      .child(h_flex().pt(20).gap(8).justify_end()
        .child(button("pk-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("pk-save", this.busy ? "Setting…" : "Set icon", true, (_e, cx) => this.submit(cx))));
  }
}
