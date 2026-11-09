// Todo, Notes & Reminders mod for Herdr.
// Clean, fast, and keyboard-friendly personal productivity tool.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, Editor, EditorState, Scrollbar, TextView } from "gpui-base";
import { theme, settings, home, readTextFile, exec, notify } from "herdr";

const NAME = "todo";
const STORE_PATH = () => `${home()}/.config/herdr-app/agenda.json`;

const uiSize = () => Number(settings()?.ui_font_size) || 13;
const codeSize = () => Number(settings()?.font_size) || 12;
const monoFont = () => String(settings()?.font ?? settings()?.font_family ?? "CommitMono Nerd Font");
const uiFont = () => String(settings()?.ui_font ?? "Uncut Sans");

function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function wordCount(str) {
  if (!str) return 0;
  return str.trim().split(/\s+/).filter(Boolean).length;
}

function formatCountdown(dueAt) {
  const diff = Math.floor((dueAt - Date.now()) / 1000);
  if (diff <= 0) return "Due now!";
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default class TodoMod extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    let savedTab = "todo";
    try { savedTab = localStorage.getItem(`${NAME}.tab`) || "todo"; } catch {}
    this.tab = ["todo", "notes", "reminders"].includes(savedTab) ? savedTab : "todo";

    this.todos = [];
    this.todoFilter = "active";
    this.todoPriority = "normal";
    this.todoInput = InputState.new({ placeholder: "Add a task (press Enter)..." });
    this.todoInput.on("submit", (_e, cx) => this.addTodo(cx));

    this.notes = [];
    this.activeNoteId = null;
    this.noteViewMode = "edit";
    this.noteSearch = InputState.new({ placeholder: "Search notes..." });
    this.noteSearch.on("change", (_e, cx) => cx.notify());
    this.noteTitleInput = InputState.new({ placeholder: "Note title..." });
    this.noteTitleInput.on("change", (_e, cx) => this.updateNoteTitle(cx));
    this.noteEditor = null;

    this.reminders = [];
    this.reminderPreset = 15;
    this.reminderInput = InputState.new({ placeholder: "Reminder description..." });
    this.reminderInput.on("submit", (_e, cx) => this.addReminder(cx));

    this.load(cx);
    cx.timer.every(1000, (cx) => this.tick(cx));
  }

  // ── Persistence ──────────────────────────────────────────────────────────
  async load(cx) {
    try {
      const raw = await readTextFile(STORE_PATH());
      if (raw) {
        const data = JSON.parse(raw);
        this.todos = Array.isArray(data.todos) ? data.todos : [];
        this.notes = Array.isArray(data.notes) ? data.notes : [];
        this.reminders = Array.isArray(data.reminders) ? data.reminders : [];
      } else {
        const local = localStorage.getItem(`${NAME}.data`);
        if (local) {
          const data = JSON.parse(local);
          this.todos = data.todos || [];
          this.notes = data.notes || [];
          this.reminders = data.reminders || [];
        }
      }
    } catch {
      this.todos = [];
      this.notes = [];
      this.reminders = [];
    }
    cx.notify();
  }

  save(cx) {
    const data = {
      todos: this.todos,
      notes: this.notes,
      reminders: this.reminders,
    };
    try { localStorage.setItem(`${NAME}.data`, JSON.stringify(data)); } catch {}

    cx.spawn(async () => {
      try {
        const json = JSON.stringify(data, null, 2);
        const script = `mkdir -p "$(dirname "$1")" && cat << 'AGENDA_EOF' > "$1"
${json}
AGENDA_EOF`;
        await exec("sh", ["-c", script, NAME, STORE_PATH()]);
      } catch (e) {
        console.error("Failed to save agenda:", e);
      }
    });
  }

  tick(cx) {
    const now = Date.now();
    let changed = false;
    for (const r of this.reminders) {
      if (!r.fired && r.dueAt <= now) {
        r.fired = true;
        changed = true;
        notify({
          title: "⏰ Reminder Alert!",
          body: r.text,
          level: "warning",
          timeout: 6000,
        });
      }
    }
    if (changed) this.save(cx);
    cx.notify();
  }

  setTab(tab, cx) {
    this.tab = tab;
    try { localStorage.setItem(`${NAME}.tab`, tab); } catch {}
    cx.notify();
  }

  // ── Todo Actions ─────────────────────────────────────────────────────────
  addTodo(cx) {
    const text = this.todoInput.value().trim();
    if (!text) return;
    this.todos.unshift({
      id: "t_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      text,
      done: false,
      priority: this.todoPriority,
      createdAt: Date.now(),
    });
    this.todoInput.set_value("");
    this.save(cx);
    cx.notify();
  }

  toggleTodo(id, cx) {
    const t = this.todos.find((x) => x.id === id);
    if (!t) return;
    t.done = !t.done;
    this.save(cx);
    cx.notify();
  }

  deleteTodo(id, cx) {
    this.todos = this.todos.filter((x) => x.id !== id);
    this.save(cx);
    cx.notify();
  }

  clearDoneTodos(cx) {
    this.todos = this.todos.filter((x) => !x.done);
    this.save(cx);
    cx.notify();
  }

  // ── Notes Actions ────────────────────────────────────────────────────────
  createNote(cx) {
    const newNote = {
      id: "n_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      title: "Untitled Note",
      content: "",
      updatedAt: Date.now(),
    };
    this.notes.unshift(newNote);
    this.openNote(newNote.id, cx);
    this.save(cx);
  }

  openNote(id, cx) {
    const n = this.notes.find((x) => x.id === id);
    if (!n) return;
    this.activeNoteId = id;
    this.noteTitleInput.set_value(n.title);
    this.noteEditor = EditorState.new({
      language: "markdown",
      value: n.content,
      readonly: false,
      line_numbers: false,
      soft_wrap: true,
      font_family: monoFont(),
      font_size: codeSize(),
    });
    this.noteEditor.on("change", (_e, cx) => {
      const active = this.notes.find((x) => x.id === this.activeNoteId);
      if (active && this.noteEditor) {
        active.content = this.noteEditor.value();
        active.updatedAt = Date.now();
        this.save(cx);
      }
    });
    cx.notify();
  }

  closeNote(cx) {
    this.activeNoteId = null;
    this.noteEditor = null;
    this.save(cx);
    cx.notify();
  }

  updateNoteTitle(cx) {
    const active = this.notes.find((x) => x.id === this.activeNoteId);
    if (active) {
      active.title = this.noteTitleInput.value() || "Untitled Note";
      active.updatedAt = Date.now();
      this.save(cx);
    }
  }

  deleteNote(id, cx) {
    this.notes = this.notes.filter((x) => x.id !== id);
    if (this.activeNoteId === id) {
      this.activeNoteId = null;
      this.noteEditor = null;
    }
    this.save(cx);
    cx.notify();
  }

  copyNoteContent(cx) {
    const active = this.notes.find((x) => x.id === this.activeNoteId);
    if (!active) return;
    cx.write_to_clipboard(active.content);
    notify({ title: "Copied", body: "Note content copied to clipboard", level: "info", timeout: 2000 });
  }

  insertFormat(prefix, suffix = "", cx) {
    if (!this.noteEditor) return;
    const current = this.noteEditor.value();
    const snippet = suffix ? `${prefix}text${suffix}` : `${prefix}`;
    const updated = current ? `${current}\n${snippet}` : snippet;
    this.noteEditor.set_value(updated);
    const active = this.notes.find((x) => x.id === this.activeNoteId);
    if (active) {
      active.content = updated;
      active.updatedAt = Date.now();
      this.save(cx);
    }
    if (this.noteViewMode === "preview") {
      this.noteViewMode = "edit";
    }
    cx.notify();
  }

  // ── Reminder Actions ─────────────────────────────────────────────────────
  addReminder(cx) {
    const text = this.reminderInput.value().trim();
    if (!text) return;
    const dueAt = Date.now() + this.reminderPreset * 60 * 1000;
    this.reminders.unshift({
      id: "r_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      text,
      dueAt,
      fired: false,
      createdAt: Date.now(),
    });
    this.reminderInput.set_value("");
    this.save(cx);
    cx.notify();
  }

  snoozeReminder(id, minutes, cx) {
    const r = this.reminders.find((x) => x.id === id);
    if (!r) return;
    r.dueAt = Date.now() + minutes * 60 * 1000;
    r.fired = false;
    this.save(cx);
    cx.notify();
  }

  dismissReminder(id, cx) {
    this.reminders = this.reminders.filter((x) => x.id !== id);
    this.save(cx);
    cx.notify();
  }

  // ── Render Views ─────────────────────────────────────────────────────────
  renderHeader(t) {
    const activeTodos = this.todos.filter((x) => !x.done).length;
    const activeReminders = this.reminders.filter((x) => !x.fired).length;

    const tabBtn = (id, label, count, color = null) => {
      const on = this.tab === id;
      return h_flex()
        .id(`todo-tab-${id}`)
        .h(26)
        .px(8)
        .gap(5)
        .items_center()
        .rounded(6)
        .cursor_pointer()
        .bg(on ? t.selected : t.chrome)
        .text_color(on ? t.foreground : t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => this.setTab(id, cx))
        .child(div().text_size(uiSize() - 1).font_medium().child(label))
        .when(Boolean(count), (el) =>
          el.child(
            div()
              .px(5)
              .h(16)
              .rounded(8)
              .bg(color ? color + "26" : t.raised)
              .text_size(uiSize() - 3)
              .font_bold()
              .text_color(color ?? t.foreground)
              .flex()
              .items_center()
              .justify_center()
              .child(String(count)),
          ),
        );
    };

    return h_flex()
      .h(36)
      .flex_none()
      .px(10)
      .gap(6)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .child(
        h_flex().gap(4).items_center()
          .child(tabBtn("todo", "Todo", activeTodos, t.accent))
          .child(tabBtn("notes", "Notes", this.notes.length))
          .child(tabBtn("reminders", "Reminders", activeReminders, activeReminders > 0 ? t.ansi3 ?? t.accent : null)),
      );
  }

  renderTodoView(t) {
    const list = this.todos.filter((x) => {
      if (this.todoFilter === "active") return !x.done;
      if (this.todoFilter === "done") return x.done;
      return true;
    });

    const filterBtn = (id, label) => {
      const on = this.todoFilter === id;
      return div()
        .h(22)
        .px(6)
        .rounded(4)
        .cursor_pointer()
        .text_size(uiSize() - 2)
        .font_medium()
        .when(on, (e) => e.bg(t.raised))
        .text_color(on ? t.foreground : t.dim)
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { this.todoFilter = id; cx.notify(); })
        .child(label);
    };

    return v_flex().flex_1().min_h(0)
      // Input bar
      .child(
        v_flex().p(10).gap(8).border_b(1).border_color(t.border).bg(t.chrome)
          .child(
            h_flex().h(30).px(8).gap(6).items_center().rounded(6).bg(t.background).border_1().border_color(t.border)
              .child(Input.new(this.todoInput).flex_1().h_full().text_size(uiSize() - 1).text_color(t.foreground))
              .child(
                h_flex().h(22).px(6).gap(3).items_center().rounded(4).cursor_pointer()
                  .bg(this.todoPriority === "high" ? (t.blocked + "26") : t.raised)
                  .hover((s) => s.opacity(0.85))
                  .on_click((_e, cx) => {
                    this.todoPriority = this.todoPriority === "high" ? "normal" : "high";
                    cx.notify();
                  })
                  .child(div().text_size(uiSize() - 3).font_semibold().text_color(this.todoPriority === "high" ? t.blocked : t.dim).child(this.todoPriority === "high" ? "⚡ High" : "Normal")),
              )
              .child(
                div().h(22).px(8).flex().items_center().justify_center().rounded(4).cursor_pointer()
                  .bg(t.accent).hover((s) => s.opacity(0.85))
                  .on_click((_e, cx) => this.addTodo(cx))
                  .child(div().text_size(uiSize() - 2).font_bold().text_color(t.accent_foreground ?? "#131718").child("+ Add")),
              ),
          )
          // Filters
          .child(
            h_flex().justify_between().items_center()
              .child(
                h_flex().gap(4).items_center()
                  .child(filterBtn("active", `Active (${this.todos.filter((x) => !x.done).length})`))
                  .child(filterBtn("all", `All (${this.todos.length})`))
                  .child(filterBtn("done", `Done (${this.todos.filter((x) => x.done).length})`)),
              )
              .when(this.todos.some((x) => x.done), (el) =>
                el.child(
                  div().text_size(uiSize() - 2).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.ansi1 ?? "#e05252"))
                    .on_click((_e, cx) => this.clearDoneTodos(cx)).child("Clear completed"),
                ),
              ),
          ),
      )
      // Items list
      .child(
        div().id("todo-items-wrap").flex_1().min_h(0).relative().px(8).py(6)
          .child(
            v_flex().id("todo-list").size_full().gap(4).overflow_y_scroll()
              .when(list.length === 0, (el) =>
                el.child(
                  v_flex().items_center().justify_center().py(32).gap(6)
                    .child(div().text_size(uiSize()).font_medium().text_color(t.muted).child("No tasks here"))
                    .child(div().text_size(uiSize() - 2).text_color(t.dim).child("Type a task above and press Enter to save")),
                ),
              )
              .children(
                list.map((item) =>
                  h_flex()
                    .id(`todo-item-${item.id}`)
                    .h(32)
                    .px(8)
                    .gap(8)
                    .items_center()
                    .rounded(6)
                    .bg(t.raised)
                    .hover((s) => s.bg(t.hover))
                    // Checkbox
                    .child(
                      div()
                        .size(16)
                        .flex_none()
                        .rounded(4)
                        .border_1()
                        .border_color(item.done ? t.done : t.dim)
                        .when(item.done, (e) => e.bg(t.done + "26"))
                        .cursor_pointer()
                        .flex()
                        .items_center()
                        .justify_center()
                        .on_click((_e, cx) => this.toggleTodo(item.id, cx))
                        .when(item.done, (e) => e.child(div().text_size(uiSize() - 3).font_bold().text_color(t.done).child("✓"))),
                    )
                    // Text
                    .child(
                      div()
                        .flex_1()
                        .min_w(0)
                        .truncate()
                        .text_size(uiSize() - 1)
                        .text_color(item.done ? t.dim : t.foreground)
                        .when(item.done, (e) => e.line_through())
                        .child(item.text),
                    )
                    // Priority chip
                    .when(item.priority === "high" && !item.done, (el) =>
                      el.child(
                        div().px(4).h(16).rounded(3).bg(t.blocked + "26").flex().items_center().justify_center()
                          .child(div().text_size(uiSize() - 4).font_bold().text_color(t.blocked).child("HIGH")),
                      ),
                    )
                    // Time
                    .child(div().text_size(uiSize() - 3).text_color(t.dim).child(timeAgo(item.createdAt)))
                    // Delete
                    .child(
                      div()
                        .size(18)
                        .flex_none()
                        .rounded(3)
                        .cursor_pointer()
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_color(t.dim)
                        .hover((s) => s.bg(t.hover).text_color(t.ansi1 ?? "#e05252"))
                        .on_click((_e, cx) => this.deleteTodo(item.id, cx))
                        .child("✕"),
                    ),
                ),
              ),
          )
          .child(
            v_flex().absolute().top(2).bottom(2).right(2).w(4).rounded(2).overflow_hidden()
              .child(Scrollbar.vertical("todo-list").mode("hover").size_full()),
          ),
      );
  }

  renderNotesView(t) {
    if (this.activeNoteId) {
      const active = this.notes.find((x) => x.id === this.activeNoteId);
      if (!active) return div();

      const modeBtn = (mode, label) => {
        const on = this.noteViewMode === mode;
        return h_flex()
          .h(22)
          .px(7)
          .gap(4)
          .items_center()
          .rounded(4)
          .cursor_pointer()
          .when(on, (e) => e.bg(t.selected))
          .text_size(uiSize() - 2)
          .font_medium()
          .text_color(on ? t.foreground : t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => {
            this.noteViewMode = mode;
            cx.notify();
          })
          .child(label);
      };

      const toolBtn = (label, fn) =>
        div()
          .h(20)
          .px(6)
          .flex()
          .items_center()
          .justify_center()
          .rounded(3)
          .cursor_pointer()
          .text_size(uiSize() - 2.5)
          .font_medium()
          .text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => fn(cx))
          .child(label);

      return v_flex().flex_1().min_h(0)
        // Header Toolbar
        .child(
          h_flex().h(36).px(10).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border)
            .child(
              h_flex().h(24).px(8).gap(4).items_center().rounded(4).cursor_pointer().bg(t.raised)
                .hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => this.closeNote(cx))
                .child(div().text_size(uiSize() - 2).font_medium().text_color(t.foreground).child("← Notes")),
            )
            // Mode Switcher: Edit, WYSIWYG Preview, Split
            .child(
              h_flex().gap(2).p(2).rounded(5).bg(t.raised).items_center()
                .child(modeBtn("edit", "✎ Edit"))
                .child(modeBtn("preview", "👁 Preview"))
                .child(modeBtn("split", "◫ Split")),
            )
            .child(div().flex_1())
            .child(
              div().h(24).px(8).flex().items_center().rounded(4).cursor_pointer().bg(t.raised)
                .hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => this.copyNoteContent(cx))
                .child(div().text_size(uiSize() - 2).text_color(t.dim).child("Copy Markdown")),
            )
            .child(
              div().h(24).px(8).flex().items_center().rounded(4).cursor_pointer().bg(t.raised)
                .hover((s) => s.bg(t.ansi1 + "26").text_color(t.ansi1))
                .on_click((_e, cx) => this.deleteNote(active.id, cx))
                .child(div().text_size(uiSize() - 2).text_color(t.dim).child("Delete")),
            ),
        )
        // Prominent Document Title & Meta Header
        .child(
          v_flex().px(14).pt(10).pb(8).border_b(1).border_color(t.border).bg(t.chrome).gap(3)
            .child(
              Input.new(this.noteTitleInput)
                .h(28)
                .text_size(uiSize() + 3)
                .font_bold()
                .text_color(t.foreground),
            )
            .child(
              h_flex().gap(6).items_center().text_size(uiSize() - 2.5).text_color(t.dim)
                .child(`Updated: ${timeAgo(active.updatedAt)}`)
                .child("•")
                .child(`${wordCount(active.content)} words`)
                .child("•")
                .child(div().text_color(t.done).child("✓ Autosaved")),
            ),
        )
        // Markdown Quick Formatting Toolbar (visible in Edit & Split mode)
        .when(this.noteViewMode !== "preview", (el) =>
          el.child(
            h_flex().px(10).h(26).gap(4).items_center().border_b(1).border_color(t.border).bg(t.chrome)
              .child(toolBtn("H1", (cx) => this.insertFormat("# ", "", cx)))
              .child(toolBtn("H2", (cx) => this.insertFormat("## ", "", cx)))
              .child(toolBtn("H3", (cx) => this.insertFormat("### ", "", cx)))
              .child(div().w(1).h(12).bg(t.border))
              .child(toolBtn("B", (cx) => this.insertFormat("**", "**", cx)))
              .child(toolBtn("I", (cx) => this.insertFormat("*", "*", cx)))
              .child(toolBtn("`code`", (cx) => this.insertFormat("`", "`", cx)))
              .child(div().w(1).h(12).bg(t.border))
              .child(toolBtn("• List", (cx) => this.insertFormat("- ", "", cx)))
              .child(toolBtn("☑ Task", (cx) => this.insertFormat("- [ ] ", "", cx)))
              .child(toolBtn("” Quote", (cx) => this.insertFormat("> ", "", cx))),
          ),
        )
        // Note Content Area: Edit / WYSIWYG / Split
        .child(
          div().flex_1().min_h(0).bg(t.background)
            .when(this.noteViewMode === "edit", (e) =>
              e.child(div().size_full().p(12).child(this.noteEditor ? Editor.new(this.noteEditor).size_full() : div())),
            )
            .when(this.noteViewMode === "preview", (e) =>
              e.child(
                div().id("note-preview-wrap").size_full().relative()
                  .child(
                    v_flex().id("note-preview-scroll").size_full().p(16).overflow_y_scroll()
                      .child(
                        TextView.markdown(
                          `note-md-${active.id}`,
                          active.content.trim() ? active.content : "*No content yet. Click Edit or use the formatting toolbar above to write markdown...*",
                        )
                          .selectable(true)
                          .scrollable(true)
                          .on_link_click((url, cx) => cx.open_url(url)),
                      ),
                  )
                  .child(
                    v_flex().absolute().top(2).bottom(2).right(2).w(4).rounded(2).overflow_hidden()
                      .child(Scrollbar.vertical("note-preview-scroll").mode("hover").size_full()),
                  ),
              ),
            )
            .when(this.noteViewMode === "split", (e) =>
              e.child(
                h_flex().size_full().min_h(0)
                  .child(
                    v_flex().flex_1().min_w(0).h_full().border_r(1).border_color(t.border).p(10)
                      .child(this.noteEditor ? Editor.new(this.noteEditor).size_full() : div()),
                  )
                  .child(
                    div().id("note-split-wrap").flex_1().min_w(0).h_full().relative()
                      .child(
                        v_flex().id("note-split-scroll").size_full().p(12).overflow_y_scroll()
                          .child(
                            TextView.markdown(
                              `note-split-md-${active.id}`,
                              active.content.trim() ? active.content : "*Preview...*",
                            )
                              .selectable(true)
                              .scrollable(true)
                              .on_link_click((url, cx) => cx.open_url(url)),
                          ),
                      )
                      .child(
                        v_flex().absolute().top(2).bottom(2).right(2).w(4).rounded(2).overflow_hidden()
                          .child(Scrollbar.vertical("note-split-scroll").mode("hover").size_full()),
                      ),
                  ),
              ),
            ),
        );
    }

    const query = this.noteSearch.value().toLowerCase().trim();
    const list = this.notes.filter((n) => !query || n.title.toLowerCase().includes(query) || n.content.toLowerCase().includes(query));

    return v_flex().flex_1().min_h(0)
      // Top bar
      .child(
        h_flex().p(10).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border)
          .child(
            h_flex().flex_1().h(28).px(8).gap(6).items_center().rounded(6).bg(t.background).border_1().border_color(t.border)
              .child(Input.new(this.noteSearch).flex_1().h_full().text_size(uiSize() - 1).text_color(t.foreground)),
          )
          .child(
            div().h(28).px(10).flex().items_center().rounded(6).cursor_pointer().bg(t.accent)
              .hover((s) => s.opacity(0.85))
              .on_click((_e, cx) => this.createNote(cx))
              .child(div().text_size(uiSize() - 1.5).font_bold().text_color(t.accent_foreground ?? "#131718").child("+ New Note")),
          ),
      )
      // Notes list
      .child(
        div().id("notes-wrap").flex_1().min_h(0).relative().px(8).py(6)
          .child(
            v_flex().id("notes-list").size_full().gap(6).overflow_y_scroll()
              .when(list.length === 0, (el) =>
                el.child(
                  v_flex().items_center().justify_center().py(32).gap(6)
                    .child(div().text_size(uiSize()).font_medium().text_color(t.muted).child("No notes found"))
                    .child(div().text_size(uiSize() - 2).text_color(t.dim).child("Click '+ New Note' to start writing markdown notes")),
                ),
              )
              .children(
                list.map((note) => {
                  const firstLine = note.content.split("\n").find((l) => l.trim().length > 0) || "Empty note...";
                  return v_flex()
                    .id(`note-card-${note.id}`)
                    .p(10)
                    .gap(4)
                    .rounded(6)
                    .bg(t.raised)
                    .cursor_pointer()
                    .hover((s) => s.bg(t.hover))
                    .on_click((_e, cx) => this.openNote(note.id, cx))
                    .child(
                      h_flex().justify_between().items_center()
                        .child(div().flex_1().truncate().font_semibold().text_size(uiSize() - 0.5).text_color(t.foreground).child(note.title))
                        .child(div().text_size(uiSize() - 3).text_color(t.dim).child(timeAgo(note.updatedAt))),
                    )
                    .child(div().truncate().text_size(uiSize() - 1.5).text_color(t.muted).child(firstLine));
                }),
              ),
          )
          .child(
            v_flex().absolute().top(2).bottom(2).right(2).w(4).rounded(2).overflow_hidden()
              .child(Scrollbar.vertical("notes-list").mode("hover").size_full()),
          ),
      );
  }

  renderRemindersView(t) {
    const presets = [10, 15, 30, 60, 120];

    return v_flex().flex_1().min_h(0)
      // Create Reminder Box
      .child(
        v_flex().p(10).gap(8).border_b(1).border_color(t.border).bg(t.chrome)
          .child(
            h_flex().h(30).px(8).gap(6).items_center().rounded(6).bg(t.background).border_1().border_color(t.border)
              .child(Input.new(this.reminderInput).flex_1().h_full().text_size(uiSize() - 1).text_color(t.foreground))
              .child(
                div().h(22).px(8).flex().items_center().rounded(4).cursor_pointer().bg(t.accent)
                  .hover((s) => s.opacity(0.85))
                  .on_click((_e, cx) => this.addReminder(cx))
                  .child(div().text_size(uiSize() - 2).font_bold().text_color(t.accent_foreground ?? "#131718").child("Set Reminder")),
              ),
          )
          .child(
            h_flex().gap(4).items_center()
              .child(div().text_size(uiSize() - 2).text_color(t.dim).mr(4).child("In:"))
              .children(
                presets.map((mins) => {
                  const on = this.reminderPreset === mins;
                  const label = mins < 60 ? `${mins}m` : `${mins / 60}h`;
                  return div()
                    .h(20)
                    .px(6)
                    .rounded(4)
                    .cursor_pointer()
                    .bg(on ? t.selected : t.raised)
                    .text_size(uiSize() - 2.5)
                    .font_medium()
                    .text_color(on ? t.accent : t.dim)
                    .hover((s) => s.text_color(t.foreground))
                    .on_click((_e, cx) => { this.reminderPreset = mins; cx.notify(); })
                    .child(label);
                }),
              ),
          ),
      )
      // Reminders list
      .child(
        div().id("reminders-wrap").flex_1().min_h(0).relative().px(8).py(6)
          .child(
            v_flex().id("reminders-list").size_full().gap(6).overflow_y_scroll()
              .when(this.reminders.length === 0, (el) =>
                el.child(
                  v_flex().items_center().justify_center().py(32).gap(6)
                    .child(div().text_size(uiSize()).font_medium().text_color(t.muted).child("No active reminders"))
                    .child(div().text_size(uiSize() - 2).text_color(t.dim).child("Set a timer to get notified when tasks are due")),
                ),
              )
              .children(
                this.reminders.map((r) => {
                  const overdue = r.fired || r.dueAt <= Date.now();
                  return h_flex()
                    .id(`reminder-${r.id}`)
                    .p(8)
                    .gap(8)
                    .items_center()
                    .rounded(6)
                    .bg(t.raised)
                    .hover((s) => s.bg(t.hover))
                    .child(
                      div()
                        .size(24)
                        .rounded(12)
                        .bg(overdue ? (t.blocked + "26") : (t.accent + "26"))
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(div().text_size(uiSize() - 1).child(overdue ? "🔔" : "⏰")),
                    )
                    .child(
                      v_flex().flex_1().min_w(0).gap(2)
                        .child(div().truncate().text_size(uiSize() - 1).font_medium().text_color(t.foreground).child(r.text))
                        .child(
                          h_flex().gap(6).items_center()
                            .child(
                              div().text_size(uiSize() - 2.5).font_semibold()
                                .text_color(overdue ? t.blocked : t.accent)
                                .child(overdue ? "Overdue / Fired" : `Due in: ${formatCountdown(r.dueAt)}`),
                            ),
                        ),
                    )
                    // Snooze button
                    .child(
                      div().h(22).px(6).flex().items_center().rounded(4).cursor_pointer().bg(t.chrome)
                        .hover((s) => s.bg(t.hover))
                        .on_click((_e, cx) => this.snoozeReminder(r.id, 10, cx))
                        .child(div().text_size(uiSize() - 2.5).text_color(t.dim).child("+10m")),
                    )
                    // Dismiss button
                    .child(
                      div().h(22).px(6).flex().items_center().rounded(4).cursor_pointer().bg(t.done + "26")
                        .hover((s) => s.opacity(0.85))
                        .on_click((_e, cx) => this.dismissReminder(r.id, cx))
                        .child(div().text_size(uiSize() - 2.5).font_bold().text_color(t.done).child("✓ Done")),
                    );
                }),
              ),
          )
          .child(
            v_flex().absolute().top(2).bottom(2).right(2).w(4).rounded(2).overflow_hidden()
              .child(Scrollbar.vertical("reminders-list").mode("hover").size_full()),
          ),
      );
  }

  render() {
    const t = theme();

    return v_flex()
      .id(NAME)
      .track_focus(this.handle)
      .size_full()
      .font_family(uiFont())
      .bg(t.background)
      .text_color(t.foreground)
      .child(this.renderHeader(t))
      .child(
        this.tab === "todo" ? this.renderTodoView(t)
        : this.tab === "notes" ? this.renderNotesView(t)
        : this.renderRemindersView(t),
      );
  }
}
