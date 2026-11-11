import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, InputState } from "gpui-base";
import { theme, settings, exec, notify, home, readTextFile, writeTextFile } from "herdr";

const NAME = "ports";
const monoFont = () => String(settings()?.font ?? settings()?.font_family ?? "CommitMono Nerd Font");
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

// ---- Tunnel providers -------------------------------------------------
const TUNNEL_DIR = () => `${home()}/.config/herdr-app/tunnels`;
const TUNNEL_STATE = () => `${home()}/.config/herdr-app/tunnels.json`;
const shq = (x) => `'${String(x).replace(/'/g, `'\\''`)}'`;

const PROVIDERS = [
  {
    id: "cloudflare", label: "Cloudflare", bin: "cloudflared", hint: "brew install cloudflared",
    args: (p) => ["tunnel", "--no-autoupdate", "--url", `http://localhost:${p}`],
    url: /(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/i,
    err: /(ERR|failed|error)/i,
  },
  {
    id: "ngrok", label: "ngrok", bin: "ngrok", hint: "brew install ngrok && ngrok config add-authtoken <token>",
    args: (p) => ["http", String(p), "--log=stdout", "--log-format=logfmt"],
    url: /\burl=(https:\/\/\S+)/i,
    err: /(ERR_NGROK_\d+|authentication failed|err=)/i,
  },
  {
    id: "localhostrun", label: "localhost.run", bin: "ssh", hint: "uses ssh (no install)",
    args: (p) => ["-o", "StrictHostKeyChecking=accept-new", "-o", "ServerAliveInterval=30", "-o", "ExitOnForwardFailure=yes", "-R", `80:localhost:${p}`, "nokey@localhost.run"],
    url: /(https:\/\/[a-z0-9-]+\.lhr\.life)/i,
    err: /(denied|refused|failed|error)/i,
  },
];

async function resolveBin(name) {
  const script = `for p in /opt/homebrew/bin/${name} /usr/local/bin/${name} /usr/bin/${name}; do [ -x "$p" ] && echo "$p" && exit 0; done; command -v ${name}`;
  const r = await exec("/bin/sh", ["-c", script]).catch(() => null);
  const out = String(r?.stdout || "").trim().split("\n")[0];
  return out || null;
}

