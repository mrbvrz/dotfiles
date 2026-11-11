import { View, div, svg } from "gpui-kit";
import { v_flex } from "gpui-base";
import { spaces, layout, run, theme, shared, nextCommand } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class ActivityBar extends View {
  init(_props, cx) {
    cx.spawn(async (cx) => {
      try {
        for (;;) {
          const cmd = await nextCommand();
          if (cmd) {
            this.togglePanel(cmd);
            cx.notify();
          }
        }
      } catch {
        /* mod reloading */
      }
    });
  }

  togglePanel(id) {
    const root = layout();
    const panel = find(root, "panel");
    const body = find(root, "panel-body");
    if (!panel || !body?.children?.some((c) => c.id === id)) return;
    if (!panel.hidden && body.active === id) {
      run("layout.hide", { id: "panel" });
    } else {
      run("layout.select", { stack: "panel-body", child: id });
      run("layout.show", { id: "panel" });
    }
  }

  render() {
    const t = theme();
    const root = layout();
    const panel = find(root, "panel");
    const body = find(root, "panel-body");
    const isOpen = panel && !panel.hidden;
    const activeId = isOpen ? body?.active : null;

    const items = [
      { id: "files", label: "Files", tooltip: "Files (Explorer)", icon: "mods/workspace-chrome/files.svg" },
      { id: "changes", label: "Changes", tooltip: "Changes (Source Control)", icon: "mods/changes/changes.svg" },
      { id: "graph", label: "Git", tooltip: "Git Graph", icon: "mods/git-graph/icons/graph.svg" },
      { id: "ci", label: "CI", tooltip: "CI Dashboard", icon: "mods/ci-dash/ci.svg" },
      { id: "pr-flow", label: "PRs", tooltip: "Pull Requests", icon: "mods/pr-flow/merge.svg" },
      { id: "todo", label: "Agenda", tooltip: "Agenda & Tasks", icon: "mods/todo/todo.svg" },
      { id: "docker", label: "Docker", tooltip: "Docker Containers", icon: "mods/docker/icons/docker.svg" },
    ];

    const badges = shared("mod-badges") ?? {};
    const space = spaces().find((s) => s.active);

    const renderItem = (item) => {
      const on = activeId === item.id;
      const bVal = badges[item.id];
      const badgeCount = typeof bVal === "number" ? bVal : bVal && typeof bVal === "object" ? bVal[space?.id] : 0;
      const hasBadge = Number.isFinite(badgeCount) && badgeCount > 0;

      return div()
        .id(`activity-${item.id}`)
        .size(36)
        .relative()
        .flex()
        .items_center()
        .justify_center()
        .rounded(6)
        .cursor_pointer()
        .when(on, (el) => el.bg(t.selected))
        .text_color(on ? (t.foreground ?? "#ffffff") : t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(item.tooltip)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => this.togglePanel(item.id))
        .when(on, (el) =>
          el.child(
            div()
              .absolute()
              .left(0)
              .top(6)
              .bottom(6)
              .w(2.5)
              .rounded_r(2)
              .bg(t.accent ?? "#74BBA2")
          )
        )
        .child(svg(item.icon).size(18))
        .when(hasBadge, (el) =>
          el.child(
            div()
              .absolute()
              .top(2)
              .right(2)
              .px(3.5)
              .h(14)
              .flex()
              .items_center()
              .justify_center()
              .rounded(7)
              .bg(t.accent ?? "#e06c75")
              .text_color(t.background ?? "#000")
              .text_size(9)
              .font_bold()
              .child(badgeCount > 99 ? "99+" : String(badgeCount))
          )
        );
    };

    return v_flex()
      .id("activity-bar")
      .size_full()
      .w(44)
      .items_center()
      .justify_between()
      .py(6)
      .bg(t.chrome)
      .child(
        v_flex()
          .w_full()
          .items_center()
          .gap(4)
          .children(items.map(renderItem))
      )
      .child(
        v_flex()
          .w_full()
          .items_center()
          .gap(4)
          .child(
            div()
              .id("activity-panel-toggle")
              .size(36)
              .flex()
              .items_center()
              .justify_center()
              .rounded(6)
              .cursor_pointer()
              .text_color(t.dim)
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .tooltip(isOpen ? "Close Side Panel" : "Open Side Panel")
              .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
              .on_click(() => {
                if (isOpen) run("layout.hide", { id: "panel" });
                else run("layout.show", { id: "panel" });
              })
              .child(svg("mods/workspace-chrome/panel-right.svg").size(18))
          )
      );
  }
}
