import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, Editor, EditorState } from "gpui-base";
import { theme, settings, home, readTextFile, writeTextFile, run, notify } from "herdr";

const NAME = "snippets";
const STORE_PATH = () => `${home()}/.config/herdr-app/snippets.json`;

const uiSize = () => Number(settings()?.ui_font_size) || 13;
const codeSize = () => Number(settings()?.font_size) || 12;
const monoFont = () => String(settings()?.font ?? settings()?.font_family ?? "CommitMono Nerd Font");

const DEFAULT_SNIPPETS = [
  {
    id: "snip_docker_prune",
    title: "Docker: Clean unused containers & images",
    language: "docker",
    tags: ["docker", "cleanup"],
    description: "Remove all stopped containers, unused networks, and dangling images",
    code: "docker system prune -af --volumes",
    createdAt: Date.now() - 86400000 * 3,
  },
  {
    id: "snip_docker_stats",
    title: "Docker: Show container resource stats",
    language: "docker",
    tags: ["docker", "monitor"],
    description: "Quick resource usage snapshot across all running containers",
    code: 'docker stats --no-stream --format "table {{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}"',
    createdAt: Date.now() - 86400000 * 2,
  },
  {
    id: "snip_git_undo_soft",
    title: "Git: Undo last commit (keep changes staged)",
    language: "git",
    tags: ["git", "undo"],
    description: "Rewinds commit without losing any changes in working directory",
    code: "git reset --soft HEAD~1",
    createdAt: Date.now() - 86400000 * 4,
  },
  {
    id: "snip_git_discard_all",
    title: "Git: Discard all local uncommitted changes",
    language: "git",
    tags: ["git", "clean"],
    description: "Permanently wipes uncommitted modifications and untracked files",
    code: "git reset --hard HEAD && git clean -fd",
    createdAt: Date.now() - 86400000 * 5,
  },
  {
    id: "snip_git_log_graph",
    title: "Git: Pretty one-line log graph",
    language: "git",
    tags: ["git", "history"],
    description: "Visual branch graph in terminal with concise commit hashes",
    code: "git log --graph --oneline --decorate --all -n 25",
    createdAt: Date.now() - 86400000 * 6,
  },
  {
    id: "snip_port_check",
    title: "Network: Check process listening on port",
    language: "bash",
    tags: ["bash", "network"],
    description: "Find PID and process name holding a specific port",
    code: "lsof -nP -iTCP:8080 -sTCP:LISTEN",
    createdAt: Date.now() - 86400000 * 7,
  },
  {
    id: "snip_find_large_files",
    title: "Bash: Find files larger than 100MB",
    language: "bash",
    tags: ["bash", "disk"],
    description: "Search current directory recursively for large files",
    code: "find . -type f -size +100M -exec ls -lh {} + | awk '{print $9, $5}'",
    createdAt: Date.now() - 86400000 * 8,
  },
  {
    id: "snip_php_serve",
    title: "PHP: Start local built-in server",
    language: "php",
    tags: ["php", "server"],
    description: "Quick web server for testing without Apache/Nginx",
    code: "php -S 127.0.0.1:8000 -t public/",
    createdAt: Date.now() - 86400000 * 9,
  },
];

export default class SnippetsMod extends View {
  init(_props, cx) {
    this.snippets = [];
    this.searchQuery = "";
    this.activeLanguage = "all";
    this.isFormOpen = false;
    this.editingId = null;

    // Search input
    this.searchInput = InputState.new({ placeholder: "Search snippets (title, tag, code)..." });
    this.searchInput.on("change", (_e, cx) => {
      this.searchQuery = this.searchInput.value().trim().toLowerCase();
      cx.notify();
    });

    // Form inputs
    this.formTitle = InputState.new({ placeholder: "Snippet Title (e.g. Git undo commit)..." });
    this.formTitle.on("change", (_e, cx) => cx.notify());

    this.formLang = InputState.new({ placeholder: "Language / Category (bash, git, docker, js, php, sql)..." });
    this.formLang.on("change", (_e, cx) => cx.notify());

    this.formTags = InputState.new({ placeholder: "Tags (comma separated)..." });
    this.formTags.on("change", (_e, cx) => cx.notify());

    this.formDesc = InputState.new({ placeholder: "Description / Usage notes (optional)..." });
    this.formDesc.on("change", (_e, cx) => cx.notify());

    this.formEditor = null;

    this.load(cx);
  }

