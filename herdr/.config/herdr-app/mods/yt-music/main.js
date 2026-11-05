// yt-music: the YT Music tab playing in Google Chrome, at the foot of the side panel: the
// track, its time, and previous, back 10 s, play/pause, forward 10 s and next.
//
// One connection for the whole app. daemon.js is the only process that talks to Chrome:
// one osascript kept running as a herdr-core terminal named ytm-<hash of daemon.js>
// (a name only one live terminal can hold, so a reload or a second copy reuses it). It
// writes data/yt-music/state.json when the track, play/pause or position jumps; this mod
// watches that folder (no polling) and asks for actions through data/yt-music/cmd.json.
// Chrome needs View > Developer > Allow JavaScript from Apple Events.
//
// The block shrinks to 0 px while nothing plays and grows back when a track does: the
// layout's block id is BLOCK.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as fs from "fs/promises";
import { hc, appHome, readTextFile, watchFolder, theme, run, layout } from "herdr";

const NAME = "yt-music";
const BLOCK = "yt-music";
const ICON = (name) => `mods/${NAME}/${name}.svg`;
const SEEK_SECONDS = 10;
const HEIGHT = 92; // px: title, progress, controls
const NOTE_HEIGHT = 36; // px: the one-line Chrome hint
const home = () => appHome().replace(/\\/g, "/");
const dataDir = () => `${home()}/data/${NAME}`;
const daemonFile = () => `${home()}/mods/${NAME}/daemon.js`;

const CONTROLS = [
  ["previous", "skip-back", "Previous"],
  ["back", "rewind", `Back ${SEEK_SECONDS} s`],
  ["toggle", null, null],
  ["forward", "fast-forward", `Forward ${SEEK_SECONDS} s`],
  ["next", "skip-forward", "Next"],
];

const clock = (s) => {
  const whole = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

function hash(s) {
  let h = 0x811c9dc5;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const c of node?.children ?? []) {
    const f = find(c, id);
    if (f) return f;
  }
  return null;
}

export default class YtMusic extends View {
  init(_props, cx) {
    this.state = null; // { title, artist, paused, seconds, duration, at } or { error }
    // The clock moves between the daemon's writes, only while a track plays.
    cx.timer.every(1000, (cx) => { if (this.state?.title && !this.state.paused) cx.notify(); });
    // A missed folder event must not leave an old track up: while playing, read the file
    // again every 5 s, and as soon as the clock runs past the track's end.
    this.ticks = 0;
    cx.timer.every(1000, (cx) => {
      const s = this.state;
      if (!s?.title || s.paused) return;
      const over = s.duration > 0 && s.seconds + (Date.now() - s.at) / 1000 > s.duration + 1;
      if (over || ++this.ticks % 5 === 0) cx.spawn((cx) => this.load(cx));
    });
    // The daemon can end without this mod knowing (herdr-core restarted, osascript crashed,
    // a close() of an old copy). Check it is live every 10 s and start it again if not.
    cx.timer.every(10000, (cx) => { if (this.daemon) cx.spawn(async () => { if (!(await this.daemonLive())) await this.startDaemon(); }); });
    cx.spawn(async (cx) => {
      await fs.mkdir(dataDir(), { recursive: true }).catch(() => {});
      await this.startDaemon();
      await this.load(cx);
      for (;;) {
        const changed = await watchFolder(dataDir());
        // state.json is written atomically (a temp file renamed over it), so the event can
        // name the temp file: anything but cmd.json changing is a reason to read it again.
        if (!changed.length || changed.some((p) => !p.endsWith("cmd.json"))) await this.load(cx);
      }
    });
  }

  // One daemon: started under a name only one live terminal can have. Older versions
  // (another hash) are ended first.
  async startDaemon() {
    const src = await readTextFile(daemonFile());
    this.daemon = `ytm-${hash(src ?? "")}`;
    try {
      const ls = JSON.parse((await hc(["ls", "--json"])).stdout);
      for (const t of ls.terminals ?? []) {
        if (t.name?.startsWith("ytm-") && t.name !== this.daemon && t.state === "live") await hc(["kill", t.address]);
      }
    } catch (_) {}
    // name_taken means it is already running: nothing to do.
    await hc(["run", "--name", this.daemon, "--bg", "--no-parent", "--rm", "--json", "--", "osascript", "-l", "JavaScript", daemonFile(), dataDir()]).catch(() => {});
  }

  async load(cx) {
    let s = null;
    try { s = JSON.parse((await readTextFile(`${dataDir()}/state.json`)) ?? "null"); } catch (_) { s = null; }
    this.state = s;
    this.showBlock(!s ? 0 : s.error ? NOTE_HEIGHT : HEIGHT);
    cx.notify();
  }

