// An action's dialog, opened with props { role: "dialog", action, ctx }: names
// to type, options to tick, a mode to pick, or a choice of actions (`buttons`:
// each runs its own action; one without an action cancels). Crew's dialog anatomy (kit dialog()). Git's error stays in the dialog so the person can fix it.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme } from "herdr";
import { dialogFor, initialValues, validate } from "./git.js";
import { perform } from "./act.js";
import { icon } from "./menu.js";
import * as K from "./kit.js";

export class Dialog {
  init(cx) {
    const { action, ctx } = props();
    this.spec = dialogFor(action, ctx);
    this.values = initialValues(action, ctx);
    this.focusedInput = 0;
    this.inputs = (this.spec.inputs ?? []).map((field, i) => {
      const state = InputState.new({ value: field.value ?? "" });
      state.on("change", (_e, cx) => { this.values[field.id] = state.value(); this.error = null; cx.notify(); });
      state.on("submit", (_e, cx) => this.confirm(cx));
      state.on("focus", (_e, cx) => { this.focusedInput = i; cx.notify(); });
      state.on("blur", (_e, cx) => { if (this.focusedInput === i) this.focusedInput = -1; cx.notify(); });
      return { field, state };
    });
    this.handle = cx.focus_handle();
    const first = this.inputs[0]?.state;
    if (first) {
      if (this.inputs[0].field.value) first.set_selected_range({ start: 0, end: this.inputs[0].field.value.length });
      first.focus();
      cx.timer.after(600, () => first.focus());
    } else this.handle.focus();
  }

  // chosen: the button that ran it, for a `buttons` dialog (its own action).
  confirm(cx, chosen = null) {
    if (this.busy) return;
    const { ctx, overlay } = props(), action = chosen ? chosen.action : props().action;
    if (!chosen && this.spec.buttons) return;
    const problem = validate(action, this.values, ctx);
    if (problem) { this.error = problem; cx.notify(); return; }
    this.busy = chosen ? chosen.label : true; this.error = null;
    cx.spawn(async (cx) => {
      const result = await perform(action, this.values, ctx, { toast: false });
      this.busy = false;
      if (result.ok) closeOverlay(overlay);
      else { this.error = result.message; cx.notify(); }
    });
    cx.notify();
  }

  danger() {
    if (this.spec.buttons) return false;
    const choice = this.spec.choice;
    return Boolean(this.spec.danger || choice?.options.find((o) => o.value === this.values[choice.id])?.danger);
  }

  // Crew's dialog: popover, the panel header with an Esc key, body p 16 gap 12, actions right (primary last).
  render() {
    const t = theme(), s = this.spec, d = K.dialog(t, "git-dialog", { title: s.title });
    const label = (text) => div().text_size(K.SIZE.meta).text_color(t.dim).child(text);
    // primary: the dialog's own action (danger: in theme blocked); else a plain button.
    const button = (id, text, primary, action, danger = this.danger()) => K.button(t, id, text, action, { primary, danger: primary && danger });
    return d.root.track_focus(this.handle).size_full()
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(props().overlay);
        else if (e.key === "enter" && this.focusedInput < 0) this.confirm(cx);
        else return;
        cx.stop_propagation();
      })
      .child(d.header)
      .child(d.body
        .when(Boolean(s.detail), (el) => el.child(div().text_size(K.SIZE.body).text_color(t.muted).child(s.detail)))
        .children(this.inputs.map(({ field, state }, i) => v_flex().gap(8)
          .child(label(field.label))
          .child(K.field(t, Input.new(state), this.focusedInput === i))))
        .when(Boolean(s.choice), (el) => el.child(v_flex().gap(8).child(label(s.choice.label)).child(v_flex().gap(4).children(s.choice.options.map((o) => {
          const on = this.values[s.choice.id] === o.value, edge = o.danger ? t.blocked : t.accent;
          return h_flex().id(`gd-choice-${o.value}`).h(38).px(12).gap(12).items_center().rounded(8).border_1().cursor_pointer()
            .border_color(on ? edge : t.border).bg(on ? t.selected : t.surface).hover((st) => st.border_color(on ? edge : t.input))
            .on_click((_e, cx) => { this.values[s.choice.id] = o.value; this.error = null; cx.notify(); })
            .child(div().size(14).flex_none().rounded(7).border_1().border_color(on ? edge : t.input).flex().items_center().justify_center()
              .when(on, (e) => e.child(div().size(6).rounded(3).bg(edge))))
            .child(div().text_size(K.SIZE.body).font_medium().child(o.label))
            .when(Boolean(o.detail), (e) => e.child(div().min_w(0).truncate().text_size(K.SIZE.meta).text_color(o.danger ? t.blocked : t.dim).child(o.detail)));
        })))))
        .children((s.checks ?? []).map((c) => {
          const on = Boolean(this.values[c.id]);
          return h_flex().id(`gd-check-${c.id}`).h(20).gap(8).items_center().cursor_pointer()
            .on_click((_e, cx) => { this.values[c.id] = !on; cx.notify(); })
            .child(div().size(14).flex_none().rounded(4).border_1().border_color(on ? t.accent : t.input).when(on, (e) => e.bg(t.accent)).flex().items_center().justify_center()
              .when(on, (e) => e.child(svg(icon("check")).size(10).text_color(t.accent_foreground))))
            .child(div().text_size(K.SIZE.body).text_color(t.foreground).child(c.label));
        }))
        .when(Boolean(this.error), (el) => el.child(div().text_size(K.SIZE.body).text_color(t.blocked).child(this.error))))
      .child(div().flex_1())
      .child(d.actions
        .when(!s.buttons, (e) => e
          .child(button("gd-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
          .child(button("gd-ok", this.busy ? "Working…" : s.confirm, true, (_e, cx) => this.confirm(cx))))
        .when(Boolean(s.buttons), (e) => e.children((s.buttons ?? []).map((b, i) => b.action
          ? button(`gd-button-${i}`, this.busy === b.label ? "Working…" : b.label, true, (_e, cx) => this.confirm(cx, b), Boolean(b.danger))
          : button(`gd-button-${i}`, b.label, false, () => closeOverlay(props().overlay))))));
  }
}