  async load(cx) {
    try {
      const raw = await readTextFile(STORE_PATH());
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.snippets = parsed;
        } else {
          this.snippets = DEFAULT_SNIPPETS;
          this.save(cx);
        }
      } else {
        const local = localStorage.getItem(`${NAME}.data`);
        if (local) {
          this.snippets = JSON.parse(local) || DEFAULT_SNIPPETS;
        } else {
          this.snippets = DEFAULT_SNIPPETS;
          this.save(cx);
        }
      }
    } catch {
      this.snippets = DEFAULT_SNIPPETS;
      this.save(cx);
    }
    cx.notify();
  }

  save(cx) {
    try {
      localStorage.setItem(`${NAME}.data`, JSON.stringify(this.snippets));
    } catch {}

    const text = JSON.stringify(this.snippets, null, 2);
    cx.spawn(async () => {
      try {
        await writeTextFile(STORE_PATH(), text, null);
      } catch (e) {
        console.error("Failed to save snippets:", e);
      }
    });
  }

  openCreateForm(initialCode = "", cx) {
    this.editingId = null;
    this.isFormOpen = true;
    this.formTitle.set_value("");
    this.formLang.set_value("bash");
    this.formTags.set_value("");
    this.formDesc.set_value("");
    this.formEditor = EditorState.new({
      language: "shell",
      value: initialCode,
      readonly: false,
      line_numbers: true,
      soft_wrap: true,
      font_family: monoFont(),
      font_size: codeSize(),
    });
    cx.notify();
  }

  openEditForm(id, cx) {
    const s = this.snippets.find((x) => x.id === id);
    if (!s) return;
    this.editingId = id;
    this.isFormOpen = true;
    this.formTitle.set_value(s.title);
    this.formLang.set_value(s.language || "bash");
    this.formTags.set_value(Array.isArray(s.tags) ? s.tags.join(", ") : "");
    this.formDesc.set_value(s.description || "");
    this.formEditor = EditorState.new({
      language: s.language || "shell",
      value: s.code || "",
      readonly: false,
      line_numbers: true,
      soft_wrap: true,
      font_family: monoFont(),
      font_size: codeSize(),
    });
    cx.notify();
  }

  closeForm(cx) {
    this.isFormOpen = false;
    this.editingId = null;
    this.formEditor = null;
    cx.notify();
  }

  saveForm(cx) {
    const title = this.formTitle.value().trim();
    const code = this.formEditor ? this.formEditor.value().trim() : "";
    if (!title) {
      notify({ title: "Snippet Title Required", body: "Please enter a title for this snippet", level: "warning" });
      return;
    }
    if (!code) {
      notify({ title: "Code Content Required", body: "Snippet code cannot be empty", level: "warning" });
      return;
    }

    const lang = this.formLang.value().trim().toLowerCase() || "bash";
    const tags = this.formTags.value().split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    const desc = this.formDesc.value().trim();

    if (this.editingId) {
      const idx = this.snippets.findIndex((x) => x.id === this.editingId);
      if (idx !== -1) {
        this.snippets[idx] = {
          ...this.snippets[idx],
          title,
          language: lang,
          tags,
          description: desc,
          code,
          updatedAt: Date.now(),
        };
      }
      notify({ title: "Snippet Updated", body: title, level: "info", timeout: 2000 });
    } else {
      const newSnippet = {
        id: `snip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title,
        language: lang,
        tags,
        description: desc,
        code,
        createdAt: Date.now(),
      };
      this.snippets.unshift(newSnippet);
      notify({ title: "Snippet Created", body: title, level: "info", timeout: 2000 });
    }

    this.save(cx);
    this.closeForm(cx);
  }

  deleteSnippet(id, cx) {
    const s = this.snippets.find((x) => x.id === id);
    this.snippets = this.snippets.filter((x) => x.id !== id);
    this.save(cx);
    notify({ title: "Snippet Deleted", body: s?.title || "", level: "info", timeout: 1500 });
    cx.notify();
  }

  copySnippet(snippet, cx) {
    cx.write_to_clipboard(snippet.code);
    notify({ title: "Copied to Clipboard", body: snippet.title, level: "info", timeout: 1800 });
  }

  sendToTerminal(snippet, cx) {
    cx.write_to_clipboard(snippet.code);
    run("terminal.paste");
    notify({ title: "Inserted into Terminal", body: snippet.title, level: "info", timeout: 1800 });
  }

  createFromClipboard(cx) {
    const text = cx.read_from_clipboard();
    if (!text || !text.trim()) {
      notify({ title: "Clipboard Empty", body: "No text found in clipboard to create snippet", level: "warning" });
      return;
    }
    this.openCreateForm(text.trim(), cx);
  }

  render(cx) {
    const t = theme();
    const stop = (_e, cx) => cx.stop_propagation();

    // Filter snippets
    const filtered = this.snippets.filter((s) => {
      const matchesLang = this.activeLanguage === "all" || s.language === this.activeLanguage;
      if (!matchesLang) return false;
      if (!this.searchQuery) return true;
      const q = this.searchQuery;
      return (
        s.title.toLowerCase().includes(q) ||
        (s.description && s.description.toLowerCase().includes(q)) ||
        s.code.toLowerCase().includes(q) ||
        (Array.isArray(s.tags) && s.tags.some((t) => t.toLowerCase().includes(q)))
      );
    });

    // Collect available languages for filter pills
    const langCounts = {};
    for (const s of this.snippets) {
      const l = s.language || "other";
      langCounts[l] = (langCounts[l] || 0) + 1;
    }
    const availableLangs = Object.keys(langCounts).sort();

    return v_flex()
      .id("snippets-mod")
      .size_full()
      .bg(t.chrome)
      .text_color(t.foreground)
      // Header Bar
      .child(
        h_flex()
          .h(38)
          .px(10)
          .items_center()
          .justify_between()
          .border_b(1)
          .border_color(t.border)
          .child(
            h_flex()
              .gap(7)
              .items_center()
              .child(svg("mods/snippets/icons/code.svg").size(16).text_color(t.done ?? "#74BBA2"))
              .child(div().font_semibold().text_size(13).child("Code Snippets"))
              .child(
                div()
                  .px(5)
                  .py(1)
                  .rounded(4)
                  .bg(t.selected)
                  .text_color(t.muted)
                  .text_size(10.5)
                  .child(String(this.snippets.length))
              )
          )
          .child(
            h_flex()
              .gap(4)
              .items_center()
              .child(
                h_flex()
                  .id("btn-paste-clip")
                  .h(26)
                  .px(7)
                  .gap(4)
                  .items_center()
                  .rounded(6)
                  .cursor_pointer()
                  .bg(t.surface ?? t.chrome)
                  .text_color(t.muted)
                  .hover((s) => s.bg(t.hover).text_color(t.foreground))
                  .tooltip("Create snippet from clipboard")
                  .on_mouse_down("left", stop)
                  .on_click(() => this.createFromClipboard(cx))
                  .child(svg("mods/filetree/copy.svg").size(12))
                  .child(div().text_size(11.5).child("From Clip"))
              )
              .child(
                h_flex()
                  .id("btn-new-snippet")
                  .h(26)
                  .px(8)
                  .gap(4)
                  .items_center()
                  .rounded(6)
                  .cursor_pointer()
                  .bg(this.isFormOpen ? t.hover : t.selected)
                  .text_color(t.foreground)
                  .hover((s) => s.bg(t.hover))
                  .tooltip(this.isFormOpen ? "Cancel" : "Add new snippet")
                  .on_mouse_down("left", stop)
                  .on_click(() => {
                    if (this.isFormOpen) this.closeForm(cx);
                    else this.openCreateForm("", cx);
                  })
                  .child(svg(this.isFormOpen ? "mods/filetree/x.svg" : "mods/workspace-chrome/plus.svg").size(13))
                  .child(div().text_size(11.5).font_medium().child(this.isFormOpen ? "Cancel" : "New"))
              )
          )
      )
      // Form Area (when open)
      .when(this.isFormOpen, (el) => el.child(this.renderForm(t, stop, cx)))
      // Search and Filter Bar
      .child(
        v_flex()
          .p(8)
          .gap(6)
          .border_b(1)
          .border_color(t.border)
          .bg(t.background)
          // Search Input Box
          .child(
            h_flex()
              .h(28)
              .px(8)
              .gap(6)
              .items_center()
              .rounded(6)
              .border(1)
              .border_color(t.border)
              .bg(t.surface ?? t.chrome)
              .child(svg("mods/workspace-chrome/search.svg").size(13).text_color(t.dim))
              .child(Input.new(this.searchInput).flex_1().h_full().text_size(12).text_color(t.foreground))
              .when(Boolean(this.searchQuery), (e) =>
                e.child(
                  div()
                    .size(16)
                    .flex()
                    .items_center()
                    .justify_center()
                    .cursor_pointer()
                    .text_color(t.dim)
                    .hover((s) => s.text_color(t.foreground))
                    .on_click(() => {
                      this.searchInput.set_value("");
                      this.searchQuery = "";
                      cx.notify();
                    })
                    .child(svg("mods/filetree/x.svg").size(10))
                )
              )
          )
          // Language Chips Filter
          .child(
            h_flex()
              .gap(4)
              .items_center()
              .overflow_x_scrollbar()
              .child(
                div()
                  .px(7)
                  .py(2)
                  .rounded(4)
                  .cursor_pointer()
                  .text_size(11)
                  .when(this.activeLanguage === "all", (el) => el.bg(t.selected))
                  .text_color(this.activeLanguage === "all" ? t.foreground : t.dim)
                  .hover((s) => s.bg(t.hover).text_color(t.foreground))
                  .on_click(() => {
                    this.activeLanguage = "all";
                    cx.notify();
                  })
                  .child(`All (${this.snippets.length})`)
              )
              .children(
                availableLangs.map((lang) =>
                  div()
                    .id(`chip-${lang}`)
                    .px(7)
                    .py(2)
                    .rounded(4)
                    .cursor_pointer()
                    .text_size(11)
                    .when(this.activeLanguage === lang, (el) => el.bg(t.selected))
                    .text_color(this.activeLanguage === lang ? (t.done ?? "#74BBA2") : t.dim)
                    .hover((s) => s.bg(t.hover).text_color(t.foreground))
                    .on_click(() => {
                      this.activeLanguage = lang;
                      cx.notify();
                    })
                    .child(`${lang} (${langCounts[lang]})`)
                )
              )
          )
      )
      // Snippets Scrollable List
      .child(
        v_flex()
          .id("snippets-list")
          .flex_1()
          .min_h(0)
          .overflow_y_scroll()
          .p(8)
          .gap(8)
          .when(filtered.length === 0, (e) =>
            e.child(
              v_flex()
                .size_full()
                .items_center()
                .justify_center()
                .p(24)
                .gap(6)
                .child(svg("mods/snippets/icons/code.svg").size(28).text_color(t.dim))
                .child(
                  div()
                    .text_color(t.muted)
                    .text_size(12.5)
                    .child(this.searchQuery ? "No snippets matching search" : "No snippets in this category")
                )
                .child(
                  div()
                    .cursor_pointer()
                    .text_color(t.done ?? "#74BBA2")
                    .text_size(11.5)
                    .hover((s) => s.underline())
                    .on_click(() => this.openCreateForm("", cx))
                    .child("+ Add a new snippet")
                )
            )
          )
          .children(filtered.map((snippet) => this.renderCard(snippet, t, stop, cx)))
      );
  }

  renderForm(t, stop, cx) {
    return v_flex()
      .p(10)
      .gap(8)
      .border_b(1)
      .border_color(t.border)
      .bg(t.surface ?? t.chrome)
      .child(
        div()
          .font_semibold()
          .text_size(12.5)
          .text_color(t.foreground)
          .child(this.editingId ? "Edit Snippet" : "Add New Snippet")
      )
      // Title Row
      .child(
        v_flex()
          .gap(3)
          .child(div().text_size(11).text_color(t.muted).child("Title *"))
          .child(
            h_flex()
              .h(28)
              .px(8)
              .items_center()
              .rounded(6)
              .border(1)
              .border_color(t.border)
              .bg(t.input ?? t.background)
              .child(Input.new(this.formTitle).flex_1().h_full().text_size(12).text_color(t.foreground))
          )
      )
      // Language and Tags Row
      .child(
        h_flex()
          .gap(8)
          .child(
            v_flex()
              .flex_1()
              .gap(3)
              .child(div().text_size(11).text_color(t.muted).child("Language (bash, git, docker, js, php, sql)"))
              .child(
                h_flex()
                  .h(28)
                  .px(8)
                  .items_center()
                  .rounded(6)
                  .border(1)
                  .border_color(t.border)
                  .bg(t.input ?? t.background)
                  .child(Input.new(this.formLang).flex_1().h_full().text_size(12).text_color(t.foreground))
              )
          )
          .child(
            v_flex()
              .flex_1()
              .gap(3)
              .child(div().text_size(11).text_color(t.muted).child("Tags (comma separated)"))
              .child(
                h_flex()
                  .h(28)
                  .px(8)
                  .items_center()
                  .rounded(6)
                  .border(1)
                  .border_color(t.border)
                  .bg(t.input ?? t.background)
                  .child(Input.new(this.formTags).flex_1().h_full().text_size(12).text_color(t.foreground))
              )
          )
      )
      // Description Row
      .child(
        v_flex()
          .gap(3)
          .child(div().text_size(11).text_color(t.muted).child("Description (optional)"))
          .child(
            h_flex()
              .h(28)
              .px(8)
              .items_center()
              .rounded(6)
              .border(1)
              .border_color(t.border)
              .bg(t.input ?? t.background)
              .child(Input.new(this.formDesc).flex_1().h_full().text_size(12).text_color(t.foreground))
          )
      )
      // Code Editor Area
      .child(
        v_flex()
          .gap(3)
          .child(
            h_flex()
              .justify_between()
              .items_center()
              .child(div().text_size(11).text_color(t.muted).child("Snippet Code *"))
              .child(
                div()
                  .cursor_pointer()
                  .text_size(11)
                  .text_color(t.done ?? "#74BBA2")
                  .hover((s) => s.underline())
                  .on_click(() => {
                    const text = cx.read_from_clipboard();
                    if (text && this.formEditor) {
                      this.formEditor.set_value(text.trim());
                      cx.notify();
                    }
                  })
                  .child("Paste from Clipboard")
              )
          )
          .child(
            div()
              .h(120)
              .w_full()
              .p(6)
              .rounded(6)
              .border(1)
              .border_color(t.border)
              .bg(t.background)
              .child(this.formEditor ? Editor.new(this.formEditor).size_full() : div())
          )
      )
      // Form Action Buttons
      .child(
        h_flex()
          .gap(6)
          .justify_end()
          .items_center()
          .pt(4)
          .child(
            h_flex()
              .h(26)
              .px(10)
              .items_center()
              .rounded(6)
              .cursor_pointer()
              .bg(t.hover)
              .text_color(t.muted)
              .hover((s) => s.text_color(t.foreground))
              .on_mouse_down("left", stop)
              .on_click(() => this.closeForm(cx))
              .child(div().text_size(11.5).child("Cancel"))
          )
          .child(
            h_flex()
              .h(26)
              .px(12)
              .items_center()
              .rounded(6)
              .cursor_pointer()
              .bg(t.done ?? "#74BBA2")
              .text_color(t.background ?? "#131718")
              .hover((s) => s.opacity(0.9))
              .on_mouse_down("left", stop)
              .on_click(() => this.saveForm(cx))
              .child(div().text_size(11.5).font_semibold().child(this.editingId ? "Update Snippet" : "Save Snippet"))
          )
      );
  }

  renderCard(snippet, t, stop, cx) {
    const lines = (snippet.code || "").split("\n");
    const isMultiLine = lines.length > 1;

    return v_flex()
      .id(`card-${snippet.id}`)
      .rounded(8)
      .border(1)
      .border_color(t.border)
      .bg(t.surface ?? t.chrome)
      .p(10)
      .gap(6)
      // Card Header
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .flex_1()
              .min_w(0)
              .child(
                div()
                  .font_semibold()
                  .text_size(12.5)
                  .text_color(t.foreground)
                  .truncate()
                  .child(snippet.title)
              )
              .child(
                div()
                  .px(5)
                  .py(1)
                  .rounded(4)
                  .bg(t.selected)
                  .text_color(t.done ?? "#74BBA2")
                  .text_size(10)
                  .font_medium()
                  .child(snippet.language || "code")
              )
          )
          // Action Buttons: Copy, Run, Edit, Delete
          .child(
            h_flex()
              .gap(3)
              .items_center()
              .flex_none()
              // Copy Button
              .child(
                div()
                  .size(24)
                  .flex()
                  .items_center()
                  .justify_center()
                  .rounded(5)
                  .cursor_pointer()
                  .text_color(t.dim)
                  .hover((s) => s.bg(t.hover).text_color(t.foreground))
                  .tooltip("Copy snippet to clipboard")
                  .on_mouse_down("left", stop)
                  .on_click(() => this.copySnippet(snippet, cx))
                  .child(svg("mods/filetree/copy.svg").size(13))
              )
              // Insert to Terminal Button
              .child(
                div()
                  .size(24)
                  .flex()
                  .items_center()
                  .justify_center()
                  .rounded(5)
                  .cursor_pointer()
                  .text_color(t.dim)
                  .hover((s) => s.bg(t.hover).text_color(t.done ?? "#74BBA2"))
                  .tooltip("Insert snippet into active terminal")
                  .on_mouse_down("left", stop)
                  .on_click(() => this.sendToTerminal(snippet, cx))
                  .child(svg("mods/workspace-chrome/terminal.svg").size(13))
              )
              // Edit Button
              .child(
                div()
                  .size(24)
                  .flex()
                  .items_center()
                  .justify_center()
                  .rounded(5)
                  .cursor_pointer()
                  .text_color(t.dim)
                  .hover((s) => s.bg(t.hover).text_color(t.foreground))
                  .tooltip("Edit snippet")
                  .on_mouse_down("left", stop)
                  .on_click(() => this.openEditForm(snippet.id, cx))
                  .child(svg("mods/snippets/icons/pencil.svg").size(12))
              )
              // Delete Button
              .child(
                div()
                  .size(24)
                  .flex()
                  .items_center()
                  .justify_center()
                  .rounded(5)
                  .cursor_pointer()
                  .text_color(t.dim)
                  .hover((s) => s.bg(t.hover).text_color(t.blocked ?? "#d4708a"))
                  .tooltip("Delete snippet")
                  .on_mouse_down("left", stop)
                  .on_click(() => this.deleteSnippet(snippet.id, cx))
                  .child(svg("mods/filetree/trash.svg").size(12))
              )
          )
      )
      // Description (if present)
      .when(Boolean(snippet.description), (e) =>
        e.child(div().text_size(11.5).text_color(t.muted).child(snippet.description))
      )
      // Code Box Preview
      .child(
        v_flex()
          .p(8)
          .rounded(6)
          .border(1)
          .border_color(t.border)
          .bg(t.background)
          .cursor_pointer()
          .hover((s) => s.border_color(t.selected))
          .tooltip("Click to copy")
          .on_mouse_down("left", stop)
          .on_click(() => this.copySnippet(snippet, cx))
          .children(
            lines.slice(0, 6).map((line, idx) =>
              h_flex()
                .id(`line-${idx}`)
                .gap(8)
                .items_start()
                .when(isMultiLine, (el) =>
                  el.child(
                    div()
                      .w(20)
                      .text_size(10)
                      .text_color(t.dim)
                      .text_right()
                      .flex_none()
                      .child(String(idx + 1))
                  )
                )
                .child(
                  div()
                    .flex_1()
                    .text_size(11.5)
                    .text_color(t.foreground)
                    .font_family(monoFont())
                    .truncate()
                    .child(line || " ")
                )
            )
          )
          .when(lines.length > 6, (el) =>
            el.child(
              div()
                .pt(4)
                .text_size(10.5)
                .text_color(t.dim)
                .child(`... +${lines.length - 6} more lines`)
            )
          )
      )
      // Tags footer (if present)
      .when(Array.isArray(snippet.tags) && snippet.tags.length > 0, (e) =>
        e.child(
          h_flex()
            .gap(4)
            .items_center()
            .children(
              snippet.tags.map((tg) =>
                div()
                  .id(`tag-${snippet.id}-${tg}`)
                  .px(5)
                  .py(1)
                  .rounded(3)
                  .bg(t.hover)
                  .text_color(t.dim)
                  .text_size(10)
                  .child(`#${tg}`)
              )
            )
        )
      );
  }
}