async function loadTunnels() {
  try {
    const raw = await readTextFile(TUNNEL_STATE());
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// writeTextFile(path, text, null) only creates; replacing needs the current text as `expected`.
async function replaceTextFile(path, text) {
  const current = await readTextFile(path).catch(() => null);
  await writeTextFile(path, text, current ?? null);
}

function saveTunnels(list) {
  return replaceTextFile(TUNNEL_STATE(), JSON.stringify(list, null, 2)).catch((e) => console.error("save tunnels:", e));
}

async function startTunnel(provider, bin, port) {
  const dir = TUNNEL_DIR();
  await exec("/bin/mkdir", ["-p", dir]);
  const id = `${provider.id}-${port}-${Date.now().toString(36)}`;
  const log = `${dir}/${id}.log`;
  const cmd = [bin, ...provider.args(port)].map(shq).join(" ");
  const r = await exec("/bin/sh", ["-c", `nohup ${cmd} >${shq(log)} 2>&1 </dev/null & echo $!`]);
  const pid = Number(String(r.stdout || "").trim());
  if (!pid) throw new Error("could not start tunnel");
  return { id, provider: provider.id, port, pid, log, url: null, status: "starting", startedAt: Date.now(), error: null };
}

async function aliveSet(pids) {
  if (!pids.length) return new Set();
  const r = await exec("/bin/ps", ["-p", pids.join(","), "-o", "pid="]).catch(() => null);
  return new Set(String(r?.stdout || "").split("\n").map((l) => Number(l.trim())).filter(Boolean));
}

async function stopTunnel(t) {
  await exec("/bin/kill", ["-TERM", String(t.pid)]).catch(() => {});
  await exec("/bin/rm", ["-f", t.log]).catch(() => {});
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
    if (!prev) seen.set(key, { ...r, local: /^(127\.|[\[]?::1[\]]?|localhost)/.test(r.addr) });
    else if (!/^(127\.|[\[]?::1[\]]?)/.test(r.addr)) prev.local = false;
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
    this.updatedAt = 0;
    this.tunnels = [];
    this.bins = {};
    this.pickKey = null;
    this.starting = new Set();

    this.search = InputState.new({ placeholder: "Filter port (e.g. 3000), app, PID..." });
    this.search.on("change", (_e, cx) => {
      this.query = this.search.value().trim().toLowerCase();
      cx.notify();
    });

    this.refresh(cx);
    cx.timer.every(4000, () => {
      this.refresh(cx, true);
      this.pollTunnels(cx);
    });

    cx.spawn(async (cx) => {
      for (const p of PROVIDERS) this.bins[p.id] = await resolveBin(p.bin);
      this.tunnels = await loadTunnels();
      await this.pollTunnels(cx);
      cx.notify();
    });
  }

  async pollTunnels(cx) {
    if (!this.tunnels.length || this.polling) return;
    this.polling = true;
    try {
      const alive = await aliveSet(this.tunnels.map((t) => t.pid));
      let changed = false;
      for (const t of this.tunnels) {
        if (t.status === "stopped" || t.status === "error") continue;
        const prov = PROVIDERS.find((p) => p.id === t.provider);
        const up = alive.has(t.pid);
        let text = "";
        if (!t.url || !up) {
          try { text = String((await readTextFile(t.log)) || ""); } catch {}
        }
        if (!t.url && prov) {
          const m = text.match(prov.url);
          if (m) { t.url = m[1]; t.status = "live"; changed = true; }
        }
        if (!up) {
          t.status = t.url ? "stopped" : "error";
          if (!t.url) {
            const lines = text.split("\n").filter((l) => l.trim());
            const bad = lines.reverse().find((l) => prov?.err.test(l)) ?? lines[0] ?? "tunnel exited";
            t.error = bad.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 200);
          }
          changed = true;
        }
      }
      if (changed) { await saveTunnels(this.tunnels); cx.notify(); }
    } finally {
      this.polling = false;
    }
  }

  tunnelFor(port) {
    return this.tunnels.find((t) => t.port === port && (t.status === "starting" || t.status === "live"));
  }

  startShare(r, provider, cx) {
    const bin = this.bins[provider.id];
    const key = `${r.port}:${provider.id}`;
    if (!bin) {
      notify({ title: `${provider.label} not installed`, body: provider.hint, level: "warning", timeout: 5000 });
      return;
    }
    this.pickKey = null;
    this.starting.add(key);
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const t = await startTunnel(provider, bin, r.port);
        this.tunnels.unshift(t);
        await saveTunnels(this.tunnels);
        notify({ title: `Starting ${provider.label}`, body: `localhost:${r.port}`, level: "info", timeout: 1800 });
        cx.timer.after(1500, (cx) => this.pollTunnels(cx));
        cx.timer.after(3500, (cx) => this.pollTunnels(cx));
        cx.timer.after(7000, (cx) => this.pollTunnels(cx));
      } catch (e) {
        notify({ title: "Tunnel failed", body: String(e?.message ?? e), level: "error" });
      } finally {
        this.starting.delete(key);
        cx.notify();
      }
    });
  }

  endTunnel(t, cx) {
    this.tunnels = this.tunnels.filter((x) => x.id !== t.id);
    cx.notify();
    cx.spawn(async () => {
      await stopTunnel(t);
      await saveTunnels(this.tunnels);
    });
  }

  copyUrl(t, cx) {
    if (!t.url) return;
    cx.write_to_clipboard(t.url);
    notify({ title: "Public URL copied", body: t.url, level: "info", timeout: 1800 });
  }

  openUrl(tun, cx) {
    if (!tun.url) return;
    notify({ title: "Opening Browser", body: tun.url, level: "info", timeout: 1500 });
    const doOpen = async () => {
      try {
        await exec("/usr/bin/open", [tun.url]);
      } catch {
        await exec("open", [tun.url]).catch(() => {});
      }
    };
    if (cx && typeof cx.spawn === "function") {
      cx.spawn(async () => { await doOpen(); });
    } else {
      doOpen();
    }
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
    const gen = (this.confirmGen = (this.confirmGen ?? 0) + 1);
    this.confirmKey = key;
    cx.timer.after(3000, (cx) => {
      if (this.confirmGen === gen) {
        this.confirmKey = null;
        cx.notify();
      }
    });
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
      cx.timer.after(400, (cx) => this.refresh(cx, true));
    });
    cx.notify();
  }

  openBrowser(r, cx) {
    const url = `http://localhost:${r.port}`;
    notify({ title: "Opening Browser", body: url, level: "info", timeout: 1500 });
    const doOpen = async () => {
      try {
        await exec("/usr/bin/open", [url]);
      } catch (e) {
        await exec("open", [url]).catch((err) => {
          notify({ title: "Open failed", body: String(err?.message ?? err), level: "error" });
        });
      }
    };
    if (cx && typeof cx.spawn === "function") {
      cx.spawn(async () => { await doOpen(); });
    } else {
      doOpen();
    }
  }

  copyPort(r, cx) {
    cx.write_to_clipboard(String(r.port));
    notify({ title: "Copied", body: `:${r.port}`, level: "info", timeout: 1200 });
  }

  isDev(r) {
    if (KNOWN[r.port]) return true;
    return (r.port >= 3000 && r.port < 10000) || (r.port >= 10000 && !!r.local && r.port < 65000 && /node|php|python|ruby|bun|deno|java|go|vite|docker|nginx|artisan/i.test(r.full || r.cmd));
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
    const tun = this.tunnelFor(r.port);
    const pick = this.pickKey === key && !tun;
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
              .child(this.iconBtn(`o-${key}`, "mods/ports/icons/open.svg", `Open http://localhost:${r.port} in default browser`, t, null, (_e, cx) => this.openBrowser(r, cx)))
              .child(this.iconBtn(`c-${key}`, "mods/filetree/copy.svg", "Copy port", t, null, (_e, cx) => this.copyPort(r, cx)))
              .child(
                this.iconBtn(
                  `s-${key}`,
                  "mods/ports/icons/share.svg",
                  tun ? "Tunnel active" : "Share via tunnel (Cloudflare, ngrok, ...)",
                  t,
                  t.done ?? "#74BBA2",
                  (_e, cx) => { this.pickKey = this.pickKey === key ? null : key; cx.notify(); }
                )
              )
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
      .when(pick, (el) =>
        el.child(
          h_flex()
            .gap(6)
            .items_center()
            .pt(4)
            .child(div().text_size(10.5).text_color(t.dim).child("Share via"))
            .children(
              PROVIDERS.map((p) => {
                const ok = !!this.bins[p.id];
                return div()
                  .id(`sp-${key}-${p.id}`)
                  .px(8)
                  .py(3)
                  .rounded(6)
                  .cursor_pointer()
                  .border(1)
                  .border_color(t.border)
                  .text_size(11)
                  .text_color(ok ? t.foreground : t.dim)
                  .hover((s) => s.bg(t.hover))
                  .tooltip(ok ? `Expose localhost:${r.port} with ${p.label}` : `${p.label} not installed: ${p.hint}`)
                  .on_click((_e, cx) => this.startShare(r, p, cx))
                  .child(this.starting.has(`${r.port}:${p.id}`) ? "..." : p.label);
              })
            )
        )
      )
      .when(!!tun, (el) => el.child(this.renderTunnel(tun, t, cx, true)))
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

  renderTunnel(tun, t, cx, inline = false) {
    const prov = PROVIDERS.find((p) => p.id === tun.provider);
    const live = tun.status === "live";
    const bad = tun.status === "error";
    const danger = t.error ?? "#e5736f";
    const color = bad ? danger : live ? (t.done ?? "#74BBA2") : t.dim;
    const text = live ? tun.url : bad ? tun.error || "tunnel failed" : tun.status === "stopped" ? `stopped · ${tun.url ?? ""}` : "connecting...";
    return h_flex()
      .id(`tun-${tun.id}${inline ? "-i" : ""}`)
      .gap(6)
      .items_center()
      .rounded(6)
      .px(8)
      .py(5)
      .bg(t.selected)
      .child(div().text_size(10).font_medium().text_color(color).flex_none().child(`${prov?.label ?? tun.provider}${inline ? "" : ` :${tun.port}`}`))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(live ? t.foreground : color).child(text))
      .when(live, (el) =>
        el
          .child(this.iconBtn(`tc-${tun.id}${inline ? "-i" : ""}`, "mods/filetree/copy.svg", "Copy public URL", t, null, (_e, cx) => this.copyUrl(tun, cx)))
          .child(this.iconBtn(`to-${tun.id}${inline ? "-i" : ""}`, "mods/ports/icons/open.svg", "Open public URL", t, null, (_e, cx) => this.openUrl(tun, cx)))
      )
      .child(
        this.iconBtn(
          `tx-${tun.id}${inline ? "-i" : ""}`,
          "mods/ports/icons/stop.svg",
          live || tun.status === "starting" ? "Stop tunnel" : "Dismiss",
          t,
          danger,
          (_e, cx) => this.endTunnel(tun, cx)
        )
      );
  }

  render(cx) {
    const t = theme();
    const q = this.query;
    const cleanQ = q.startsWith(":") ? q.slice(1) : q;
    const filtered = this.ports.filter((r) => {
      if (this.devOnly && !this.isDev(r)) return false;
      if (!q) return true;
      return (
        String(r.port).includes(cleanQ) ||
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
      // Search and Filter Bar
      .child(
        v_flex()
          .p(8)
          .gap(6)
          .border_b(1)
          .border_color(t.border)
          .bg(t.background)
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
              .child(Input.new(this.search).flex_1().h_full().text_size(12).text_color(t.foreground))
              .when(Boolean(this.query), (e) =>
                e.child(
                  div()
                    .size(16)
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(4)
                    .cursor_pointer()
                    .text_color(t.dim)
                    .hover((s) => s.text_color(t.foreground).bg(t.hover))
                    .tooltip("Clear filter")
                    .on_click((_e, cx) => {
                      this.search.set_value("");
                      this.query = "";
                      cx.notify();
                    })
                    .child("×")
                )
              )
          )
          .child(
            h_flex()
              .items_center()
              .justify_between()
              .child(
                h_flex()
                  .gap(4)
                  .child(pill("f-dev", "Dev Ports", this.devOnly, (_e, cx) => { this.devOnly = true; cx.notify(); }))
                  .child(pill("f-all", "All Ports", !this.devOnly, (_e, cx) => { this.devOnly = false; cx.notify(); }))
              )
              .child(
                div()
                  .text_size(10.5)
                  .text_color(t.dim)
                  .child(`${filtered.length} visible`)
              )
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
          .when(this.tunnels.some((x) => !this.ports.some((r) => r.port === x.port) || x.status === "error" || x.status === "stopped"), (el) =>
            el.child(
              v_flex()
                .gap(4)
                .child(div().text_size(10.5).text_color(t.dim).child("Tunnels"))
                .children(
                  this.tunnels
                    .filter((x) => !this.ports.some((r) => r.port === x.port) || x.status === "error" || x.status === "stopped")
                    .map((x) => this.renderTunnel(x, t, cx))
                )
            )
          )
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
