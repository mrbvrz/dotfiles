// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "pane" } } } }
// Shows the program's icon (the app's program table), the agent's name or
// the terminal's title, the folder, and the agent's status; buttons split, zoom and close
// this pane. Props from the app: { pane, terminal }. Click: focus the pane.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home, readTextFile, watchFolder, exec, setShared } from "herdr";

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
  init(_props, cx) {
    this.hovered = false;
    this.docCache = new Map();
    this.seenReqTs = 0;
    this.watchPreviewRequests(cx);
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  watchPreviewRequests(cx) {
    const dir = `${home()}/.local/state/herdr-preview`;
    cx.spawn(async (cx) => {
      try {
        await exec("mkdir", ["-p", dir]);
        for (;;) {
          await watchFolder(dir);
          try {
            const raw = await readTextFile(`${dir}/request.json`);
            if (raw) {
              const req = JSON.parse(raw);
              if (req.ts && req.ts !== this.seenReqTs) {
                this.seenReqTs = req.ts;
                const filePath = req.path;
                const fileName = req.file || (filePath ? filePath.split("/").pop() : "AGENTS.md");
                const cwd = req.cwd || (filePath ? filePath.replace(/\/[^/]+$/, "") : "");
                this.openSidePreview(fileName, cwd);
              }
            }
          } catch {}
        }
      } catch {}
    });
  }

  openSidePreview(file, cwd) {
    if (!cwd) return;
    run("layout.select", { stack: "panel-body", child: "files" });
    run("layout.show", { id: "panel" });
    setShared("filetree.preview", { root: cwd, rel: file, n: Date.now() });
  }

  checkDocs(cwd, cx) {
    if (!cwd || this.docCache.has(cwd)) return;
    this.docCache.set(cwd, { checking: true, agentsMd: false, rulesMd: false });
    cx.spawn(async (cx) => {
      let hasAgents = false;
      let hasRules = false;
      try {
        const text = await readTextFile(`${cwd}/AGENTS.md`);
        if (text && text.length > 0) hasAgents = true;
      } catch {}
      try {
        const text = await readTextFile(`${cwd}/RULES.md`);
        if (text && text.length > 0) hasRules = true;
      } catch {}
      this.docCache.set(cwd, { checking: false, agentsMd: hasAgents, rulesMd: hasRules });
      cx.notify();
    });
  }

  button(t, id, icon, command, args) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/pane/${icon}.svg`).size(14));
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = p.pane;

    this.checkDocs(p.cwd, cx);
    const hasAgents = this.docCache.get(p.cwd)?.agentsMd;
    const hasRules = this.docCache.get(p.cwd)?.rulesMd;

    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(200).font_medium().text_color(t.foreground).child(name))
      .when(Boolean(p.branch), (el) =>
        el.child(
          h_flex()
            .flex_none()
            .gap(4)
            .items_center()
            .px(6)
            .h(19)
            .rounded(4)
            .bg(t.raised)
            .text_size(10.5)
            .text_color(t.muted)
            .child(svg("mods/pane/branch.svg").size(11).text_color(t.dim))
            .child(div().truncate().max_w(130).child(p.branch))
        )
      )
      .when(Boolean(hasAgents), (el) =>
        el.child(
          h_flex()
            .id(`ph-agents-${pane}`)
            .flex_none()
            .gap(4)
            .items_center()
            .px(7)
            .h(20)
            .rounded(4)
            .bg(t.raised)
            .border_1()
            .border_color(t.border)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.accent))
            .text_size(10.5)
            .font_medium()
            .text_color(t.foreground)
            .tooltip("Preview AGENTS.md in side panel")
            .on_click((_e, cx) => {
              cx.stop_propagation();
              this.openSidePreview("AGENTS.md", p.cwd);
            })
            .child(svg("mods/pane/file-text.svg").size(11).text_color(t.accent))
            .child(div().child("AGENTS.md"))
        )
      )
      .when(Boolean(hasRules), (el) =>
        el.child(
          h_flex()
            .id(`ph-rules-${pane}`)
            .flex_none()
            .gap(4)
            .items_center()
            .px(7)
            .h(20)
            .rounded(4)
            .bg(t.raised)
            .border_1()
            .border_color(t.border)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.accent))
            .text_size(10.5)
            .font_medium()
            .text_color(t.foreground)
            .tooltip("Preview RULES.md in side panel")
            .on_click((_e, cx) => {
              cx.stop_propagation();
              this.openSidePreview("RULES.md", p.cwd);
            })
            .child(svg("mods/pane/file-text.svg").size(11).text_color(t.accent))
            .child(div().child("RULES.md"))
        )
      )
      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))
      .when(st === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", el => el.child(
        div().flex_none().px(6).h(18).flex().items_center().gap(3).rounded(5).bg(t.done + "26")
          .child(div().text_size(10.5).font_bold().text_color(t.done).child("✓"))
          .child(div().text_size(10.5).font_semibold().text_color(t.done).child("Done"))
      ))
      .when(this.hovered, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
  }
}
