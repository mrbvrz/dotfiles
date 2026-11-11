import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, Editor, EditorState, Textarea, TextareaState } from "gpui-base";
import { theme, settings, home, exec, readTextFile, writeTextFile, run, notify } from "herdr";

// writeTextFile(path, text, null) only creates; replacing needs the current text as `expected`.
async function replaceTextFile(path, text) {
  const current = await readTextFile(path).catch(() => null);
  await writeTextFile(path, text, current ?? null);
}


// ---- Backup / export / import ------------------------------------------
const BACKUP_DIR = () => `${home()}/.config/herdr-app/snippets-backups`;
const BACKUP_KEEP = 30;
const BACKUP_RE = /^snippets-(\d{8})-(\d{6})-n(\d+)\.json$/;
const pad2 = (n) => String(n).padStart(2, "0");
const stamp = (d = new Date()) =>
  `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
const prettyStamp = (day, time) =>
  `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}  ${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4)}`;
const expandPath = (p) => String(p || "").trim().replace(/^~(?=\/|$)/, home());

function normalizeSnippets(list) {
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    if (!x || typeof x !== "object") continue;
    const code = x.code == null ? "" : String(x.code);
    if (!code.trim()) continue;
    const title = String(x.title ?? "").trim() || code.trim().split("\n")[0].slice(0, 60);
    const tags = Array.isArray(x.tags)
      ? x.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
      : String(x.tags ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    out.push({
      id: typeof x.id === "string" && x.id ? x.id : `snip_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title,
      language: String(x.language ?? "bash").trim().toLowerCase() || "bash",
      tags,
      description: String(x.description ?? ""),
      code,
      createdAt: Number(x.createdAt) || Date.now(),
      ...(x.updatedAt ? { updatedAt: Number(x.updatedAt) } : {}),
    });
  }
  return out;
}

// Accepts a bare array or a { snippets: [...] } bundle. Returns { list } or { error }.
function parseSnippetsText(text) {
  let data;
  try {
    data = JSON.parse(String(text ?? "").trim());
  } catch {
    return { error: "Not valid JSON" };
  }
  const raw = Array.isArray(data) ? data : data?.snippets;
  if (!Array.isArray(raw)) return { error: "No snippets array found" };
  const list = normalizeSnippets(raw);
  if (!list.length) return { error: "No valid snippets in file" };
  return { list };
}

const bundleText = (snippets) =>
  JSON.stringify({ app: "herdr-snippets", version: 1, exportedAt: new Date().toISOString(), count: snippets.length, snippets }, null, 2);

const NAME = "snippets";
const STORE_PATH = () => `${home()}/.config/herdr-app/snippets.json`;

const uiSize = () => Number(settings()?.ui_font_size) || 13;
const codeSize = () => Number(settings()?.font_size) || 12;
const monoFont = () => String(settings()?.font ?? settings()?.font_family ?? "CommitMono Nerd Font");