  act(action, cx) {
    // Shown at once; the daemon's next write sets it right.
    if (action === "toggle" && this.state?.title) {
      const s = this.state, now = Date.now();
      this.state = { ...s, paused: !s.paused, seconds: s.paused ? s.seconds : s.seconds + (now - s.at) / 1000, at: now };
    }
    cx.notify();
    fs.writeFile(`${dataDir()}/cmd.json`, JSON.stringify({ action, n: Date.now() })).catch(() => {});
    cx.spawn(async () => { if (this.daemon && !(await this.daemonLive())) await this.startDaemon(); });
  }

  // The block takes room only while there is something to show. It is never hidden: a
  // hidden block doesn't start its mod, so the daemon would never start either.
  showBlock(px) {
    const node = find(layout(), BLOCK);
    if (!node) return;
    if (node.hidden) run("layout.show", { id: BLOCK });
    if (node.size?.px !== px) run("layout.resize", { id: BLOCK, px });
  }

  async daemonLive() {
    try {
      const ls = JSON.parse((await hc(["ls", "--json"])).stdout);
      return (ls.terminals ?? []).some((t) => t.name === this.daemon && t.state === "live");
    } catch (_) { return true; } // can't tell: don't start a second one
  }

  // Ends the daemon when this block goes (quit, another layout). A reload keeps it.
  async close() {
    if (this.daemon) await hc(["kill", this.daemon]).catch(() => {});
  }

  render() {
    const t = theme(), s = this.state;
    const box = v_flex().id(NAME).size_full().px(12).justify_center().gap(6).overflow_hidden()
      .bg(t.background).border_t(1).border_color(t.border).text_size(12).text_color(t.muted)
      .on_size_change((size, cx) => { if (Math.abs(size.width - (this.width ?? 0)) > 2) { this.width = size.width; cx.notify(); } });
    if (!s) return box;
    if (s.error === "js-off") {
      return box.child(h_flex().gap(8).items_center()
        .child(svg(ICON("music")).size(12).flex_none().text_color(t.dim))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim)
          .tooltip("Chrome: View > Developer > Allow JavaScript from Apple Events")
          .child("Chrome: allow JavaScript from Apple Events")));
    }
    const button = (id, icon, tip) => {
      const main = id === "toggle";
      return div().id(`ytm-${id}`).size(main ? 28 : 24).flex_none().flex().items_center().justify_center()
        .rounded(main ? 14 : 4).cursor_pointer()
        .when(main, (el) => el.bg(t.raised).text_color(t.foreground))
        .when(!main, (el) => el.text_color(t.muted))
        .hover((el) => el.bg(t.hover).text_color(t.foreground)).tooltip(tip)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => this.act(id, cx))
        .child(svg(ICON(icon)).size(main ? 12 : 12));
    };
    const seconds = s.paused ? s.seconds : Math.min(s.duration || Infinity, s.seconds + (Date.now() - s.at) / 1000);
    const pct = s.duration > 0 ? Math.min(1, seconds / s.duration) : 0;
    // The bar spans what the two times leave.
    const W = Math.max(40, (this.width ?? 360) - 24 - 2 * 34 - 2 * 8);
    return box
      // 1: the track
      .child(h_flex().gap(7).items_center().tooltip(`${s.title} · ${s.artist}`)
        .child(svg(ICON("music")).size(12).flex_none().text_color(s.paused ? t.dim : t.ansi1))
        .child(div().flex_shrink(1).min_w(0).truncate().text_color(s.paused ? t.muted : t.foreground).font_medium().child(s.title))
        .child(div().flex_shrink(2).min_w(0).truncate().text_color(t.dim).child(s.artist)))
      // 2: where it is
      .child(h_flex().gap(8).items_center().text_size(11)
        .child(div().w(34).flex_none().text_color(t.dim).child(clock(seconds)))
        .child(div().w(W).h(4).flex_none().rounded(2).bg(t.raised).child(div().h_full().rounded(2).w(pct * W).bg(s.paused ? t.dim : t.ansi2)))
        .child(div().w(34).flex_none().text_right().text_color(t.dim).child(clock(s.duration))))
      // 3: the controls
      .child(h_flex().gap(6).items_center().justify_center().children(CONTROLS.map(([id, icon, tip]) =>
        id === "toggle" ? button(id, s.paused ? "play" : "pause", s.paused ? "Play" : "Pause") : button(id, icon, tip))));
  }
}
