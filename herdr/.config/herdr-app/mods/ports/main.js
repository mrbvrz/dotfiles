import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, InputState } from "gpui-base";
import { theme, settings, exec, notify } from "herdr";

const NAME = "ports";
const uiSize = () => Number(settings()?.ui_font_size) || 13;

// Well-known dev ports -> friendly label
const KNOWN = {
  3000: "Node / React", 3306: "MySQL", 4200: "Angular", 5173: "Vite", 5432: "PostgreSQL",
  5000: "Flask / Mac AirPlay", 6379: "Redis", 8000: "Laravel / Django", 8080: "HTTP alt",
  8081: "Metro / HTTP", 9000: "PHP-FPM / misc", 27017: "MongoDB", 80: "HTTP", 443: "HTTPS",
};

async function sh(cmd, args) {
  try {
    return await exec(cmd, args);
  } catch {
    return await exec(`/usr/sbin/${cmd}`, args).catch(() => exec(`/usr/bin/${cmd}`, args));
  }
}

function unescapeLsof(s) {
  return s.replace(/\\x([0-9a-fA-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
}

async function listPorts() {
  const res = await sh("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-FpcLn"]);
  // -F output: p<pid> c<cmd> L<user> n<addr:port> (n repeats per socket)
  const rows = [];
  let cur = null;
  for (const line of String(res.stdout || "").split("\n")) {
    if (!line) continue;
    const k = line[0], v = line.slice(1);
    if (k === "p") cur = { pid: Number(v), cmd: "", user: "", socks: [] };
    else if (!cur) continue;
    else if (k === "c") cur.cmd = unescapeLsof(v);
    else if (k === "L") cur.user = v;
    else if (k === "n") {
      const i = v.lastIndexOf(":");
      const port = Number(v.slice(i + 1));
      if (Number.isFinite(port)) {
        const addr = v.slice(0, i);
        rows.push({ pid: cur.pid, cmd: cur.cmd, user: cur.user, port, addr });
      }
    }
  }
  // dedupe (ipv4 + ipv6 same pid/port)
  const seen = new Map();
  for (const r of rows) {
    const key = `${r.pid}:${r.port}`;
    const prev = seen.get(key);
    if (!prev) seen.set(key, { ...r, local: /^(127\.|\[?::1\]?|localhost)/.test(r.addr) });
    else if (!/^(127\.|\[?::1\]?)/.test(r.addr)) prev.local = false;
  }
  const list = [...seen.values()].sort((a, b) => a.port - b.port);

  // Full command lines for context
  if (list.length) {
    const pids = [...new Set(list.map((r) => r.pid))].join(",");
    const ps = await sh("ps", ["-p", pids, "-o", "pid=,command="]).catch(() => null);
    const map = {};
    for (const l of String(ps?.stdout || "").split("\n")) {
      const m = l.trim().match(/^(\d+)\s+(.*)$/);
      if (m) map[m[1]] = m[2];
    }
    for (const r of list) r.full = map[r.pid] || r.cmd;
  }
  return list;
}

export default class PortsMod extends View {
  init(_props, cx) {
    this.ports = [];
    this.loading = true;
    this.error = null;
    this.query = "";
    this.devOnly = true;
    this.confirmKey = null;
    this.confirmTimer = null;
    this.updatedAt = 0;

    this.search = InputState.new({ placeholder: "Filter port, process, command..." });
    this.search.on("change", (_e, cx) => {
      this.query = this.search.value().trim().toLowerCase();
      cx.notify();
    });

    this.refresh(cx);
    cx.timer.every(4000, () => this.refresh(cx, true));
  }

  refresh(cx, quiet = false) {
    if (this.busy) return;
    this.busy = true;
    if (!quiet) {
      this.loading = true;
      cx.notify();
    }
    cx.spawn(async (cx) => {
      try {
        const next = await listPorts();
        const sig = (l) => l.map((r) => `${r.pid}:${r.port}`).join(",");
        const changed = sig(next) !== sig(this.ports) || this.error;
        this.ports = next;
        this.error = null;
        this.updatedAt = Date.now();
        if (changed || !quiet) cx.notify();
      } catch (e) {
        this.error = String(e?.message ?? e);
        cx.notify();
      } finally {
        this.busy = false;
        if (this.loading) {
          this.loading = false;
          cx.notify();
        }
      }
    });
  }

  ask(key, cx) {
    if (this.confirmTimer) clearTimeout(this.confirmTimer);
    this.confirmKey = key;
    this.confirmTimer = setTimeout(() => {
      this.confirmKey = null;
      cx.notify();
    }, 3000);
    cx.notify();
  }

  kill(r, force, cx) {
    this.confirmKey = null;
    cx.spawn(async (cx) => {
      try {
        const res = await sh("kill", [force ? "-9" : "-TERM", String(r.pid)]);
        if (res.code && res.code !== 0) throw new Error(String(res.stderr || "kill failed").trim());
        notify({ title: "Process stopped", body: `${r.cmd} (PID ${r.pid}) on :${r.port}`, level: "info", timeout: 2000 });
      } catch (e) {
        notify({ title: "Kill failed", body: String(e?.message ?? e), level: "error" });
      }
      setTimeout(() => this.refresh(cx, true), 400);
    });
    cx.notify();
  }

  openBrowser(r, cx) {
    cx.spawn(async () => {
      await sh("open", [`http://localhost:${r.port}`]).catch(() => {});
    });
  }

  copyPort(r, cx) {
    cx.write_to_clipboard(String(r.port));
    notify({ title: "Copied", body: `:${r.port}`, level: "info", timeout: 1200 });
  }

  isDev(r) {
    if (KNOWN[r.port]) return true;
    return r.port >= 3000 && r.port < 10000 || r.port >= 10000 && !!r.local && r.port < 65000 && /node|php|python|ruby|bun|deno|java|go|vite|docker|nginx|artisan/i.test(r.full || r.cmd);
  }

  iconBtn(id, icon, tip, t, color, onClick) {
    return div()
      .id(id)
      .size(24)
      .flex()
      .items_center()
      .justify_center()
      .rounded(5)
      .cursor_pointer()
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(color ?? t.foreground))
      .tooltip(tip)
      .on_click(onClick)
      .child(svg(icon).size(13));
  }

  renderRow(r, t, cx) {
    const key = `${r.pid}:${r.port}`;
    const confirming = this.confirmKey === key;
    const label = KNOWN[r.port];
    const danger = t.error ?? "#e5736f";
    return v_flex()
      .id(`port-${key}`)
      .rounded(8)
      .border(1)
      .border_color(t.border)
      .bg(t.surface ?? t.chrome)
      .p(10)
      .gap(4)
      .child(
        h_flex()
          .items_center()
          .gap(8)
          .child(
            div()
              .font_semibold()
              .text_size(14)
              .text_color(t.foreground)
              .child(`:${r.port}`)
          )
          .child(
            div()
              .flex_1()
              .min_w(0)
              .truncate()
              .text_size(12)
              .text_color(t.foreground)
              .child(r.cmd)
          )
          .child(
            div()
              .px(5)
              .py(1)
              .rounded(4)
              .bg(t.selected)
              .text_color(r.local ? (t.done ?? "#74BBA2") : danger)
              .text_size(10)
              .font_medium()
              .child(r.local ? "local" : "exposed")
          )
          .child(
            h_flex()
              .gap(2)
              .flex_none()
              .child(this.iconBtn(`o-${key}`, "mods/ports/icons/open.svg", `Open http://localhost:${r.port}`, t, null, () => this.openBrowser(r, cx)))
              .child(this.iconBtn(`c-${key}`, "mods/filetree/copy.svg", "Copy port", t, null, (_e, cx) => this.copyPort(r, cx)))
              .child(
                confirming
                  ? div()
                      .id(`k-${key}`)
                      .h(24)
                      .px(8)
                      .flex()
                      .items_center()
                      .rounded(5)
                      .cursor_pointer()
                      .bg(danger)
                      .text_color("#ffffff")
                      .text_size(11)
                      .font_medium()
                      .tooltip("Click again to stop (SIGTERM). Shift-click = force kill")
                      .on_click((e, cx) => this.kill(r, !!e?.modifiers?.shift, cx))
                      .child("Stop?")
                  : this.iconBtn(`k-${key}`, "mods/ports/icons/stop.svg", "Stop process", t, danger, (_e, cx) => this.ask(key, cx))
              )
          )
      )
      .child(
        div()
          .text_size(10.5)
          .text_color(t.dim)
          .truncate()
          .child([`PID ${r.pid}`, r.user, r.addr === "*" ? "all interfaces" : r.addr, label].filter(Boolean).join(" · "))
      )
      .when(r.full && r.full !== r.cmd, (el) =>
        el.child(
          div()
            .text_size(10.5)
            .text_color(t.dim)
            .truncate()
            .child(r.full)
        )
      );
  }

  render(cx) {
    const t = theme();
    const q = this.query;
    const filtered = this.ports.filter((r) => {
      if (this.devOnly && !this.isDev(r)) return false;
      if (!q) return true;
      return (
        String(r.port).includes(q) ||
        String(r.pid).includes(q) ||
        r.cmd.toLowerCase().includes(q) ||
        (r.full || "").toLowerCase().includes(q) ||
        (KNOWN[r.port] || "").toLowerCase().includes(q)
      );
    });

    const pill = (id, text, on, onClick) =>
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
        .child(text);

    return v_flex()
      .id("ports-mod")
      .size_full()
      .bg(t.chrome)
      .text_color(t.foreground)
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
              .child(svg("mods/ports/icons/ports.svg").size(14).text_color(t.dim))
              .child(div().font_semibold().text_size(uiSize()).child("Ports"))
              .child(div().text_size(11).text_color(t.dim).child(`${filtered.length}/${this.ports.length}`))
          )
          .child(
            this.iconBtn("refresh", "mods/filetree/refresh.svg", "Refresh now", t, null, (_e, cx) => this.refresh(cx))
          )
      )
      .child(
        v_flex()
          .p(10)
          .gap(8)
          .child(Input.new(this.search).h(28).text_size(12).text_color(t.foreground))
          .child(
            h_flex()
              .gap(4)
              .child(pill("f-dev", "Dev", this.devOnly, (_e, cx) => { this.devOnly = true; cx.notify(); }))
              .child(pill("f-all", "All", !this.devOnly, (_e, cx) => { this.devOnly = false; cx.notify(); }))
          )
      )
      .child(
        v_flex()
          .id("ports-list")
          .flex_1()
          .min_h(0)
          .overflow_y_scroll()
          .px(10)
          .pb(10)
          .gap(6)
          .when(!!this.error, (el) =>
            el.child(div().text_size(12).text_color(t.error ?? "#e5736f").child(this.error))
          )
          .when(!this.error && this.loading && !this.ports.length, (el) =>
            el.child(div().text_size(12).text_color(t.dim).child("Scanning ports..."))
          )
          .when(!this.error && !this.loading && !filtered.length, (el) =>
            el.child(
              div()
                .py(24)
                .flex()
                .justify_center()
                .text_size(12)
                .text_color(t.dim)
                .child(this.ports.length ? "No ports match the filter" : "No listening ports")
            )
          )
          .children(filtered.map((r) => this.renderRow(r, t, cx)))
      );
  }
}
