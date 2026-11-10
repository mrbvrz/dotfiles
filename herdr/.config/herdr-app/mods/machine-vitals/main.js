// This Mac at a glance: CPU over the last two minutes, network throughput, memory as Activity Monitor
// counts it (colored by memory pressure), disk and battery. One cheap shell call
// per sample; click opens Activity Monitor.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, layout, window } from "herdr";
import { SCRIPT, PROCS, parse, parseProcs, gb, fmtSpeed, fmtShort } from "./stats.js";

const SAMPLES = 40; // CPU and Net history: 40 samples, 2 minutes while the window is in front
const EVERY = 3000; // ms between samples while the window is in front
const AWAY = 30000; // ms between samples while it is behind
function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

export default class MachineVitals extends View {
  init(_props, cx) {
    this.cpu = [];
    this.net = [];
    this.prevNet = null;
    this.netRate = { down: 0, up: 0 };
    this.now = null;
    this.busy = false;
    this.last = 0;
    this.procs = [];
    this.sample(cx);
    cx.timer.every(EVERY, (cx) => {
      if (Date.now() - this.last >= (window().active ? EVERY : AWAY) - 100) this.sample(cx);
    });
  }

  sample(cx) {
    if (this.busy) return;
    this.busy = true;
    this.last = Date.now();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", SCRIPT]);
        const s = parse(r.stdout);
        if (s.cpu !== null) this.cpu = [...this.cpu, s.cpu].slice(-SAMPLES);
        if (s.net) {
          if (this.prevNet) {
            const dt = Math.max(0.5, (s.net.time - this.prevNet.time) / 1000);
            const down = Math.max(0, (s.net.inBytes - this.prevNet.inBytes) / dt);
            const up = Math.max(0, (s.net.outBytes - this.prevNet.outBytes) / dt);
            this.netRate = { down, up };
            this.net = [...this.net, down + up].slice(-SAMPLES);
          }
          this.prevNet = s.net;
        }
        this.now = s;
        this.error = null;
      } catch (e) {
        this.error = String(e);
      } finally {
        this.busy = false;
      }
      cx.notify();
    });
  }

  loadProcs(cx) {
    cx.spawn(async (cx) => {
      try { this.procs = parseProcs((await exec("sh", ["-c", PROCS])).stdout); } catch { this.procs = []; }
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const s = this.now;
    const cpu = this.cpu.at(-1) ?? null;
    const warn = (pct, high = 85) => (pct >= 95 ? t.ansi1 : pct >= high ? t.ansi3 : t.accent);
    const memColor = !s ? t.accent : s.mem.pressure >= 4 ? t.ansi1 : s.mem.pressure >= 2 ? t.ansi3 : t.accent;
    const memPct = s?.mem.total ? (s.mem.used / s.mem.total) * 100 : 0;
    const diskUsed = s?.disk ? 100 - (s.disk.free / s.disk.total) * 100 : 0;
    const pressureName = { 1: "normal", 2: "warning", 4: "critical" }[s?.mem.pressure] ?? "unknown";

    const root = v_flex()
      .id("machine-vitals")
      .size_full()
      .bg(t.chrome)
      .text_size(12)
      .cursor_pointer()
      .on_click(() => exec("open", ["-a", "Activity Monitor"]).catch(() => {}));

    if (narrow()) {
      const cpuColorNarrow = cpu === null ? t.dim : warn(cpu);
      const mini = (label, pct, color) =>
        v_flex().items_center().child(div().text_size(9).text_color(t.dim).child(label))
          .child(div().text_size(11).text_color(color).child(pct === null ? "–" : pct));
      return root.items_center().justify_center().gap(6)
        .child(mini("CPU", cpu === null ? null : `${Math.round(cpu)}%`, cpuColorNarrow))
        .child(mini("NET", fmtShort(this.netRate.down + this.netRate.up), cpuColorNarrow))
        .child(mini("MEM", s ? `${Math.round(memPct)}%` : null, cpuColorNarrow));
    }

    const bar = (pct, color) =>
      div().flex_1().h(6).rounded(3).bg(t.border).overflow_hidden()
        .child(div().h_full().w(`${Math.max(0, Math.min(100, pct))}%`).rounded(3).bg(color));
    const row = (id, label, viz, value, valueColor, tip, onHover) =>
      h_flex().id(id).h(20).gap(8).items_center()
        .child(div().w(30).flex_none().text_size(11).text_color(t.dim).child(label))
        .child(viz)
        .child(div().w(72).flex_none().text_right().text_size(11.5).text_color(valueColor ?? t.foreground).truncate().child(value))
        .when(Boolean(tip), (el) => el.tooltip(tip))
        .when(Boolean(onHover), (el) => el.on_hover(onHover));

    const spark = h_flex().flex_1().h(18).items_end().gap(1).children(
      Array.from({ length: SAMPLES }, (_, i) => {
        const v = this.cpu[i - (SAMPLES - this.cpu.length)];
        return div().flex_1().min_w(1).rounded(1)
          .h(v === undefined ? 1 : Math.max(1, Math.round((v / 100) * 18)))
          .bg(v === undefined ? t.border : i === SAMPLES - 1 ? warn(v) : warn(v) + "99");
      }),
    );

    const maxNet = Math.max(50 * 1024, ...(this.net.length ? this.net : [50 * 1024]));
    const netSpark = h_flex().flex_1().h(18).items_end().gap(1).children(
      Array.from({ length: SAMPLES }, (_, i) => {
        const v = this.net[i - (SAMPLES - this.net.length)];
        return div().flex_1().min_w(1).rounded(1)
          .h(v === undefined ? 1 : Math.max(1, Math.round((v / maxNet) * 18)))
          .bg(v === undefined ? t.border : i === SAMPLES - 1 ? t.accent : t.accent + "99");
      }),
    );

    const b = s?.battery;
    const battColor = (pct) => {
      if (pct <= 20) return t.ansi1;
      if (pct <= 50) return t.ansi3;
      return t.done ?? t.ansi2;
    };
    const bColor = b ? battColor(b.pct) : t.dim;
    const header = h_flex().px(16).h(30).pt(8).flex_none().items_center().justify_between()
      .child(div().text_size(11.5).font_medium().text_color(t.dim).child("This Mac"))
      .when(Boolean(b), (el) => el.child(
        h_flex().id("mv-battery").gap(4).items_center().text_size(11).text_color(bColor)
          .when(b.ac, (el) => el.child(svg("mods/machine-vitals/plug.svg").size(12).text_color(bColor)))
          .child(`Battery ${b.pct}%`)
          .tooltip(`Battery ${b.pct}%, ${b.state}${b.ac ? ", on AC power" : ""}`)));

    const procs = this.procs.map((p) => `${p.name}  ${Math.round(p.cpu)}%`).join("\n");
    const netTip = `Network Activity:\nDownload: ${fmtSpeed(this.netRate.down)}\nUpload: ${fmtSpeed(this.netRate.up)}\nTotal In: ${gb(s?.net?.inBytes ?? 0)} GB\nTotal Out: ${gb(s?.net?.outBytes ?? 0)} GB`;
    const netVal = `↓${fmtShort(this.netRate.down)} ↑${fmtShort(this.netRate.up)}`;
    const cpuColor = cpu === null ? t.dim : warn(cpu) === t.accent ? null : warn(cpu);

    return root
      .child(header)
      .child(
        v_flex().px(16).pb(6).gap(1)
          .when(Boolean(this.error) && !s, (el) => el.child(div().text_size(11).text_color(t.ansi1).truncate().child(this.error)))
          .child(row("mv-cpu", "CPU", spark, cpu === null ? "…" : `${Math.round(cpu)}%`, cpuColor,
            procs ? `Most CPU lately:\n${procs}` : "Most CPU lately: …", (hovered, cx) => { if (hovered) this.loadProcs(cx); }))
          .child(row("mv-net", "Net", netSpark, netVal, cpuColor, netTip, null))
          .child(row("mv-mem", "Mem", bar(memPct, memColor), s ? `${gb(s.mem.used)}/${gb(s.mem.total)} GB` : "…", cpuColor,
            s ? `Memory pressure ${pressureName}${s.swap ? `, swap used ${gb(s.swap)} GB` : ", no swap"}` : null))
          .child(row("mv-disk", "Disk", bar(diskUsed, warn(diskUsed, 90)), s?.disk ? `${gb(s.disk.free)} GB free` : "…", diskUsed >= 90 ? warn(diskUsed, 90) : null, null)),
      );
  }
}