function renderMarkdownInline(text, t) {
  if (!text) return [];
  const lines = String(text).split("\n");
  return lines.map((line) => {
    if (!line.trim()) return div().h(4);
    const isBullet = line.startsWith("- ") || line.startsWith("* ");
    const isQuote = line.startsWith("> ");
    const isHeading = line.startsWith("#");
    const rawContent = isBullet ? line.slice(2) : isQuote ? line.slice(2) : isHeading ? line.replace(/^#+\s*/, "") : line;

    // Tokenize for bold (**text**), italic (*text*), inline code (`code`)
    const parts = rawContent.split(/(\?\?\?[^*]+?\?\?\?|\*\*[^*]+?\*\*|\*[^*]+?\*|`[^`]+?`)/g);
    const elements = parts.map((part) => {
      if (!part) return null;
      if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
        return div().font_bold().text_color(t.foreground).child(part.slice(2, -2));
      }
      if (part.startsWith("*") && part.endsWith("*") && part.length >= 2) {
        return div().italic().text_color(t.foreground).child(part.slice(1, -1));
      }
      if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
        return div()
          .px(4)
          .py(0.5)
          .rounded(3)
          .bg(t.selected)
          .font_family(monoFont())
          .text_size(10.5)
          .text_color(t.done ?? "#74BBA2")
          .child(part.slice(1, -1));
      }
      return div().text_color(isQuote ? t.dim : t.muted).child(part);
    }).filter(Boolean);

    return h_flex()
      .gap(2)
      .flex_wrap()
      .items_center()
      .text_size(isHeading ? 12 : 11.5)
      .when(isHeading, (el) => el.font_semibold().text_color(t.foreground))
      .when(isBullet, (el) => el.child(div().text_color(t.done ?? "#74BBA2").child("• ")))
      .when(isQuote, (el) => el.pl(6).border_l(2).border_color(t.border).italic())
      .children(elements);
  });
}

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
    this.handle = cx.focus_handle();
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

    this.formDesc = TextareaState.new({
      placeholder: "Description / Usage notes (Markdown supported: **bold**, *italic*, `code`, lists)...",
      rows: 3,
    });
    this.formDesc.on("change", (_e, cx) => cx.notify());

    this.formEditor = null;

    // Backup / import view
    this.isBackupOpen = false;
    this.importMode = "merge";
    this.backups = [];
    this.lastBackupText = null;
    this.backupGen = 0;
    this.lastExport = "";
    this.importPath = InputState.new({ placeholder: "File to import, e.g. ~/Downloads/herdr-snippets-....json" });
    this.importPath.on("change", (_e, cx) => cx.notify());

    this.load(cx);
  }

  async load(cx) {
    let fileText = null;
    try {
      fileText = await readTextFile(STORE_PATH());
    } catch {}

    let loaded = null;
    if (fileText && fileText.trim()) {
      const parsed = parseSnippetsText(fileText);
      if (parsed.list) {
        loaded = parsed.list;
      } else {
        // Never overwrite a file we can't read: keep a copy and fall back to the newest backup.
        await exec("/bin/cp", [STORE_PATH(), `${STORE_PATH()}.corrupt-${stamp()}`]).catch(() => {});
        notify({ title: "snippets.json unreadable", body: "Saved a .corrupt copy, restoring the latest backup", level: "warning", timeout: 5000 });
      }
    }

    if (!loaded) {
      const backups = await this.listBackups();
      for (const b of backups) {
        try {
          const parsed = parseSnippetsText(await readTextFile(b.path));
          if (parsed.list) {
            loaded = parsed.list;
            if (!fileText) notify({ title: "Snippets restored", body: `From backup ${b.label}`, level: "info", timeout: 3500 });
            break;
          }
        } catch {}
      }
    }

    if (!loaded) {
      try {
        const local = localStorage.getItem(`${NAME}.data`);
        if (local) loaded = normalizeSnippets(JSON.parse(local));
      } catch {}
    }

    const seeded = !loaded || !loaded.length;
    this.snippets = seeded ? DEFAULT_SNIPPETS : loaded;
    if (seeded || !fileText) this.save(cx);
    else this.scheduleBackup(cx);
    this.backups = await this.listBackups();
    cx.notify();
  }

  save(cx) {
    try {
      localStorage.setItem(`${NAME}.data`, JSON.stringify(this.snippets));
    } catch {}

    const text = JSON.stringify(this.snippets, null, 2);
    cx.spawn(async () => {
      try {
        await replaceTextFile(STORE_PATH(), text);
      } catch (e) {
        console.error("Failed to save snippets:", e);
        notify({ title: "Could not save snippets", body: String(e?.message ?? e), level: "error" });
      }
    });
    this.scheduleBackup(cx);
  }

  // ---- automatic backups: debounced, deduplicated, newest BACKUP_KEEP kept ----
  scheduleBackup(cx) {
    const gen = ++this.backupGen;
    cx.timer.after(4000, (cx) => {
      if (gen !== this.backupGen) return;
      this.writeBackup(cx, false).catch((e) => console.error("snippets backup:", e));
    });
  }

  async listBackups() {
    const r = await exec("/bin/ls", ["-1", BACKUP_DIR()]).catch(() => null);
    return String(r?.stdout || "")
      .split("\n")
      .map((n) => n.trim())
      .map((name) => ({ name, m: name.match(BACKUP_RE) }))
      .filter((x) => x.m)
      .map((x) => ({ name: x.name, path: `${BACKUP_DIR()}/${x.name}`, label: prettyStamp(x.m[1], x.m[2]), count: Number(x.m[3]) }))
      .sort((a, b) => (a.name < b.name ? 1 : -1));
  }

  async writeBackup(cx, force) {
    const text = JSON.stringify(this.snippets, null, 2);
    if (!force) {
      if (this.lastBackupText == null) {
        const newest = (await this.listBackups())[0];
        this.lastBackupText = newest ? ((await readTextFile(newest.path).catch(() => null)) ?? "") : "";
      }
      if (this.lastBackupText === text) return null;
    }
    await exec("/bin/mkdir", ["-p", BACKUP_DIR()]);
    const path = `${BACKUP_DIR()}/snippets-${stamp()}-n${this.snippets.length}.json`;
    await replaceTextFile(path, text);
    this.lastBackupText = text;
    const all = await this.listBackups();
    for (const old of all.slice(BACKUP_KEEP)) await exec("/bin/rm", ["-f", old.path]).catch(() => {});
    this.backups = all.slice(0, BACKUP_KEEP);
    cx.notify();
    return path;
  }

  openBackupView(cx) {
    this.isBackupOpen = true;
    cx.notify();
    cx.spawn(async (cx) => {
      this.backups = await this.listBackups();
      cx.notify();
    });
  }

  closeBackupView(cx) {
    this.isBackupOpen = false;
    cx.notify();
  }

  backupNow(cx) {
    cx.spawn(async (cx) => {
      try {
        await this.writeBackup(cx, true);
        notify({ title: "Backup saved", body: `${this.snippets.length} snippets`, level: "info", timeout: 2000 });
      } catch (e) {
        notify({ title: "Backup failed", body: String(e?.message ?? e), level: "error" });
      }
    });
  }

  exportToFile(cx) {
    const path = `${home()}/Downloads/herdr-snippets-${stamp()}.json`;
    const text = bundleText(this.snippets);
    cx.spawn(async (cx) => {
      try {
        await writeTextFile(path, text, null);
        this.lastExport = path;
        this.importPath.set_value(path);
        notify({ title: "Snippets exported", body: path, level: "info", timeout: 4000 });
      } catch (e) {
        notify({ title: "Export failed", body: String(e?.message ?? e), level: "error" });
      }
      cx.notify();
    });
  }

  copyJson(cx) {
    cx.write_to_clipboard(bundleText(this.snippets));
    notify({ title: "Copied as JSON", body: `${this.snippets.length} snippets`, level: "info", timeout: 2000 });
  }

  async applyImport(list, mode, cx) {
    await this.writeBackup(cx, true).catch(() => {}); // safety copy of the current state first
    if (mode === "replace") {
      this.snippets = list;
      this.save(cx);
      notify({ title: "Snippets replaced", body: `${list.length} imported`, level: "info", timeout: 3000 });
      return;
    }
    const sig = (x) => `${x.title}\u0000${x.code}`;
    const known = new Set(this.snippets.map(sig));
    const ids = new Set(this.snippets.map((x) => x.id));
    let added = 0;
    let skipped = 0;
    for (const x of list) {
      if (known.has(sig(x))) { skipped++; continue; }
      const item = ids.has(x.id) ? { ...x, id: `snip_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` } : x;
      this.snippets.unshift(item);
      known.add(sig(item));
      ids.add(item.id);
      added++;
    }
    this.save(cx);
    notify({ title: "Snippets merged", body: `${added} added, ${skipped} already present`, level: "info", timeout: 3000 });
  }

  importFromClipboard(cx) {
    const parsed = parseSnippetsText(cx.read_from_clipboard());
    if (!parsed.list) {
      notify({ title: "Import failed", body: `Clipboard: ${parsed.error}`, level: "warning" });
      return;
    }
    cx.spawn(async (cx) => { await this.applyImport(parsed.list, this.importMode, cx); cx.notify(); });
  }

  importFromFile(cx) {
    const path = expandPath(this.importPath.value());
    if (!path) {
      notify({ title: "Import failed", body: "Enter a file path first", level: "warning" });
      return;
    }
    cx.spawn(async (cx) => {
      const text = await readTextFile(path).catch(() => null);
      if (text == null) {
        notify({ title: "Import failed", body: `Cannot read ${path}`, level: "error" });
        return;
      }
      const parsed = parseSnippetsText(text);
      if (!parsed.list) {
        notify({ title: "Import failed", body: parsed.error, level: "warning" });
        return;
      }
      await this.applyImport(parsed.list, this.importMode, cx);
      cx.notify();
    });
  }

  restoreBackup(b, cx) {
    cx.spawn(async (cx) => {
      const parsed = parseSnippetsText(await readTextFile(b.path).catch(() => null));
      if (!parsed.list) {
        notify({ title: "Restore failed", body: parsed.error ?? "Backup unreadable", level: "error" });
        return;
      }
      await this.applyImport(parsed.list, "replace", cx);
      notify({ title: "Backup restored", body: b.label, level: "info", timeout: 3000 });
      cx.notify();
    });
  }

  openBackupFolder(cx) {
    cx.spawn(async () => {
      await exec("/bin/mkdir", ["-p", BACKUP_DIR()]).catch(() => {});
      await exec("/usr/bin/open", [BACKUP_DIR()]).catch(() => {});
    });
  }

  renderBackup(t, cx) {
    const good = t.done ?? "#74BBA2";
    const btn = (id, label, onClick, primary = false, tip = "") =>
      div()
        .id(id)
        .h(28)
        .px(10)
        .flex()
        .items_center()
        .justify_center()
        .rounded(6)
        .cursor_pointer()
        .border(1)
        .border_color(t.border)
        .text_size(11.5)
        .when(primary, (el) => el.bg(t.selected).font_medium().text_color(t.foreground))
        .when(!primary, (el) => el.text_color(t.muted))
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(tip)
        .on_click(onClick)
        .child(label);
    const card = (title, hint, ...children) =>
      v_flex()
        .rounded(8)
        .border(1)
        .border_color(t.border)
        .bg(t.surface ?? t.chrome)
        .p(10)
        .gap(8)
        .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child(title))
        .child(div().text_size(10.5).text_color(t.dim).child(hint))
        .children(children);
    const pill = (id, label, on, onClick) =>
      div()
        .id(id)
        .px(8)
        .py(2)
        .rounded(10)
        .cursor_pointer()
        .text_size(11)
        .when(on, (el) => el.bg(t.selected).text_color(t.foreground))
        .when(!on, (el) => el.text_color(t.dim).hover((s) => s.bg(t.hover)))
        .on_click(onClick)
        .child(label);

    return v_flex()
      .id("snippets-backup")
      .size_full()
      .bg(t.chrome)
      .text_color(t.foreground)
      .child(
        h_flex()
          .h(38)
          .px(10)
          .gap(8)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .child(
            div()
              .id("backup-back")
              .h(26)
              .px(8)
              .flex()
              .items_center()
              .rounded(6)
              .cursor_pointer()
              .text_size(12)
              .text_color(t.muted)
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .on_click((_e, cx) => this.closeBackupView(cx))
              .child("← Back")
          )
          .child(div().font_semibold().text_size(13).child("Backup, export & import"))
      )
      .child(
        v_flex()
          .id("backup-body")
          .flex_1()
          .min_h(0)
          .overflow_y_scroll()
          .p(10)
          .gap(10)
          .child(
            card(
              "Export",
              `${this.snippets.length} snippets. Saved to ~/Downloads as JSON, or copied to the clipboard.`,
              h_flex()
                .gap(6)
                .child(btn("exp-file", "Export to file", (_e, cx) => this.exportToFile(cx), true, "Write ~/Downloads/herdr-snippets-<time>.json"))
                .child(btn("exp-copy", "Copy as JSON", (_e, cx) => this.copyJson(cx), false, "Copy all snippets as JSON"))
            )
          )
          .child(
            card(
              "Import",
              "Merge adds missing snippets and skips ones you already have. Replace swaps everything. A backup of the current set is saved first either way.",
              h_flex()
                .gap(4)
                .child(pill("mode-merge", "Merge", this.importMode === "merge", (_e, cx) => { this.importMode = "merge"; cx.notify(); }))
                .child(pill("mode-replace", "Replace", this.importMode === "replace", (_e, cx) => { this.importMode = "replace"; cx.notify(); })),
              h_flex()
                .h(28)
                .px(8)
                .items_center()
                .rounded(6)
                .border(1)
                .border_color(t.border)
                .bg(t.background)
                .child(Input.new(this.importPath).flex_1().h_full().text_size(12).text_color(t.foreground)),
              h_flex()
                .gap(6)
                .child(btn("imp-file", "Import from file", (_e, cx) => this.importFromFile(cx), true, "Read the JSON file at the path above"))
                .child(btn("imp-clip", "Import from clipboard", (_e, cx) => this.importFromClipboard(cx), false, "Paste a JSON export from the clipboard"))
            )
          )
          .child(
            card(
              "Automatic backups",
              `A copy is saved a few seconds after every change (newest ${BACKUP_KEEP} kept) in ~/.config/herdr-app/snippets-backups. Updating or reloading the mod never touches them.`,
              h_flex()
                .gap(6)
                .child(btn("bk-now", "Back up now", (_e, cx) => this.backupNow(cx), true))
                .child(btn("bk-open", "Open folder", (_e, cx) => this.openBackupFolder(cx))),
              v_flex()
                .gap(4)
                .when(!this.backups.length, (el) => el.child(div().text_size(11).text_color(t.dim).child("No backups yet")))
                .children(
                  this.backups.map((b) =>
                    h_flex()
                      .id(`bk-${b.name}`)
                      .items_center()
                      .gap(8)
                      .px(8)
                      .py(4)
                      .rounded(6)
                      .bg(t.background)
                      .child(div().flex_1().min_w(0).truncate().text_size(11).font_family(String(settings()?.font ?? settings()?.font_family ?? "CommitMono Nerd Font")).text_color(t.foreground).child(b.label))
                      .child(div().text_size(10.5).text_color(t.dim).flex_none().child(`${b.count} snippets`))
                      .child(
                        div()
                          .id(`bk-restore-${b.name}`)
                          .px(8)
                          .py(2)
                          .rounded(5)
                          .cursor_pointer()
                          .text_size(11)
                          .text_color(good)
                          .hover((s) => s.bg(t.hover))
                          .tooltip("Replace current snippets with this backup (current set is backed up first)")
                          .on_click((_e, cx) => this.restoreBackup(b, cx))
                          .child("Restore")
                      )
                  )
                )
            )
          )
      );
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
    if (cx) cx.notify();
  }

  openEditForm(id, cx) {
    const s = this.snippets.find((x) => x.id === id);
    if (!s) return;
    this.editingId = id;
    this.isFormOpen = true;
    this.formTitle.set_value(s.title || "");
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
    if (cx) cx.notify();
  }

  insertMarkdown(prefix, suffix = "", sample = "text", cx) {
    if (!this.formDesc) return;
    try {
      this.formDesc.replace(`${prefix}${sample}${suffix}`);
    } catch {
      const cur = this.formDesc.value() || "";
      const sep = cur && !cur.endsWith("\n") && !cur.endsWith(" ") ? " " : "";
      this.formDesc.set_value(`${cur}${sep}${prefix}${sample}${suffix}`);
    }
    if (cx) cx.notify();
  }

  closeForm(cx) {
    this.isFormOpen = true;
    this.editingId = null;
    this.formEditor = null;
    if (cx) cx.notify();
  }

  saveForm(cx) {
    const title = this.formTitle.value().trim();
    const code = this.formEditor ? this.formEditor.value().trim() : "";
    if (!title) {
      notify({ title: "Title Required", body: "Please enter a snippet title", level: "warning" });
      return;
    }
    if (!code) {
      notify({ title: "Code Required", body: "Snippet code cannot be empty", level: "warning" });
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
    if (cx) cx.notify();
  }

  copySnippet(snippet, cx) {
    if (cx) cx.write_to_clipboard(snippet.code);
    notify({ title: "Copied to Clipboard", body: snippet.title, level: "info", timeout: 1800 });
  }

  sendToTerminal(snippet, cx) {
    if (cx) cx.write_to_clipboard(snippet.code);
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

    // If form is open, render dedicated full editor form view
    if (this.isFormOpen) {
      return this.renderForm(t, cx);
    }
    if (this.isBackupOpen) {
      return this.renderBackup(t, cx);
    }

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
                div()
                  .id("btn-backup")
                  .size(26)
                  .flex()
                  .items_center()
                  .justify_center()
                  .rounded(6)
                  .cursor_pointer()
                  .bg(t.surface ?? t.chrome)
                  .text_color(t.muted)
                  .hover((s) => s.bg(t.hover).text_color(t.foreground))
                  .tooltip("Backup, export & import")
                  .on_click((_e, cx) => this.openBackupView(cx))
                  .child(svg("mods/snippets/icons/backup.svg").size(13))
              )
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
                  .on_click((_e, cx) => this.createFromClipboard(cx))
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
                  .bg(t.selected)
                  .text_color(t.foreground)
                  .hover((s) => s.bg(t.hover))
                  .tooltip("Add new snippet")
                  .on_click((_e, cx) => this.openCreateForm("", cx))
                  .child(svg("mods/workspace-chrome/plus.svg").size(13))
                  .child(div().text_size(11.5).font_medium().child("New"))
              )
          )
      )
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
                    .on_click((_e, cx) => {
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
                  .on_click((_e, cx) => {
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
                    .on_click((_e, cx) => {
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
                    .on_click((_e, cx) => this.openCreateForm("", cx))
                    .child("+ Add a new snippet")
                )
            )
          )
          .children(filtered.map((snippet) => this.renderCard(snippet, t, cx)))
      );
  }

  renderForm(t, cx) {
    return v_flex()
      .id("snippets-form-view")
      .size_full()
      .bg(t.chrome)
      // Form Top Header
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
              .gap(6)
              .items_center()
              .cursor_pointer()
              .hover((s) => s.text_color(t.foreground))
              .on_click((_e, cx) => this.closeForm(cx))
              .child(svg("mods/filetree/chevron-left.svg").size(14).text_color(t.muted))
              .child(
                div()
                  .font_semibold()
                  .text_size(13)
                  .text_color(t.foreground)
                  .child(this.editingId ? "Edit Snippet" : "New Snippet")
              )
          )
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(
                h_flex()
                  .h(26)
                  .px(9)
                  .items_center()
                  .rounded(6)
                  .cursor_pointer()
                  .bg(t.surface ?? t.chrome)
                  .text_color(t.muted)
                  .hover((s) => s.bg(t.hover).text_color(t.foreground))
                  .on_click((_e, cx) => this.closeForm(cx))
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
                  .on_click((_e, cx) => this.saveForm(cx))
                  .child(
                    div()
                      .text_size(11.5)
                      .font_semibold()
                      .child(this.editingId ? "Save Changes" : "Create Snippet")
                  )
              )
          )
      )
      // Form Body (Scrollable)
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .overflow_y_scroll()
          .p(12)
          .gap(10)
          // Title Field
          .child(
            v_flex()
              .gap(4)
              .child(div().text_size(11.5).font_medium().text_color(t.muted).child("Snippet Title *"))
              .child(
                h_flex()
                  .h(30)
                  .px(8)
                  .items_center()
                  .rounded(6)
                  .border(1)
                  .border_color(t.border)
                  .bg(t.input ?? t.background)
                  .child(Input.new(this.formTitle).flex_1().h_full().text_size(12).text_color(t.foreground))
              )
          )
          // Language and Tags
          .child(
            h_flex()
              .gap(10)
              .child(
                v_flex()
                  .flex_1()
                  .gap(4)
                  .child(div().text_size(11.5).font_medium().text_color(t.muted).child("Language (bash, git, docker, js, php, sql)"))
                  .child(
                    h_flex()
                      .h(30)
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
                  .gap(4)
                  .child(div().text_size(11.5).font_medium().text_color(t.muted).child("Tags (comma separated)"))
                  .child(
                    h_flex()
                      .h(30)
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
          // Description Field (Multi-line Textarea with Markdown Toolbar)
          .child(
            v_flex()
              .gap(5)
              .child(
                h_flex()
                  .justify_between()
                  .items_center()
                  .child(
                    h_flex()
                      .gap(5)
                      .items_center()
                      .child(div().text_size(11.5).font_medium().text_color(t.muted).child("Description / Usage tip"))
                      .child(div().text_size(10).text_color(t.dim).child("(optional)"))
                  )
                  .child(div().text_size(10).text_color(t.dim).child("Markdown supported"))
              )
              // Dedicated Markdown Formatting Toolbar
              .child(
                h_flex()
                  .gap(3)
                  .items_center()
                  .flex_wrap()
                  .child(
                    div()
                      .id("fmt-bold")
                      .px(7)
                      .h(22)
                      .flex()
                      .items_center()
                      .justify_center()
                      .rounded(4)
                      .border(1)
                      .border_color(t.border)
                      .bg(t.surface ?? t.chrome)
                      .cursor_pointer()
                      .text_color(t.foreground)
                      .hover((s) => s.bg(t.hover))
                      .tooltip("Bold: **text**")
                      .on_click((_e, cx) => this.insertMarkdown("**", "**", "bold text", cx))
                      .child(div().font_bold().text_size(11).child("B"))
                  )
                  .child(
                    div()
                      .id("fmt-italic")
                      .px(7)
                      .h(22)
                      .flex()
                      .items_center()
                      .justify_center()
                      .rounded(4)
                      .border(1)
                      .border_color(t.border)
                      .bg(t.surface ?? t.chrome)
                      .cursor_pointer()
                      .text_color(t.foreground)
                      .hover((s) => s.bg(t.hover))
                      .tooltip("Italic: *text*")
                      .on_click((_e, cx) => this.insertMarkdown("*", "*", "italic text", cx))
                      .child(div().italic().text_size(11).child("I"))
                  )
                  .child(
                    div()
                      .id("fmt-code")
                      .px(6)
                      .h(22)
                      .flex()
                      .items_center()
                      .justify_center()
                      .rounded(4)
                      .border(1)
                      .border_color(t.border)
                      .bg(t.surface ?? t.chrome)
                      .cursor_pointer()
                      .text_color(t.done ?? "#74BBA2")
                      .hover((s) => s.bg(t.hover))
                      .tooltip("Inline code: `code`")
                      .on_click((_e, cx) => this.insertMarkdown("`", "`", "code", cx))
                      .child(div().font_family(monoFont()).text_size(10.5).child("`c`"))
                  )
                  .child(
                    div()
                      .id("fmt-heading")
                      .px(6)
                      .h(22)
                      .flex()
                      .items_center()
                      .justify_center()
                      .rounded(4)
                      .border(1)
                      .border_color(t.border)
                      .bg(t.surface ?? t.chrome)
                      .cursor_pointer()
                      .text_color(t.foreground)
                      .hover((s) => s.bg(t.hover))
                      .tooltip("Heading: ### Title")
                      .on_click((_e, cx) => this.insertMarkdown("### ", "", "Heading", cx))
                      .child(div().font_semibold().text_size(10.5).child("H3"))
                  )
                  .child(
                    div()
                      .id("fmt-list")
                      .px(6)
                      .h(22)
                      .flex()
                      .items_center()
                      .justify_center()
                      .rounded(4)
                      .border(1)
                      .border_color(t.border)
                      .bg(t.surface ?? t.chrome)
                      .cursor_pointer()
                      .text_color(t.foreground)
                      .hover((s) => s.bg(t.hover))
                      .tooltip("Bullet list: - Item")
                      .on_click((_e, cx) => this.insertMarkdown("- ", "", "item", cx))
                      .child(div().text_size(10.5).child("• List"))
                  )
                  .child(
                    div()
                      .id("fmt-quote")
                      .px(6)
                      .h(22)
                      .flex()
                      .items_center()
                      .justify_center()
                      .rounded(4)
                      .border(1)
                      .border_color(t.border)
                      .bg(t.surface ?? t.chrome)
                      .cursor_pointer()
                      .text_color(t.foreground)
                      .hover((s) => s.bg(t.hover))
                      .tooltip("Quote: > Text")
                      .on_click((_e, cx) => this.insertMarkdown("> ", "", "quote", cx))
                      .child(div().text_size(11).child("” Quote"))
                  )
                  .child(
                    div()
                      .id("fmt-link")
                      .px(6)
                      .h(22)
                      .flex()
                      .items_center()
                      .justify_center()
                      .rounded(4)
                      .border(1)
                      .border_color(t.border)
                      .bg(t.surface ?? t.chrome)
                      .cursor_pointer()
                      .text_color(t.foreground)
                      .hover((s) => s.bg(t.hover))
                      .tooltip("Link: [Title](url)")
                      .on_click((_e, cx) => this.insertMarkdown("[", "](url)", "link", cx))
                      .child(div().text_size(10.5).child("🔗 Link"))
                  )
              )
              // Textarea Box
              .child(
                v_flex()
                  .h(76)
                  .p(6)
                  .rounded(6)
                  .border(1)
                  .border_color(t.border)
                  .bg(t.input ?? t.background)
                  .child(Textarea.new(this.formDesc).size_full().text_size(12).text_color(t.foreground))
              )
          )
          // Code Editor Area
          .child(
            v_flex()
              .flex_1()
              .min_h(180)
              .gap(4)
              .child(
                h_flex()
                  .justify_between()
                  .items_center()
                  .child(div().text_size(11.5).font_medium().text_color(t.muted).child("Snippet Code *"))
                  .child(
                    div()
                      .cursor_pointer()
                      .text_size(11)
                      .text_color(t.done ?? "#74BBA2")
                      .hover((s) => s.underline())
                      .on_click((_e, cx) => {
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
                  .h(200)
                  .w_full()
                  .p(8)
                  .rounded(6)
                  .border(1)
                  .border_color(t.border)
                  .bg(t.background)
                  .child(this.formEditor ? Editor.new(this.formEditor).size_full() : div())
              )
          )
      );
  }

  renderCard(snippet, t, cx) {
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
              .gap(4)
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
                  .on_click((_e, cx) => this.copySnippet(snippet, cx))
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
                  .on_click((_e, cx) => this.sendToTerminal(snippet, cx))
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
                  .on_click((_e, cx) => this.openEditForm(snippet.id, cx))
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
                  .on_click((_e, cx) => this.deleteSnippet(snippet.id, cx))
                  .child(svg("mods/filetree/trash.svg").size(12))
              )
          )
      )
      // Description (if present, rendered with markdown support)
      .when(Boolean(snippet.description), (e) =>
        e.child(
          v_flex()
            .gap(2)
            .children(renderMarkdownInline(snippet.description, t))
        )
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
          .on_click((_e, cx) => this.copySnippet(snippet, cx))
          .children(
            lines.slice(0, 6).map((line, idx) =>
              h_flex()
                .id(`line-${snippet.id}-${idx}`)
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
