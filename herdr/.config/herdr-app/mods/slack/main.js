// slack: read and answer Slack from Herdr's side panel. A list of conversations in two
// groups (direct messages, channels), newest first; a click opens one full height with the
// reply box at the bottom, scrolling back through its history, and emoji reactions.
//
// Two copies of this one mod, one Slack connection:
//   props { bg: true }     a 0 px block in the layout. It holds the only connection: Slack's
//                          Socket Mode (one websocket, pushed events, no polling), the Web
//                          API calls, the unread counts and the toasts. It draws nothing.
//   props { panel: true }  the side panel. It only draws what the first one publishes in
//                          shared state ("slack.state") and asks it to act through
//                          "slack.cmd". Opening or closing the panel never reconnects.
//
// Tokens, both in data/slack/, readable by you only. The panel's setup steps (setup.js) make
// the Slack app, check both tokens and save them; they open by themselves while a token is
// missing or Slack rejects one, and from the gear menu (Change tokens, Sign out).
//   app-token   xapp-…  Socket Mode connection (scope connections:write)
//   user-token  xoxp-…  reading and replying as you (reacting also needs reactions:write)
//
// Slack gives this token no way to mark a conversation read, so "read" is kept here:
// opening a conversation clears its count in Herdr only.
import { View, div, svg, image } from "gpui-kit";
import * as fs from "fs/promises";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { WebSocket } from "websocket";
import EMOJI_NAMES from "./emoji-map.js";
import { call, AUTH_ERRORS, missingScopes, newWizard, renderSetup, runCheck, saveTokens, removeTokens, button, lock } from "./setup.js";
import { theme, settings, props as given, appHome, readTextFile, notify, shared, setShared, nextCommand, exec, home, window as appWindow, playSound, run } from "herdr";

const NAME = "slack";
const ICON = (name) => `mods/${NAME}/${name}.svg`;
const STATE = "slack.state", CMD = "slack.cmd", UNREAD = "slack.unread", PEOPLE = "slack.people";
const HYDRATE_DAYS = 60; // a conversation last heard from longer ago than this is not looked at again
const HYDRATE_MS = 1500; // between those calls: Slack allows about 50 a minute
const HISTORY = 40;
const SHOWN = 100; // rows in a group
const KIND_ICON = { im: "user", mpim: "users", group: "lock", channel: "hash" };
const GROUPS = [
  { id: "dm", label: "Direct messages", kinds: ["im", "mpim"] },
  { id: "ch", label: "Channels", kinds: ["channel", "group"] },
];

// Slack's reaction names as characters. A name not here (a custom emoji) shows as :name:.
const EMOJI = {
  "+1": "👍", "-1": "👎", thumbsup: "👍", thumbsdown: "👎", heart: "❤️", joy: "😂", smile: "😄", smiley: "😃", grin: "😁", laughing: "😆",
  sweat_smile: "😅", wink: "😉", blush: "😊", slightly_smiling_face: "🙂", upside_down_face: "🙃", thinking_face: "🤔", cry: "😢", sob: "😭",
  tada: "🎉", eyes: "👀", white_check_mark: "✅", heavy_check_mark: "✔️", x: "❌", pray: "🙏", fire: "🔥", rocket: "🚀", clap: "👏", raised_hands: "🙌",
  "100": "💯", ok_hand: "👌", muscle: "💪", wave: "👋", sparkles: "✨", star: "⭐", warning: "⚠️", bug: "🐛", hourglass: "⌛", coffee: "☕",
  zap: "⚡", bulb: "💡", memo: "📝", pushpin: "📌", point_up: "☝️", handshake: "🤝", party_popper: "🎉", rofl: "🤣", sunglasses: "😎", sleeping: "😴",
};
const QUICK = ["+1", "heart", "joy", "tada", "eyes", "white_check_mark", "pray", "fire"];
const emoji = (name) => { const n = String(name).split("::")[0]; return EMOJI_NAMES[n] ?? EMOJI[n] ?? `:${n}:`; };
// Text as Slack writes it, made readable: :white_check_mark: → ✅ (a workspace's own emoji stay
// as :name:), and *bold* / _italic_ / ~strike~ markers dropped, since a line here is one style.
const pretty = (x) => x
  .replace(/:([a-z0-9_+'-]+)(?:::skin-tone-\d)?:/g, (all, n) => EMOJI_NAMES[n] ?? EMOJI[n] ?? all)
  .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,:;!?-])/g, "$1$2")
  .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,:;!?-])/g, "$1$2")
  .replace(/(^|[\s(])~([^~\n]+)~(?=$|[\s).,:;!?-])/g, "$1$2");

const dir = () => `${appHome().replace(/\\/g, "/")}/data/${NAME}`;
const sleep = (cx, ms) => new Promise((done) => cx.timer.after(ms, () => done()));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function clock(ms) {
  const d = new Date(ms), h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
function dayLabel(ms) {
  const d = new Date(ms), now = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  return diff === 0 ? "Today" : diff === 1 ? "Yesterday" : `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ""}`;
}
// Each person keeps one colour, as in Slack. Six hues far apart from each other and from
// green (yours), in a bright set for dark themes and a deep set for light ones. A person's
// colour comes from a hash of their Slack id; in one chat, two people never share one: the
// second takes the next free colour.
const NAME_COLORS = {
  dark: ["#5eb1ff", "#c792ea", "#ff6b81", "#ffb454", "#2ed3c6", "#f2d74e"],
  light: ["#1f6fd1", "#8a3fc7", "#c9334a", "#b85f00", "#0f8f86", "#8a7500"],
};
const LINK = "#5eb1ff";
const MENTION = {
  dark: { fg: "#1d9bd1", bg: "#1d9bd126", meFg: "#f2f2f2", meBg: "#f2c74466" },
  light: { fg: "#1264a3", bg: "#1d9bd11a", meFg: "#1d1c1d", meBg: "#f2c74466" },
};
const hashOf = (uid) => { let h = 0; for (const ch of String(uid)) h = (h * 31 + ch.codePointAt(0)) >>> 0; return h; };
function chatColors(messages, dark) {
  const set = dark ? NAME_COLORS.dark : NAME_COLORS.light, used = new Set(), out = new Map();
  for (const m of messages) {
    const uid = m.uid || m.who;
    if (m.mine || out.has(uid)) continue;
    let i = hashOf(uid) % set.length;
    for (let k = 0; k < set.length && used.has(i); k++) i = (i + 1) % set.length;
    used.add(i);
    out.set(uid, set[i]);
  }
  return out;
}
function faceFile(uid, url) {
  const ext = (String(url).match(/\.(png|jpe?g|gif)(?=\?|$)/i)?.[0] ?? ".jpg").toLowerCase();
  return `${uid}-${hashOf(url).toString(36)}${ext}`;
}
function sizeOf(n) {
  if (!n) return "";
  return n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
}
const fileUrl = (path) => (path.startsWith("/") ? `file://${encodeURI(path)}` : `file:///${encodeURI(path.replace(/\\/g, "/"))}`);
function ago(ms) {
  if (!ms) return "";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
}

// Slack's mrkdwn as plain text: <@U1> → @name, <#C1|general> → #general, <url|label> → label.
function plainText(text, names) {
  return String(text ?? "")
    .replace(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g, (_m, id) => `@${names.get(id) ?? "someone"}`)
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .replace(/<!(here|channel|everyone)[^>]*>/g, "@$1")
    .replace(/<(?:mailto:|tel:)?([^>|]+)\|([^>]+)>/g, "$2")
    .replace(/<([^>|]+)>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/[\s\S]*/, (all) => pretty(all));
}

// The same text as parts, so links keep their address: { t: "text", s } | { t: "link", url, label }.
function segmentsOf(text, names) {
  const decode = (x) => pretty(x.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
  const out = [], src = String(text ?? "");
  let at = 0;
  for (const m of src.matchAll(/<([^>]+)>/g)) {
    if (m.index > at) out.push({ t: "text", s: decode(src.slice(at, m.index)) });
    at = m.index + m[0].length;
    const [target, label] = m[1].split("|");
    if (/^@[UW]/.test(target)) out.push({ t: "mention", id: target.slice(1), label: `@${names.get(target.slice(1)) ?? label ?? "someone"}` });
    else if (target.startsWith("#")) out.push({ t: "mention", id: target.slice(1), channel: true, label: `#${label ?? target.slice(1)}` });
    else if (/^!(here|channel|everyone)/.test(target)) out.push({ t: "mention", id: "!", label: `@${target.slice(1).split("^")[0].split("|")[0]}` });
    else if (target.startsWith("!")) out.push({ t: "text", s: label ?? `@${target.slice(1).split("^")[0]}` });
    else if (/^(https?:|mailto:)/.test(target)) out.push({ t: "link", url: decode(target), label: decode(label ?? target.replace(/^mailto:/, "")) });
    else out.push({ t: "text", s: decode(label ?? target) });
  }
  if (at < src.length) out.push({ t: "text", s: decode(src.slice(at)) });
  return out;
}

export default class Slack extends View {
  init(initial, cx) {
    const p = given() ?? initial ?? {};
    this.isBg = Boolean(p.bg);
    if (this.isBg) return this.initBg(cx);
    // The panel: its own inputs, and the last command it waits on.
    this.filter = InputState.new();
    this.filterEmpty = true;
    this.filter.on("change", (_e, cx) => { this.filterEmpty = !this.filter.value(); cx.notify(); });
    this.reply = InputState.new();
    this.replyEmpty = true;
    this.reply.on("change", (_e, cx) => { this.replyEmpty = !this.reply.value(); this.findMention(); cx.notify(); });
    // Enter picks the highlighted person while the @ list is open, and sends otherwise.
    this.reply.on("submit", (_e, cx) => {
      const list = this.mention ? this.mentionList() : [];
      if (list.length) this.pickMention(list[Math.min(this.mentionSel, list.length - 1)], cx);
      else this.send(cx);
    });
    // @mentions: the word being typed after @, the highlighted row, and the names picked
    // (as written in the box → their Slack id, turned into <@id> when sent).
    this.mention = null;
    this.mentionSel = 0;
    this.picked = new Map();
    this.pending = null; // the number of the send waiting for an answer
    // Setup: the two token fields (drawn as passwords), where the steps are, and the
    // background copy's generation the person closed setup for (it doesn't reopen for it).
    this.dir = dir();
    this.appIn = InputState.new();
    this.appIn.set_masked(true);
    this.appEmpty = true;
    this.appIn.on("change", (_e, cx) => { this.appEmpty = !this.appIn.value(); if (this.wiz) this.wiz.check.app = null; cx.notify(); });
    this.appIn.on("submit", (_e, cx) => { if (this.wiz) runCheck(this, "app", cx); });
    this.userIn = InputState.new();
    this.userIn.set_masked(true);
    this.userEmpty = true;
    this.userIn.on("change", (_e, cx) => { this.userEmpty = !this.userIn.value(); if (this.wiz) this.wiz.check.user = null; cx.notify(); });
    this.userIn.on("submit", (_e, cx) => { if (this.wiz) runCheck(this, "user", cx); });
    this.wiz = null;
    this.closedGen = null;
    this.menu = false;
    this.signoutArmed = false;
    this.folded = new Set();
    this.chat = { id: null, off: 0, viewH: 0, contentH: 0, hover: null, pick: null, askedOlder: null };
    // herdr-app do slack.open-<name, _ for spaces> opens a conversation; slack.close goes back;
    // slack.thread / slack.unthread open and leave the newest thread there.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        try {
          if (c === "close") this.command({ type: "close" });
          else if (c === "setup" || c === "setup-fix") this.wiz = newWizard(shared(STATE), c === "setup-fix");
          else if (/^setup-[1-4]$/.test(c)) { this.wiz = this.wiz ?? newWizard(shared(STATE)); this.wiz.step = Number(c.slice(6)); }
          else if (c === "setup-close") this.closeSetup(null);
          else if (c === "reconnect") this.command({ type: "reload" });
          else if (c === "toast-test") this.command({ type: "toasttest" });
          else if (c === "notif") { const o = shared(STATE)?.open; this.notifOpen = this.notifOpen ? null : o?.id ?? null; }
          else if (c === "download-latest") {
            const f = [...(shared(STATE)?.open?.messages ?? [])].reverse().flatMap((m) => m.files ?? []).find((x) => x.url && !x.external);
            if (f) this.command({ type: "download", file: f });
          }
          else if (c.startsWith("type-")) { this.reply.set_value(c.slice(5).replaceAll("_", " ")); this.replyEmpty = !this.reply.value(); this.findMention(); }
          else if (c === "pick") { const list = this.mention ? this.mentionList() : []; if (list.length) this.pickMention(list[0], { notify() {} }); }
          // slack.thread opens the newest thread in the open conversation; slack.unthread goes back.
          else if (c === "thread") {
            const o = shared(STATE)?.open, m = [...(o?.messages ?? [])].reverse().find((x) => x.replies > 0);
            if (m) this.command({ type: "thread", id: o.id, ts: m.ts });
          } else if (c === "unthread") this.command({ type: "unthread" });
          else if (c.startsWith("open-")) {
            const want = c.slice(5).replaceAll("_", " ").toLowerCase();
            const hit = (shared(STATE)?.convs ?? []).filter((x) => x.title.toLowerCase().includes(want)).sort((a, b) => (b.title.toLowerCase() === want) - (a.title.toLowerCase() === want) || b.ts - a.ts)[0];
            if (hit) this.command({ type: "open", id: hit.id });
          }
        } catch (_) {}
        cx.notify();
      }
    });
  }

  // ── panel: ask ─────────────────────────────────────────────────────────────────────────
  command(cmd) {
    this.cmdN = (this.cmdN ?? 0) + 1;
    const n = `${Date.now()}.${this.cmdN}`;
    setShared(CMD, { n, ...cmd });
    return n;
  }

  // "@ra" at the end of the box: the list opens with the people that match.
  findMention() {
    const v = this.reply.value(), m = v.match(/(^|\s)@([^\s@]{0,30})$/);
    const next = m ? { start: v.length - m[2].length - 1, q: m[2].toLowerCase() } : null;
    if (next?.q !== this.mention?.q) this.mentionSel = 0;
    this.mention = next;
  }

  // People for the @ list: who wrote in this conversation first, then by how well the name
  // matches (start of the name, start of a word in it, anywhere).
  mentionList() {
    const q = this.mention?.q ?? "", people = shared(PEOPLE) ?? [];
    const o = shared(STATE)?.open, recent = new Map();
    [...(o?.messages ?? [])].reverse().forEach((m, i) => { if (!m.mine && m.uid && !recent.has(m.uid)) recent.set(m.uid, i); });
    const score = (p) => {
      const fields = [p.name, p.real, p.handle].map((x) => String(x ?? "").toLowerCase());
      if (!q) return recent.has(p.id) ? 0 : 5;
      if (fields.some((x) => x.startsWith(q))) return recent.has(p.id) ? 0 : 1;
      if (fields.some((x) => x.split(/[\s._-]+/).some((w) => w.startsWith(q)))) return 2;
      if (fields.some((x) => x.includes(q))) return 3;
      return 9;
    };
    return people.map((p) => [score(p), p]).filter(([sc]) => sc < 9)
      .sort((a, b) => a[0] - b[0] || (recent.get(a[1].id) ?? 999) - (recent.get(b[1].id) ?? 999) || a[1].name.localeCompare(b[1].name))
      .slice(0, 6).map(([, p]) => p);
  }

  pickMention(p, cx) {
    if (!this.mention || !p) return;
    const v = this.reply.value(), label = `@${p.name}`, next = `${v.slice(0, this.mention.start)}${label} `;
    this.picked.set(label, p.id);
    this.mention = null;
    this.reply.set_value(next);
    this.reply.set_selected_range({ start: next.length, end: next.length });
    this.reply.focus();
    this.replyEmpty = false;
    cx.notify();
  }

  // What Slack gets: picked names, and any @handle typed out in full, as <@id>.
  withMentions(text) {
    for (const [label, id] of [...this.picked].sort((a, b) => b[0].length - a[0].length)) text = text.split(label).join(`<@${id}>`);
    const byHandle = new Map((shared(PEOPLE) ?? []).filter((p) => p.handle).map((p) => [p.handle.toLowerCase(), p.id]));
    return text.replace(/(^|\s)@([a-z0-9._-]+)/gi, (all, sp, h) => (byHandle.has(h.toLowerCase()) ? `${sp}<@${byHandle.get(h.toLowerCase())}>` : all));
  }

  send(cx) {
    const S = shared(STATE), text = this.withMentions(this.reply.value().trim());
    if (!S?.open || !text || this.pending) return;
    this.mention = null;
    this.pending = this.command({ type: "send", id: S.open.id, text, thread_ts: S.open.thread?.ts ?? null });
    cx.notify();
  }

  // ── panel: setup ───────────────────────────────────────────────────────────────────────
  finishSetup(cx) {
    const W = this.wiz;
    if (!W || W.saving) return;
    const app = this.appIn.value().replace(/\s+/g, ""), user = this.userIn.value().replace(/\s+/g, "");
    W.saving = true;
    W.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await saveTokens(this.dir, { "app-token": app, "user-token": user });
        this.closedGen = shared(STATE)?.gen ?? null;
        this.command({ type: "reload" });
        this.wiz = null;
        this.appIn.set_value("");
        this.userIn.set_value("");
      } catch (e) {
        W.saving = false;
        W.error = `Couldn't save the tokens: ${e?.message ?? e}`;
      }
      cx.notify();
    });
  }

  closeSetup(cx) {
    this.wiz = null;
    this.closedGen = shared(STATE)?.gen ?? null;
    this.appIn.set_value("");
    this.userIn.set_value("");
    cx?.notify();
  }

  signOut(cx) {
    this.menu = false;
    this.signoutArmed = false;
    cx.spawn(async (cx) => {
      await removeTokens(this.dir);
      this.command({ type: "reload" });
      cx.notify();
    });
  }

  // ── background copy ────────────────────────────────────────────────────────────────────
  initBg(cx) {
    this.convs = new Map(); // id → { id, kind, name, title, user, unread, mention, preview, ts, updated }
    this.users = new Map(); // id → name
    this.me = null;
    this.team = "";
    this.status = "starting";
    this.error = null;
    this.open = null;
    this.result = null; // { n, ok, error } of the last send
    // Each start (and each reload after setup) is one generation; the loops of an older one stop.
    this.gen = 0;
    this.needs = null; // "app" | "user": the token setup asks for again
    this.has = { app: false, user: false };
    this.missing = []; // the user token's missing permissions: [{ scope, what }]
    // Profile pictures: Slack's address for each person (and app), and the ones downloaded
    // into data/slack/avatars/ (kept between starts), as paths image() takes.
    this.faces = new Map();
    this.avatars = {};
    this.faceQueue = [];
    this.faceAsked = new Set();
    // Everyone who can be @mentioned: { id, name, real, handle }.
    this.people = new Map();
    // Files downloaded or downloading: file id → { state: "busy" | "done" | "error", path, error }.
    this.downloads = {};
    this.soundOn = true;
    try { this.soundOn = localStorage.getItem("sound") !== "off"; } catch (_) {}
    this.seen = {};
    this.cache = {}; // id → { ts, preview }: the last message of each conversation, kept so the list is in order at once
    try { this.seen = JSON.parse(localStorage.getItem("seen") ?? "{}"); } catch (_) {}
    try { this.cache = JSON.parse(localStorage.getItem("cache") ?? "{}"); } catch (_) {}
    // Channels whose messages make no toast (an @mention still does). Set from the bell in a
    // conversation's header.
    // How each conversation notifies, as in Slack: id → { level: "all" | "mentions" | "nothing",
    // muted }. Muted: no toast, no count, greyed in the list; an @mention still comes through.
    // pauseUntil: no toasts or sounds at all until then (Slack's "Pause notifications").
    this.prefs = {};
    this.pauseUntil = 0;
    try { this.prefs = JSON.parse(localStorage.getItem("prefs") ?? "{}"); } catch (_) {}
    try { for (const id of JSON.parse(localStorage.getItem("muted") ?? "[]")) this.prefs[id] = { ...this.prefs[id], muted: true }; localStorage.removeItem("muted"); } catch (_) {}
    try { this.pauseUntil = Number(localStorage.getItem("pauseUntil")) || 0; } catch (_) {}
    this.dirty = true;
    this.cacheDirty = false;
    this.lastCmd = shared(CMD)?.n ?? null; // an old command is not redone
    cx.timer.every(500, () => this.publish());
    cx.timer.every(250, (cx) => this.poll(cx));
    cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        const m = /^goto-([A-Z0-9]+)(?:-(\d+)_(\d+))?$/.exec(c);
        if (m) await this.goto(m[1], m[2] ? `${m[2]}.${m[3]}` : null).catch(() => {});
        // slack.pause-<minutes> and slack.resume, for the command line
        else if (/^pause-\d+$/.test(c) || c === "resume") {
          this.pauseUntil = c === "resume" ? 0 : Date.now() + Number(c.slice(6)) * 60000;
          try { localStorage.setItem("pauseUntil", String(this.pauseUntil)); } catch (_) {}
          this.dirty = true;
        }
      }
    });
    cx.spawn(async (cx) => {
      try { await this.boot(cx, 0); } catch (e) { if (this.gen === 0) this.fail(e); }
    });
  }

  // New tokens saved, or signed out: drop the connection and everything loaded, start again.
  reload(cx) {
    this.gen += 1;
    const gen = this.gen, ws = this.ws;
    this.ws = null;
    if (ws) ws.close().catch(() => {});
    this.convs = new Map();
    this.users = new Map();
    this.open = null;
    this.me = null;
    this.team = "";
    this.status = "starting";
    this.error = null;
    this.needs = null;
    this.missing = [];
    this.dirty = true;
    cx.spawn(async (cx) => {
      try { await this.boot(cx, gen); } catch (e) { if (gen === this.gen) this.fail(e); }
    });
  }

  needSetup(which, error) {
    this.status = "setup";
    this.needs = which;
    this.error = error;
    this.dirty = true;
  }

  fail(e) {
    this.status = "error";
    this.error = String(e?.message ?? e);
    this.dirty = true;
  }

  readToken(file) {
    return readTextFile(`${dir()}/${file}`).then((t) => t?.replace(/\s+/g, "") || null).catch(() => null);
  }

  async boot(cx, gen) {
    this.appToken = await this.readToken("app-token");
    this.userToken = await this.readToken("user-token");
    if (gen !== this.gen) return;
    this.has = { app: Boolean(this.appToken), user: Boolean(this.userToken) };
    if (!this.appToken || !this.userToken) {
      this.needSetup(!this.appToken && !this.userToken ? null : !this.appToken ? "app" : "user", null);
      return;
    }
    const who = await this.api("auth.test");
    if (gen !== this.gen) return;
    if (!who.ok && AUTH_ERRORS.has(who.error)) return this.needSetup("user", `Slack rejected the user token (${who.error}). Paste a new one.`);
    if (!who.ok) throw new Error(`Slack says ${who.error}`);
    this.me = { id: who.user_id, name: who.user };
    this.team = who.team ?? "";
    this.users.set(who.user_id, who.user);
    this.status = "loading";
    this.dirty = true;
    await this.loadConversations();
    if (gen !== this.gen) return;
    await this.loadUsers();
    if (gen !== this.gen) return;
    for (const c of this.convs.values()) this.nameConv(c);
    setShared(PEOPLE, [...this.people.values()]);
    this.needFace(this.me.id);
    for (const c of this.convs.values()) if (c.kind === "im") this.needFace(c.user);
    this.dirty = true;
    cx.spawn((cx) => this.faceLoop(cx, gen));
    cx.spawn((cx) => this.connectLoop(cx, gen));
    cx.spawn(async () => {
      const missing = await missingScopes(this.userToken).catch(() => []);
      if (gen === this.gen) { this.missing = missing; this.dirty = true; }
    });
    await this.hydrate(cx, gen);
  }

  api(method, params, post) {
    return call(this.userToken, method, params, post);
  }

  async loadUsers() {
    let cursor = "";
    for (let page = 0; page < 8; page++) {
      const j = await this.api("users.list", { limit: "200", cursor });
      if (!j.ok) break;
      for (const u of j.members ?? []) {
        const name = u.profile?.display_name || u.profile?.real_name || u.real_name || u.name;
        this.users.set(u.id, name);
        const url = u.profile?.image_48 || u.profile?.image_72;
        if (url) this.faces.set(u.id, url);
        if (!u.deleted && !u.is_bot && u.id !== "USLACKBOT") this.people.set(u.id, { id: u.id, name, real: u.profile?.real_name || u.real_name || "", handle: u.name ?? "" });
      }
      cursor = j.response_metadata?.next_cursor;
      if (!cursor) break;
    }
  }

  async loadConversations() {
    let cursor = "";
    for (let page = 0; page < 10; page++) {
      const j = await this.api("users.conversations", { types: "im,mpim,public_channel,private_channel", exclude_archived: "true", limit: "200", cursor });
      if (!j.ok) throw new Error(`Slack says ${j.error}`);
      for (const c of j.channels ?? []) this.addConv(c);
      cursor = j.response_metadata?.next_cursor;
      if (!cursor) break;
    }
  }

  addConv(c) {
    const kind = c.is_im ? "im" : c.is_mpim ? "mpim" : c.is_private || c.is_group ? "group" : "channel";
    const kept = this.cache[c.id];
    const conv = { id: c.id, kind, name: c.name ?? "", user: c.user ?? null, unread: 0, mention: false, preview: kept?.preview ?? "", ts: kept?.ts ?? 0, updated: c.updated ?? 0, dormant: Boolean(c.properties?.is_dormant) };
    this.convs.set(c.id, conv);
    return conv;
  }

  nameConv(c) {
    if (c.kind === "im") { c.title = this.users.get(c.user) ?? c.user ?? "Direct message"; return; }
    if (c.kind === "mpim") {
      const handles = c.name.replace(/^mpdm-/, "").replace(/-\d+$/, "").split("--").filter((h) => h && h !== this.me?.name);
      c.title = handles.length > 3 ? `${handles.slice(0, 3).join(", ")} +${handles.length - 3}` : handles.join(", ") || "Group";
      return;
    }
    c.title = c.name;
  }

  // The conversations active lately get their last message and unread count, one every
  // 1.25 s (Slack allows about 50 a minute), most active first. The others wait until they
  // are opened or someone writes in them. What was found is kept for the next start.
  async hydrate(cx, gen) {
    this.status = "live";
    this.dirty = true;
    // Slack's "updated" time says nothing about the last message (a group quiet since 2023
    // shows as updated today), so every conversation is asked once: direct messages, then
    // channels, then group chats; those already known quiet for 60 days are left alone.
    // The first start goes through all of them (about 10 minutes, and the list reorders as
    // they arrive); later starts begin from the kept last messages.
    const since = Date.now() - HYDRATE_DAYS * 86400000;
    const rank = (c) => (c.kind === "im" ? 0 : c.kind === "mpim" ? 2 : 1);
    const todo = [...this.convs.values()]
      .filter((c) => !c.dormant && (c.ts ? c.ts > since : true))
      .sort((x, y) => rank(x) - rank(y) || y.ts - x.ts);
    for (const c of todo) {
      if (gen !== this.gen) return;
      // Slack answers 429 when too many calls come close together: wait, then try this one again.
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await Promise.race([this.hydrateOne(c), sleep(cx, 15000)]); break; } catch (e) {
          if (!/rate limiting/.test(String(e?.message))) break;
          await sleep(cx, 20000);
        }
      }
      await sleep(cx, HYDRATE_MS);
    }
  }

  // The last message of a conversation comes from conversations.history (conversations.info
  // leaves it out for many). conversations.info is asked only when that message is new, for
  // the point you had read up to and Slack's own count.
  async hydrateOne(c) {
    const h = await this.api("conversations.history", { channel: c.id, limit: "1" });
    if (!h.ok) return;
    const latest = h.messages?.[0];
    if (!latest) return;
    c.ts = Number(latest.ts) * 1000;
    if (latest.user && !this.users.has(latest.user)) await this.resolveUsers([latest.user]);
    c.preview = this.previewOf(c, latest);
    this.cacheDirty = true;
    const mine = latest.user === this.me.id;
    // Older than two weeks is history, not news (an old app DM stays "unread" in Slack for ever).
    const fresh = Number(latest.ts) > Number(this.seen[c.id] ?? 0) && Date.now() - c.ts < 14 * 86400000;
    c.unread = 0;
    if (!mine && fresh) {
      const j = await this.api("conversations.info", { channel: c.id });
      const lastRead = j.ok ? j.channel.last_read : null;
      const count = j.ok ? j.channel.unread_count_display ?? null : null;
      const unreadNow = lastRead ? Number(latest.ts) > Number(lastRead) : true;
      c.unread = unreadNow ? count || 1 : 0;
    }
    this.dirty = true;
  }

  previewOf(c, m) {
    const body = plainText(m.text, this.users).replace(/\s+/g, " ").trim() || (m.files?.length ? "[file]" : "[message]");
    const who = m.user === this.me.id ? "You" : this.users.get(m.user);
    return c.kind === "im" ? (m.user === this.me.id ? `You: ${body}` : body) : who ? `${who}: ${body}` : body;
  }

  // ── background: Socket Mode ─────────────────────────────────────────────────────────────
  async connectLoop(cx, gen) {
    let wait = 2000;
    while (gen === this.gen) {
      try {
        const o = await call(this.appToken, "apps.connections.open", {}, true);
        if (gen !== this.gen) return;
        if (!o.ok && (AUTH_ERRORS.has(o.error) || o.error === "missing_scope")) return this.needSetup("app", `Slack rejected the app token (${o.error}). Paste a new one.`);
        if (!o.ok) throw new Error(`Slack says ${o.error}`);
        const ws = await WebSocket.connect(o.url);
        if (gen !== this.gen) { await ws.close().catch(() => {}); return; }
        this.ws = ws;
        wait = 2000;
        for (;;) {
          const raw = await ws.read();
          if (gen !== this.gen) return;
          const msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
          if (msg.envelope_id) await ws.write(JSON.stringify({ envelope_id: msg.envelope_id }));
          if (msg.type === "hello") { this.status = "live"; this.error = null; this.dirty = true; }
          else if (msg.type === "disconnect") break;
          else if (msg.type === "events_api") await this.onEvent(msg.payload?.event, cx);
        }
        await ws.close().catch(() => {});
      } catch (e) {
        if (gen !== this.gen) return;
        this.status = "reconnecting";
        this.error = String(e?.message ?? e);
        this.dirty = true;
      }
      this.ws = null;
      await sleep(cx, wait);
      wait = Math.min(30000, wait * 2);
    }
  }

  async onEvent(ev, cx) {
    if (!ev || ev.type !== "message" || !ev.channel) return;
    // An app's message brings its icon: the toast shows it once downloaded.
    if (!ev.user && ev.bot_id && !this.faces.has(ev.bot_id)) {
      const url = ev.bot_profile?.icons?.image_48 ?? ev.icons?.image_48;
      if (url) this.faces.set(ev.bot_id, url);
    }
    if (ev.subtype && !["thread_broadcast", "file_share", "me_message", "bot_message"].includes(ev.subtype)) return;
    let c = this.convs.get(ev.channel);
    // A reply in a thread: into the thread when it is open, a count on its first message, and
    // a toast when it is for you. It doesn't go into the conversation itself.
    if (ev.thread_ts && ev.thread_ts !== ev.ts && ev.subtype !== "thread_broadcast") {
      if (ev.user && !this.users.has(ev.user)) await this.resolveUsers([ev.user]);
      const o = this.open?.id === ev.channel ? this.open : null;
      const parent = o?.messages.find((m) => m.ts === ev.thread_ts);
      if (o?.thread?.ts === ev.thread_ts && !o.thread.messages.some((m) => m.ts === ev.ts)) {
        o.thread.messages.push(this.normalize(ev));
        if (parent) parent.replies += 1;
      } else if (parent) parent.replies += 1;
      if (parent) {
        parent.lastReply = Number(ev.ts) * 1000;
        if (ev.user && !parent.repliers.some((r) => r.id === ev.user)) parent.repliers = [...parent.repliers, { id: ev.user, name: ev.user === this.me.id ? "You" : this.users.get(ev.user) ?? "someone" }].slice(0, 4);
      }
      const mentioned = (ev.text ?? "").includes(`<@${this.me.id}>`) || /<!(here|channel|everyone)/.test(ev.text ?? "");
      if (ev.user !== this.me.id && c && (mentioned || c.kind === "im" || c.kind === "mpim") && o?.thread?.ts !== ev.thread_ts && this.shouldNotify(c, mentioned)) {
        const from = this.users.get(ev.user) ?? ev.username ?? ev.bot_profile?.name ?? "Slack";
        this.toast(c, { thread: ev.thread_ts, title: from, where: c.kind === "im" ? "Reply in your thread" : `Thread in ${c.kind === "channel" ? "#" : ""}${c.title}`, body: plainText(ev.text, this.users).slice(0, 160) || "[file]", uid: ev.user, mention: mentioned });
      }
      this.dirty = true;
      return;
    }
    if (!c) {
      const j = await this.api("conversations.info", { channel: ev.channel });
      if (!j.ok) return;
      c = this.addConv(j.channel);
      this.nameConv(c);
    }
    if (ev.user && !this.users.has(ev.user)) await this.resolveUsers([ev.user]);
    const mine = ev.user === this.me.id;
    const shown = this.open?.id === c.id;
    c.ts = Number(ev.ts) * 1000;
    c.preview = this.previewOf(c, ev);
    this.cacheDirty = true;
    if (shown) {
      if (!this.open.messages.some((m) => m.ts === ev.ts)) this.open.messages.push(this.normalize(ev));
      this.seen[c.id] = ev.ts;
      this.saveSeen();
    } else if (!mine) {
      c.unread += 1;
      const mentioned = (ev.text ?? "").includes(`<@${this.me.id}>`) || /<!(here|channel|everyone)/.test(ev.text ?? "");
      if (mentioned) c.mention = true;
      if (this.shouldNotify(c, mentioned)) {
        const from = this.users.get(ev.user) ?? ev.username ?? ev.bot_profile?.name ?? "Slack";
        this.toast(c, { title: from, where: c.kind === "im" ? "Direct message" : c.kind === "mpim" ? c.title : `${c.kind === "channel" ? "#" : ""}${c.title}`, body: plainText(ev.text, this.users).slice(0, 160) || "[file]", uid: ev.user ?? ev.bot_id, mention: mentioned });
      }
    }
    this.dirty = true;
  }

  async resolveUsers(ids) {
    for (const id of [...new Set(ids)].filter((i) => i && !this.users.has(i)).slice(0, 8)) {
      const j = await this.api("users.info", { user: id }).catch(() => null);
      const u = j?.ok ? j.user : null;
      this.users.set(id, u ? u.profile?.display_name || u.real_name || u.name : "someone");
      if (u?.profile?.image_48) this.faces.set(id, u.profile.image_48);
    }
  }

  // Asks for a person's picture once; faceLoop downloads them one at a time with curl (on
  // macOS, Linux and Windows 10+), skipping the ones already on disk.
  needFace(uid) {
    if (!uid || this.avatars[uid] || this.faceAsked.has(uid) || !this.faces.has(uid)) return;
    this.faceAsked.add(uid);
    this.faceQueue.push(uid);
  }

  async faceLoop(cx, gen) {
    const folder = `${dir()}/avatars`;
    await fs.mkdir(folder, { recursive: true }).catch(() => {});
    const have = new Set(await fs.readdir(folder).catch(() => []));
    while (gen === this.gen) {
      const uid = this.faceQueue.shift();
      if (!uid) { await sleep(cx, 400); continue; }
      const url = this.faces.get(uid);
      if (!url) continue;
      const name = faceFile(uid, url);
      if (!have.has(name)) {
        const r = await exec("curl", ["-sfL", "--max-time", "20", "-o", `${folder}/${name}`, url]).catch(() => null);
        if (!r || r.code !== 0) continue;
        have.add(name);
      }
      this.avatars[uid] = `data/${NAME}/avatars/${name}`;
      this.dirty = true;
    }
  }

  // A file into Downloads, under its own name. A mod may only touch files in its own data
  // folder, so curl does all of it: makes the folder, keeps a file already there (adding .1,
  // .2 to the new one's name) and says where it put it. It gets the user token from a header
  // file readable by you only, removed right after, so the token never shows in the process
  // list. Slack answers a file it won't give with its sign-in page: the token lacks files:read.
  async download(f) {
    if (!f?.url || this.downloads[f.id]?.state === "busy") return;
    this.downloads[f.id] = { state: "busy" };
    this.dirty = true;
    const header = `${dir()}/.download-auth`, windows = appWindow().platform === "windows";
    const remove = (path) => (windows ? exec("cmd", ["/c", "del", "/q", path.replace(/\//g, "\\")]) : exec("rm", ["-f", path])).catch(() => {});
    try {
      const safe = String(f.name || "file").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
      const target = `${home().replace(/\\/g, "/")}/Downloads/${safe}`;
      await fs.writeFile(header, "");
      await lock(header, false);
      await fs.writeFile(header, `Authorization: Bearer ${this.userToken}\n`);
      const r = await exec("curl", ["-sfL", "--max-time", "25", "--create-dirs", "--no-clobber", "-H", `@${header}`, "-o", target, "-w", "%{content_type}\n%{filename_effective}\n%{http_code}", f.url]);
      const [type = "", saved = target, status = ""] = r.stdout.trim().split("\n");
      if (status === "401" || status === "403") {
        await remove(saved);
        throw new Error("Needs the files:read permission: gear menu → Fix permissions.");
      }
      if (r.code !== 0) {
        if (r.code !== 23) await remove(saved);
        throw new Error(r.code === 28 ? "Took longer than 25 s: open it in Slack instead." : `Download failed (curl ${r.code}).`);
      }
      if (/text\/html/.test(type) && !/html/.test(f.mime ?? "")) {
        await remove(saved);
        throw new Error("Needs the files:read permission: gear menu → Fix permissions.");
      }
      this.downloads[f.id] = { state: "done", path: saved };
      notify({ title: "Downloaded", body: saved.split(/[\\/]/).pop(), level: "info", timeout: 6000 });
    } catch (e) {
      this.downloads[f.id] = { state: "error", error: String(e?.message ?? e) };
    } finally {
      await fs.unlink(header).catch(() => {});
      this.dirty = true;
    }
  }

  // Whether a message makes a toast and a sound. A direct message counts as a mention.
  shouldNotify(c, mentioned) {
    if (Date.now() < this.pauseUntil) return false;
    const p = this.prefs[c.id] ?? {}, forYou = mentioned || c.kind === "im";
    if (p.muted) return mentioned;
    const level = p.level ?? "all";
    return level === "all" || (level === "mentions" && forYou);
  }

  savePrefs() {
    try { localStorage.setItem("prefs", JSON.stringify(this.prefs)); } catch (_) {}
  }

  // A Slack toast is Herdr's own toast with the writer's picture (Slack's purple mark while
  // it hasn't downloaded), Slack's own sound, and a click that opens the conversation, or the
  // thread, in the side panel (slack.goto-<conversation>[-<thread ts, . as _>]).
  toast(c, n) {
    this.needFace(n.uid);
    const go = `goto-${c.id}${n.thread ? `-${String(n.thread).replace(".", "_")}` : ""}`;
    notify({
      title: c.kind === "im" ? n.title : `${n.title} · ${n.where}`,
      body: n.body,
      level: "info",
      timeout: 12000,
      icon: this.avatars[n.uid] ?? ICON("toast-icon"),
      action: { name: `${NAME}.${go}` },
    });
    this.ding();
  }

  // Slack's sound (mods/slack/knock.mp3), once at most every 1.5 s, unless sounds are off in
  // Herdr's settings or in the Slack panel's gear menu.
  ding() {
    if (!this.soundOn || settings()?.sounds?.enabled === false || Date.now() - (this.dinged ?? 0) < 1500) return;
    this.dinged = Date.now();
    try { playSound(`mods/${NAME}/knock.mp3`); } catch (_) {}
  }

  // A toast was clicked: show the Slack panel, open the conversation (and the thread).
  async goto(id, ts) {
    run("layout.select", { stack: "panel-body", child: NAME });
    run("layout.show", { id: "panel" });
    await this.openConv(id);
    if (ts) await this.openThread({ id, ts });
  }

  saveSeen() {
    try { localStorage.setItem("seen", JSON.stringify(this.seen)); } catch (_) {}
  }

  // ── background: commands from the panel ───────────────────────────────────────────────
  poll(cx) {
    const cmd = shared(CMD);
    if (!cmd || cmd.n === this.lastCmd) return;
    this.lastCmd = cmd.n;
    cx.spawn(async () => {
      try {
        if (cmd.type === "reload") this.reload(cx);
        else if (cmd.type === "open") await this.openConv(cmd.id);
        else if (cmd.type === "close") { this.open = null; this.dirty = true; }
        else if (cmd.type === "send") await this.sendMessage(cmd);
        else if (cmd.type === "older") await this.loadOlder(cmd);
        else if (cmd.type === "react") await this.react(cmd);
        else if (cmd.type === "thread") await this.openThread(cmd);
        else if (cmd.type === "unthread") { if (this.open) this.open.thread = null; this.dirty = true; }
        else if (cmd.type === "download") await this.download(cmd.file);
        else if (cmd.type === "sound") {
          this.soundOn = Boolean(cmd.on);
          try { localStorage.setItem("sound", cmd.on ? "on" : "off"); } catch (_) {}
          if (cmd.on) { this.dinged = 0; this.ding(); }
          this.dirty = true;
        } else if (cmd.type === "rescope") {
          this.missing = await missingScopes(this.userToken).catch(() => this.missing);
          this.scopedAt = Date.now();
          this.dirty = true;
        } else if (cmd.type === "toasttest") {
          const c = [...this.convs.values()].filter((x) => x.kind === "im" && x.ts).sort((a, b) => b.ts - a.ts)[0];
          if (c) this.toast(c, { title: c.title, where: "Direct message", body: (c.preview || "Test").slice(0, 160), uid: c.user });
        }
        else if (cmd.type === "notif") {
          const p = { ...this.prefs[cmd.id] };
          if (cmd.level) p.level = cmd.level;
          if (typeof cmd.muted === "boolean") p.muted = cmd.muted;
          if ((p.level ?? "all") === "all" && !p.muted) delete this.prefs[cmd.id]; else this.prefs[cmd.id] = p;
          this.savePrefs();
          this.dirty = true;
        } else if (cmd.type === "pause") {
          this.pauseUntil = Number(cmd.until) || 0;
          try { localStorage.setItem("pauseUntil", String(this.pauseUntil)); } catch (_) {}
          this.dirty = true;
        }
      } catch (e) {
        const msg = String(e?.message ?? e);
        if (cmd.type === "send") this.result = { n: cmd.n, ok: false, error: msg };
        else if (this.open) this.open.notice = msg;
        this.dirty = true;
      }
    });
  }

  normalize(m) {
    const bot = !m.user;
    if (bot && m.bot_id && !this.faces.has(m.bot_id)) {
      const url = m.bot_profile?.icons?.image_48 ?? m.icons?.image_48;
      if (url) this.faces.set(m.bot_id, url);
    }
    this.needFace(m.user ?? m.bot_id);
    for (const id of m.reply_users ?? []) this.needFace(id);
    return {
      ts: m.ts,
      t: Number(m.ts) * 1000,
      who: m.user === this.me.id ? "You" : bot ? m.username ?? m.bot_profile?.name ?? "App" : this.users.get(m.user) ?? "someone",
      mine: m.user === this.me.id,
      uid: m.user ?? m.bot_id ?? m.username ?? "",
      files: (m.files ?? []).filter((f) => f.id && f.mode !== "tombstone" && f.mode !== "hidden_by_limit").map((f) => ({
        id: f.id, name: f.name || f.title || "file", type: f.pretty_type || (f.filetype ?? "").toUpperCase(), mime: f.mimetype ?? "", size: f.size ?? 0,
        url: f.url_private_download || f.url_private || null, external: Boolean(f.is_external), link: f.permalink ?? f.url_private ?? null,
      })),
      text: plainText(m.text, this.users).trim() || (m.files?.length ? "" : "[message]"),
      reactions: (m.reactions ?? []).map((r) => ({ name: r.name, count: r.count, mine: Boolean(r.users?.includes(this.me.id)) })),
      parts: segmentsOf(m.text, this.users),
      replies: m.reply_count ?? 0,
      repliers: (m.reply_users ?? []).slice(0, 4).map((id) => ({ id, name: id === this.me.id ? "You" : this.users.get(id) ?? "someone" })),
      lastReply: m.latest_reply ? Number(m.latest_reply) * 1000 : null,
    };
  }

  async fetchMessages(id, before) {
    const params = { channel: id, limit: String(HISTORY) };
    if (before) params.latest = before;
    const j = await this.api("conversations.history", params);
    if (!j.ok) throw new Error(`Slack says ${j.error}`);
    const msgs = (j.messages ?? []).slice().reverse();
    await this.resolveUsers([...msgs.map((m) => m.user), ...msgs.flatMap((m) => m.reply_users ?? [])]);
    for (const m of msgs) for (const mention of String(m.text ?? "").matchAll(/<@([UW][A-Z0-9]+)/g)) await this.resolveUsers([mention[1]]);
    return { msgs, more: (j.messages ?? []).length >= HISTORY };
  }

  async openConv(id) {
    const c = this.convs.get(id);
    if (!c) return;
    this.open = { id, title: c.title, kind: c.kind, messages: [], loading: true, error: null, notice: null, more: true };
    c.unread = 0;
    c.mention = false;
    this.dirty = true;
    let got;
    try { got = await this.fetchMessages(id); } catch (e) {
      if (this.open?.id === id) { this.open.loading = false; this.open.error = String(e?.message ?? e); this.dirty = true; }
      return;
    }
    if (this.open?.id !== id) return;
    this.open.messages = got.msgs.map((m) => this.normalize(m));
    this.open.more = got.more;
    this.open.loading = false;
    const last = got.msgs[got.msgs.length - 1];
    if (last) { this.seen[id] = last.ts; this.saveSeen(); c.ts = c.ts || Number(last.ts) * 1000; }
    this.dirty = true;
  }

  // Scrolled to the top of what is loaded: the 40 messages before the oldest one.
  async loadOlder({ id }) {
    const o = this.open;
    if (!o || o.id !== id || !o.more || o.loadingOlder || !o.messages.length) return;
    o.loadingOlder = true;
    this.dirty = true;
    try {
      const got = await this.fetchMessages(id, o.messages[0].ts);
      if (this.open?.id !== id) return;
      o.messages = [...got.msgs.map((m) => this.normalize(m)), ...o.messages];
      o.more = got.more;
    } finally {
      o.loadingOlder = false;
      this.dirty = true;
    }
  }

  // A thread: its first message and every reply, from conversations.replies.
  async openThread({ id, ts }) {
    const o = this.open;
    if (!o || o.id !== id) return;
    o.thread = { ts, messages: [], loading: true, error: null };
    this.dirty = true;
    const j = await this.api("conversations.replies", { channel: id, ts, limit: "200" });
    if (this.open?.thread?.ts !== ts) return;
    if (!j.ok) { o.thread.loading = false; o.thread.error = `Slack says ${j.error}`; this.dirty = true; return; }
    const msgs = j.messages ?? [];
    await this.resolveUsers(msgs.map((m) => m.user));
    o.thread.messages = msgs.map((m) => this.normalize(m));
    o.thread.loading = false;
    this.dirty = true;
  }

  async sendMessage({ n, id, text, thread_ts }) {
    const j = await this.api("chat.postMessage", thread_ts ? { channel: id, text, thread_ts } : { channel: id, text }, true);
    if (!j.ok) throw new Error(`Slack says ${j.error}`);
    this.result = { n, ok: true };
    if (thread_ts) {
      const o = this.open?.id === id ? this.open : null;
      if (o?.thread?.ts === thread_ts && !o.thread.messages.some((m) => m.ts === j.ts)) o.thread.messages.push(this.normalize({ ...j.message, ts: j.ts, user: this.me.id, text }));
      const parent = o?.messages.find((m) => m.ts === thread_ts);
      if (parent) {
        parent.replies += 1;
        parent.lastReply = Number(j.ts) * 1000;
        if (!parent.repliers.some((r) => r.id === this.me.id)) parent.repliers = [...parent.repliers, { id: this.me.id, name: "You" }].slice(0, 4);
      }
      this.dirty = true;
      return;
    }
    if (this.open?.id === id && !this.open.messages.some((m) => m.ts === j.ts)) {
      this.open.messages.push(this.normalize({ ...j.message, ts: j.ts, user: this.me.id, text }));
    }
    const c = this.convs.get(id);
    if (c) { c.ts = Number(j.ts) * 1000; c.preview = `You: ${text}`; this.cacheDirty = true; }
    this.seen[id] = j.ts;
    this.saveSeen();
    this.dirty = true;
  }

  // Add or take away your reaction. Reacting needs the reactions:write scope; a token
  // saved after adding it is picked up here without a restart.
  async react({ id, ts, name, add }) {
    const o = this.open;
    if (o) o.notice = null;
    const params = { channel: id, timestamp: ts, name };
    let j = await this.api(add ? "reactions.add" : "reactions.remove", params, true);
    if (!j.ok && j.error === "missing_scope") {
      const fresh = await this.readToken("user-token");
      if (fresh && fresh !== this.userToken) {
        this.userToken = fresh;
        j = await this.api(add ? "reactions.add" : "reactions.remove", params, true);
      }
    }
    if (!j.ok && j.error === "missing_scope") throw new Error("Reacting needs the reactions:write permission: gear menu → Fix permissions.");
    if (!j.ok && j.error !== "already_reacted" && j.error !== "no_reaction") throw new Error(`Slack says ${j.error}`);
    const m = this.open?.id === id ? this.open.messages.find((x) => x.ts === ts) : null;
    if (m) {
      const r = m.reactions.find((x) => x.name === name);
      if (add && !r) m.reactions.push({ name, count: 1, mine: true });
      else if (add && r && !r.mine) { r.count += 1; r.mine = true; }
      else if (!add && r && r.mine) { r.count -= 1; r.mine = false; if (r.count <= 0) m.reactions = m.reactions.filter((x) => x !== r); }
    }
    this.dirty = true;
  }

  // What the panel draws, and the number for the tab button. Direct messages, groups and
  // channels you are @mentioned in count; the rest of the channels stay quiet.
  publish() {
    if (this.cacheDirty) {
      this.cacheDirty = false;
      const kept = {};
      for (const c of this.convs.values()) if (c.ts) kept[c.id] = { ts: c.ts, preview: c.preview };
      try { localStorage.setItem("cache", JSON.stringify(kept)); } catch (_) {}
    }
    if (this.pauseUntil && Date.now() >= this.pauseUntil) {
      this.pauseUntil = 0;
      try { localStorage.setItem("pauseUntil", "0"); } catch (_) {}
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    const convs = [...this.convs.values()].map((c) => ({ id: c.id, kind: c.kind, title: c.title ?? c.name, unread: c.unread, mention: c.mention, preview: c.preview, ts: c.ts, user: c.user, muted: Boolean(this.prefs[c.id]?.muted), level: this.prefs[c.id]?.level ?? "all" }));
    const loud = convs.reduce((n, c) => n + ((c.kind === "im" || c.kind === "mpim") && !c.muted && c.level !== "nothing" || c.mention ? c.unread : 0), 0);
    setShared(STATE, { me: this.me?.id ?? null, status: this.status, error: this.error, team: this.team, convs, open: this.open, result: this.result, soundOn: this.soundOn, pauseUntil: this.pauseUntil, scopedAt: this.scopedAt ?? 0, avatars: this.avatars, downloads: this.downloads, gen: this.gen, needs: this.needs, has: this.has, missing: this.missing });
    setShared(UNREAD, loud);
  }

  // ── panel: draw ────────────────────────────────────────────────────────────────────────
  render(cx) {
    if (this.isBg) return div().size(0);
    const t = theme(), S = shared(STATE);
    this.av = S?.avatars ?? {};
    const root = v_flex().id("slack").size_full().min_h(0).overflow_hidden().bg(t.background).text_size(13).text_color(t.muted);
    if (!S) return root.child(this.header(t, null)).child(this.message(t, "Connecting to Slack…"));
    // Setup opens by itself while a token is missing or rejected, unless closed for this start.
    if (S.status === "setup" && !this.wiz && this.closedGen !== S.gen) this.wiz = newWizard(S);
    if (this.wiz) return root.child(this.header(t, S)).child(renderSetup(this, t, S, cx));
    const setupButton = (label) => h_flex().px(16).child(button(t, "sl-setup-open", label, (_e, cx) => { this.wiz = newWizard(shared(STATE)); cx.notify(); }, { primary: true, icon: "key" }));
    if (S.status === "setup") return root.child(this.header(t, S)).child(v_flex().child(this.message(t, "Slack isn't set up.", S.error ?? "Two tokens connect this panel to your workspace.")).child(setupButton("Set up Slack")));
    if (S.status === "error") return root.child(this.header(t, S)).child(v_flex().child(this.message(t, "Couldn't connect to Slack.", S.error)).child(setupButton("Check the tokens")));
    return root.child(this.header(t, S))
      .when(Boolean(S.open) && this.notifOpen === S.open?.id, (el) => el.child(this.notifMenu(t, S)))
      .when((S.pauseUntil ?? 0) > Date.now(), (el) => el.child(this.pausedBar(t, S)))
      .when(this.menu && !S.open, (el) => el.child(this.menuBar(t, S)))
      .when(!S.open && (S.missing?.length ?? 0) > 0, (el) => el.child(this.missingBar(t, S)))
      .child(S.open ? this.conversation(t, S) : this.list(t, S));
  }

  // A conversation's notifications, as Slack offers them: every new message, just @mentions,
  // or nothing; and mute.
  notifMenu(t, S) {
    const o = S.open, c = S.convs.find((x) => x.id === o.id) ?? {}, level = c.level ?? "all";
    const dm = o.kind === "im";
    const option = (id, label, hint, chosen, onClick) => h_flex().id(id).h(hint ? 38 : 30).px(8).gap(8).items_center().rounded(4).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { onClick(); cx.notify(); })
      .child(div().size(14).flex_none().rounded_full().border(1).border_color(chosen ? t.accent : t.input).flex().items_center().justify_center()
        .when(chosen, (e) => e.child(div().size(6).rounded_full().bg(t.accent))))
      .child(v_flex().flex_1().min_w(0)
        .child(div().text_size(12.5).text_color(t.foreground).child(label))
        .when(Boolean(hint), (e) => e.child(div().truncate().text_size(11).text_color(t.dim).child(hint))));
    const set = (patch) => this.command({ type: "notif", id: o.id, ...patch });
    return v_flex().flex_none().px(6).py(6).gap(1).bg(t.chrome).border_b(1).border_color(t.border)
      .child(div().px(8).pb(2).text_size(10.5).font_semibold().text_color(t.dim).child("NOTIFY ME ABOUT"))
      .child(option("sl-n-all", dm ? "Every new message" : "Every new message", null, level === "all" && !c.muted, () => set({ level: "all", muted: false })))
      .when(!dm, (el) => el.child(option("sl-n-men", "Just @mentions", "And @here, @channel", level === "mentions" && !c.muted, () => set({ level: "mentions", muted: false }))))
      .child(option("sl-n-none", "Nothing", null, level === "nothing" && !c.muted, () => set({ level: "nothing", muted: false })))
      .child(div().h(1).mx(8).my(4).bg(t.border))
      .child(h_flex().id("sl-n-mute").h(38).px(8).gap(8).items_center().rounded(4).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { set({ muted: !c.muted }); cx.notify(); })
        .child(svg(ICON(c.muted ? "bell" : "bell-off")).size(14).flex_none().text_color(t.dim))
        .child(v_flex().flex_1().min_w(0)
          .child(div().text_size(12.5).text_color(t.foreground).child(c.muted ? `Unmute ${dm ? "conversation" : "channel"}` : `Mute ${dm ? "conversation" : "channel"}`))
          .child(div().truncate().text_size(11).text_color(t.dim).child(c.muted ? "Toasts and counts come back" : "No toasts or counts; @mentions still come through"))));
  }

  // Every toast paused: until when, and Resume.
  pausedBar(t, S) {
    const until = S.pauseUntil, day = dayLabel(until);
    return h_flex().flex_none().px(10).py(6).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border).text_size(12).text_color(t.muted)
      .child(svg(ICON("moon")).size(13).flex_none().text_color(t.dim))
      .child(div().flex_1().min_w(0).truncate().child(`Notifications paused until ${clock(until)}${day === "Today" ? "" : ` ${day.toLowerCase()}`}`))
      .child(div().id("sl-resume").flex_none().font_medium().cursor_pointer().text_color(LINK).hover((s) => s.underline())
        .on_click((_e, cx) => { this.command({ type: "pause", until: 0 }); cx.notify(); }).child("Resume"));
  }

  // The gear menu, as a row under the header.
  menuBar(t, S) {
    return h_flex().flex_none().px(8).py(6).gap(6).flex_wrap().bg(t.chrome).border_b(1).border_color(t.border)
      .child(button(t, "sl-m-reload", "Reconnect", (_e, cx) => { this.command({ type: "reload" }); this.menu = false; cx.notify(); }, { icon: "refresh" }))
      .child(button(t, "sl-m-tokens", "Change tokens…", (_e, cx) => { this.wiz = newWizard(S); this.menu = false; cx.notify(); }, { icon: "key" }))
      .child(button(t, "sl-m-pause", "Pause notifications", (_e, cx) => { this.pauseOpen = !this.pauseOpen; cx.notify(); }, { icon: "moon" }))
      .when(Boolean(this.pauseOpen), (el) => {
        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0);
        const pick = (id, label, until) => button(t, id, label, (_e, cx) => { this.command({ type: "pause", until }); this.pauseOpen = false; this.menu = false; cx.notify(); }, { primary: true });
        return el.child(h_flex().w_full().gap(6).flex_wrap().pl(4)
          .child(pick("sl-p-30", "30 minutes", Date.now() + 30 * 60000))
          .child(pick("sl-p-60", "1 hour", Date.now() + 60 * 60000))
          .child(pick("sl-p-120", "2 hours", Date.now() + 120 * 60000))
          .child(pick("sl-p-tom", "Until tomorrow 9 AM", tomorrow.getTime())));
      })
      .child(button(t, "sl-m-sound", S.soundOn === false ? "Sound off" : "Sound on", (_e, cx) => { this.command({ type: "sound", on: S.soundOn === false }); cx.notify(); }, { icon: S.soundOn === false ? "volume-x" : "volume-2" }))
      .child(button(t, "sl-m-fix", "Fix permissions…", (_e, cx) => { this.wiz = newWizard(S, true); this.menu = false; cx.notify(); }))
      .child(button(t, "sl-m-out", this.signoutArmed ? "Sure? Sign out" : "Sign out", (_e, cx) => {
        if (!this.signoutArmed) {
          this.signoutArmed = true;
          cx.timer.after(4000, (cx) => { this.signoutArmed = false; cx.notify(); });
          cx.notify();
          return;
        }
        this.signOut(cx);
      }));
  }

  // The user token lacks a permission: say what is off, and offer the fix.
  missingBar(t, S) {
    // Yellow background with dark text, in light and dark themes alike.
    const ink = "#1c1a16";
    return h_flex().flex_none().px(10).py(6).gap(8).items_center().bg(t.working).text_size(12).text_color(ink)
      .child(svg(ICON("triangle-alert")).size(13).flex_none())
      .child(div().flex_1().min_w(0).truncate().font_medium().tooltip(S.missing.map((m) => m.scope).join(", ")).child(`No ${S.missing.map((m) => m.what).join(", ")}: permission missing`))
      .child(div().id("sl-fix").flex_none().px(8).h(20).flex().items_center().rounded(4).font_semibold().cursor_pointer().bg("#1c1a1622").hover((s) => s.bg("#1c1a1640"))
        .on_click((_e, cx) => { this.wiz = newWizard(S, true); cx.notify(); }).child("Fix"));
  }

  face(t, uid, name, size, color) {
    const path = this.av?.[uid];
    if (path) return image(path).size(size).flex_none().rounded(Math.round(size / 6));
    return div().size(size).flex_none().rounded(Math.round(size / 6)).flex().items_center().justify_center()
      .text_size(Math.max(9, Math.round(size * 0.48))).font_semibold().bg(color ?? t.raised).text_color(t.background)
      .child(String(name || "?").replace(/^@/, "").slice(0, 1).toUpperCase());
  }

  // A file: what it is and how big, a download button, and once it's down Open and Show
  // in folder. A file kept outside Slack (Google Drive and the like) opens in the browser.
  fileCard(t, f) {
    const d = shared(STATE)?.downloads?.[f.id], img = /^image\//.test(f.mime);
    const tool = (id, icon, tip, onClick) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(4).cursor_pointer()
      .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); cx.notify(); })
      .child(svg(ICON(icon)).size(14));
    const detail = d?.state === "busy" ? "Downloading…" : d?.state === "done" ? "Saved to Downloads" : d?.state === "error" ? d.error
      : [f.type, sizeOf(f.size)].filter(Boolean).join(" · ") || "File";
    const showInFolder = (path) => {
      const os = appWindow().platform;
      if (os === "macos") exec("open", ["-R", path]).catch(() => {});
      else if (os === "windows") exec("explorer", [`/select,${path.replace(/\//g, "\\")}`]).catch(() => {});
      else this.cxOpen?.(fileUrl(path.slice(0, path.lastIndexOf("/"))));
    };
    return h_flex().id(`sl-f-${f.id}`).mt(4).max_w(340).p(6).pr(4).gap(8).items_center().rounded(6).border(1).border_color(t.input).bg(t.raised)
      .child(div().size(32).flex_none().rounded(5).bg(t.background).flex().items_center().justify_center().text_color(t.dim)
        .child(svg(ICON(img ? "image" : "file")).size(16)))
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_size(12.5).font_medium().text_color(t.foreground).child(f.name))
        .child(div().truncate().text_size(11).text_color(d?.state === "error" ? t.blocked : d?.state === "done" ? t.done : t.dim).tooltip(detail).child(detail)))
      .when(f.external && Boolean(f.link), (el) => el.child(tool(`sl-fo-${f.id}`, "external-link", "Open in the browser", (cx) => cx.open_url(f.link))))
      .when(!f.external && d?.state === "done", (el) => el
        .child(tool(`sl-fo-${f.id}`, "external-link", "Open", (cx) => cx.open_url(fileUrl(d.path))))
        .child(tool(`sl-fs-${f.id}`, "folder-open", "Show in folder", (cx) => { this.cxOpen = (u) => cx.open_url(u); showInFolder(d.path); })))
      .when(!f.external && Boolean(f.url) && d?.state !== "done", (el) => el.child(d?.state === "busy"
        ? div().size(26).flex_none().flex().items_center().justify_center().text_color(t.dim).child(svg(ICON("download")).size(14).opacity(0.5))
        : tool(`sl-fd-${f.id}`, "download", d?.state === "error" ? "Try again" : `Download to Downloads`, () => this.command({ type: "download", file: f }))));
  }

  message(t, title, hint) {
    return v_flex().flex_1().p(16).gap(6)
      .child(div().text_color(t.foreground).font_medium().child(title))
      .when(Boolean(hint), (el) => el.child(div().text_size(12).text_color(t.dim).child(hint)));
  }

  header(t, S) {
    const open = S?.open;
    const live = S?.status === "live";
    const dot = div().size(7).flex_none().rounded_full().bg(live ? t.done : S?.status === "reconnecting" ? t.working : t.dim);
    return h_flex().h(36).flex_none().px(12).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .when(Boolean(open), (el) => el
        .child(div().id("sl-back").size(22).flex_none().flex().items_center().justify_center().rounded(4).cursor_pointer().bg(t.raised).text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Back to conversations")
          .on_click((_e, cx) => { this.command({ type: "close" }); cx.notify(); })
          .child(svg(ICON("chevron-left")).size(14)))
        .child(svg(ICON(KIND_ICON[open.kind] ?? "hash")).size(14).flex_none().text_color(t.dim))
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.foreground).child(open.title))
        .child((() => {
          const c = S.convs.find((x) => x.id === open.id) ?? {}, quiet = c.muted || c.level === "nothing", on = this.notifOpen === open.id;
          return div().id("sl-notif").size(22).flex_none().flex().items_center().justify_center().rounded(4).cursor_pointer()
            .text_color(on ? t.foreground : quiet ? t.dim : t.muted).when(on, (e) => e.bg(t.raised)).hover((s) => s.bg(t.hover).text_color(t.foreground))
            .tooltip(c.muted ? "Muted" : c.level === "nothing" ? "Notifications off" : c.level === "mentions" ? "Just @mentions" : "Notifications")
            .on_click((_e, cx) => { this.notifOpen = on ? null : open.id; cx.notify(); })
            .child(svg(ICON(quiet ? "bell-off" : c.level === "mentions" ? "at-sign" : "bell")).size(13));
        })()))
      .when(!open, (el) => el
        .child(div().font_semibold().text_color(t.foreground).child("Slack"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(S?.team ?? "")))
      .when(!open && !this.wiz && Boolean(S?.has?.app || S?.has?.user), (el) => el.child(div().id("sl-gear").size(22).flex_none().flex().items_center().justify_center().rounded(4).cursor_pointer()
        .text_color(this.menu ? t.foreground : t.dim).when(this.menu, (e) => e.bg(t.raised)).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Slack settings")
        .on_click((_e, cx) => { this.menu = !this.menu; this.signoutArmed = false; cx.notify(); })
        .child(svg(ICON("settings")).size(13))))
      .child(h_flex().flex_none().gap(5).items_center().text_size(11).text_color(t.dim)
        .tooltip(S?.error ? S.error : live ? "Connected" : "Connecting")
        .child(dot).child(live ? "live" : S?.status === "reconnecting" ? "reconnecting" : "…"));
  }

  // Two groups, direct messages then channels; each newest first. Unread ones are bold with a count.
  list(t, S) {
    const q = this.filter.value().trim().toLowerCase();
    // Conversations Slack has gone quiet in (no message found) stay out of the list until you search for them.
    const mine = S.convs.filter((c) => (q ? c.title.toLowerCase().includes(q) : c.ts > 0));
    const children = [];
    for (const g of GROUPS) {
      const rows = mine.filter((c) => g.kinds.includes(c.kind)).sort((a, b) => b.ts - a.ts);
      if (!rows.length) continue;
      const open = q || !this.folded.has(g.id);
      const unread = rows.reduce((n, c) => n + c.unread, 0);
      children.push(h_flex().id(`sl-g-${g.id}`).flex_none().h(28).px(8).gap(6).items_center().cursor_pointer().text_size(11.5).text_color(t.dim)
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { this.folded.has(g.id) ? this.folded.delete(g.id) : this.folded.add(g.id); cx.notify(); })
        .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(11).flex_none())
        .child(div().font_semibold().child(g.label))
        .child(div().child(String(rows.length)))
        .child(div().flex_1())
        .when(!open && unread > 0, (el) => el.child(div().px(5).rounded(8).bg(t.blocked).text_size(10.5).font_semibold().text_color("#ffffff").child(String(unread)))));
      if (open) for (const c of rows.slice(0, SHOWN)) children.push(this.row(t, c));
    }
    return v_flex().flex_1().min_h(0)
      .child(div().relative().flex_none().mx(8).mt(8).mb(4)
        .child(Input.new(this.filter).h(26).px(9).rounded(4).border(1).border_color(t.input).bg(t.canvas ?? t.background).text_size(12).text_color(t.foreground))
        .when(this.filterEmpty, (el) => el.child(div().absolute().left(10).top(0).h(26).flex().items_center().text_size(12).text_color(t.dim).child("Filter conversations"))))
      .child(v_flex().id("sl-rows").flex_1().min_h(0).overflow_y_scroll().px(4).pb(6)
        .children(children)
        .when(!children.length, (el) => el.child(div().p(12).text_size(12).text_color(t.dim).child(q ? "No conversation matches." : S.status === "starting" || S.status === "loading" ? "Loading conversations…" : "No conversations yet."))));
  }

  row(t, c) {
    const quiet = c.muted || c.level === "nothing";
    const unread = c.unread > 0 && (!quiet || c.mention);
    return div().id(`sl-${c.id}`).flex_none().px(8).py(6).rounded(4).cursor_pointer().flex().flex_col().gap(1)
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.command({ type: "open", id: c.id }); cx.notify(); })
      .child(h_flex().gap(8).items_center()
        .child(div().w(18).flex_none().flex().items_center().justify_center()
          .child(c.kind === "im" && this.av?.[c.user]
            ? this.face(t, c.user, c.title, 18)
            : svg(ICON(KIND_ICON[c.kind] ?? "hash")).size(14).flex_none().text_color(t.dim)))
        .child(div().flex_1().min_w(0).truncate().text_color(unread ? t.foreground : quiet ? t.dim : t.muted).when(unread, (el) => el.font_semibold()).child(c.title))
        .when(unread, (el) => el.child(div().flex_none().px(5).rounded(8).bg(t.blocked).text_size(10.5).font_semibold().text_color("#ffffff").child(String(c.unread))))
        .when(quiet, (el) => el.child(svg(ICON("bell-off")).size(11).flex_none().text_color(t.dim)))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(c.ts))))
      .when(Boolean(c.preview), (el) => el.child(div().pl(26).truncate().text_size(12).text_color(t.dim).child(c.preview)));
  }

  // A message's text. Plain text stays one block per line (cheap to draw); a line with links
  // is its runs of text and its links side by side, each link opening in the browser on a
  // click and showing a copy button while the pointer is on it.
  textView(t, m) {
    const C = this.chat;
    const parts = m.parts?.length ? m.parts : [{ t: "text", s: m.text }];
    const special = (p) => p.t === "link" || p.t === "mention";
    if (!parts.some(special)) return div().text_size(12.5).text_color(t.muted).child(m.text);
    const M = settings()?.dark !== false ? MENTION.dark : MENTION.light, me = shared(STATE)?.me;
    const lines = [[]];
    for (const p of parts) {
      if (special(p)) { lines[lines.length - 1].push(p); continue; }
      p.s.split("\n").forEach((piece, i) => {
        if (i) lines.push([]);
        if (piece.trim()) lines[lines.length - 1].push({ t: "text", s: piece.trim() });
      });
    }
    return v_flex().gap(1).text_size(12.5).text_color(t.muted).children(lines.map((line, li) => {
      if (!line.length) return div().h(8);
      if (!line.some(special)) return div().child(line.map((p) => p.s).join(" "));
      // Text beside a mention or link goes word by word, so it flows on after it as in Slack
      // (only these lines: one element per word is too heavy for whole messages).
      const flow = line.flatMap((p) => (p.t === "text" ? p.s.split(/\s+/).filter(Boolean).map((word) => ({ t: "text", s: word })) : [p]));
      return h_flex().flex_wrap().items_center().gap_x(4).gap_y(1).children(flow.map((w, wi) => {
        if (w.t === "text") return div().max_w_full().child(w.s);
        if (w.t === "mention") {
          const mine = w.id === me || w.id === "!";
          return div().flex_none().px(2).rounded(3).font_medium().bg(mine ? M.meBg : M.bg).text_color(mine ? M.meFg : M.fg).child(w.label);
        }
        const key = `${m.ts}:${li}:${wi}`, hovered = C.link === key, copied = C.copied === key;
        return h_flex().id(`sl-l-${key}`).max_w_full().min_w(0).gap(3).items_center()
          .on_hover((on, cx) => { if (on) C.link = key; else if (C.link === key) C.link = null; cx.notify(); })
          .child(div().id(`sl-la-${key}`).min_w(0).cursor_pointer().text_color(LINK).underline().tooltip(w.url)
            .on_click((_e, cx) => { cx.stop_propagation(); cx.open_url(w.url); })
            .child(w.label))
          .when(hovered || copied, (el) => el.child(div().id(`sl-lc-${key}`).size(18).flex_none().flex().items_center().justify_center().rounded(4).cursor_pointer()
            .bg(t.raised).border(1).border_color(t.input).text_color(copied ? t.done : t.dim).hover((s) => s.text_color(t.foreground))
            .tooltip(copied ? "Copied" : "Copy link")
            .on_click((_e, cx) => {
              cx.stop_propagation();
              cx.write_to_clipboard(w.url);
              C.copied = key;
              cx.timer.after(1500, (cx) => { if (C.copied === key) { C.copied = null; cx.notify(); } });
              cx.notify();
            })
            .child(svg(ICON(copied ? "check" : "copy")).size(11))));
      }));
    }));
  }

  // One message: who and when above the first of a run, the text, its reactions, its thread
  // ("3 replies"), and while the pointer is on it a toolbar: reply in thread, add a reaction.
  messageView(t, o, m, head, colors, inThread) {
    const C = this.chat;
    const hovered = C.hover === m.ts, picking = C.pick === m.ts;
    const react = (name, add) => (_e, cx) => {
      cx.stop_propagation();
      this.command({ type: "react", id: o.id, ts: m.ts, name, add });
      C.pick = null;
      cx.notify();
    };
    const openThread = (_e, cx) => { cx.stop_propagation(); this.command({ type: "thread", id: o.id, ts: m.ts }); C.pick = null; cx.notify(); };
    const nameColor = m.mine ? t.done : colors.get(m.uid || m.who) ?? t.foreground;
    const body = v_flex().flex_1().min_w(0).gap(2)
      .when(head, (el) => el.child(h_flex().gap(8).items_baseline()
        .child(div().text_size(12.5).font_semibold().text_color(nameColor).child(m.who))
        .child(div().text_size(11).text_color(t.dim).child(clock(m.t)))))
      .when(Boolean(m.text), (el) => el.child(this.textView(t, m)))
      .children((m.files ?? []).map((f) => this.fileCard(t, f)))
      .when(m.reactions.length > 0, (el) => el.child(h_flex().gap(4).flex_wrap().pt(2)
        .children(m.reactions.map((r) => div().id(`sl-r-${m.ts}-${r.name}`).h(20).px(6).flex().items_center().gap(4).rounded(10).cursor_pointer().text_size(11.5)
          .border(1).border_color(r.mine ? t.accent : t.input).bg(r.mine ? t.selected : t.raised).text_color(t.foreground)
          .tooltip(r.mine ? "Take your reaction back" : `React ${emoji(r.name)}`)
          .hover((s) => s.border_color(t.accent))
          .on_click(react(r.name, !r.mine))
          .child(emoji(r.name)).child(div().text_color(t.dim).child(String(r.count)))))))
      .when(!inThread && m.replies > 0, (el) => {
        const C2 = this.chat, key = `th:${m.ts}`, over = C2.threadHover === key;
        const palette = settings()?.dark !== false ? NAME_COLORS.dark : NAME_COLORS.light;
        const face = (r) => this.face(t, r.id, r.name, 18, r.name === "You" ? t.done : colors.get(r.id) ?? palette[hashOf(r.id) % palette.length]);
        const last = m.lastReply ? (dayLabel(m.lastReply) === "Today" ? `today at ${clock(m.lastReply)}` : dayLabel(m.lastReply) === "Yesterday" ? `yesterday at ${clock(m.lastReply)}` : dayLabel(m.lastReply)) : "";
        return el.child(h_flex().id(`sl-th-${m.ts}`).mt(3).h(28).px(4).gap(6).items_center().rounded(6).cursor_pointer()
          .border(1).border_color(over ? t.input : t.background).when(over, (e) => e.bg(t.raised))
          .on_hover((on, cx) => { if (on) C2.threadHover = key; else if (C2.threadHover === key) C2.threadHover = null; cx.notify(); })
          .on_click(openThread)
          .child(h_flex().gap(2).children(m.repliers.map(face)))
          .child(div().flex_none().text_size(12).font_semibold().text_color(LINK).child(`${m.replies} ${m.replies === 1 ? "reply" : "replies"}`))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(over ? "View thread" : last ? `Last reply ${last}` : ""))
          .when(over, (e) => e.child(svg(ICON("chevron-right")).size(12).flex_none().text_color(t.dim))));
      })
      .when(picking, (el) => el.child(h_flex().gap(2).flex_wrap().pt(4)
        .children(QUICK.map((name) => div().id(`sl-q-${m.ts}-${name}`).size(26).flex().items_center().justify_center().rounded(4).cursor_pointer().text_size(15)
          .bg(t.raised).hover((s) => s.bg(t.selected)).tooltip(`:${name}:`)
          .on_click(react(name, !m.reactions.some((r) => r.name === name && r.mine)))
          .child(emoji(name))))));
    return div().id(`sl-m-${m.ts}`).relative().flex_none().px(12).py(2).when(head, (el) => el.mt(6))
      .on_hover((on, cx) => { if (on) C.hover = m.ts; else if (C.hover === m.ts) C.hover = null; cx.notify(); })
      .when(hovered || picking, (el) => el.bg(t.hover))
      .child(h_flex().gap(8).items_start()
        .child(head ? div().flex_none().pt(2).child(this.face(t, m.uid || m.who, m.who, 30, nameColor)) : div().w(30).flex_none())
        .child(body))
      .when(hovered || picking, (el) => {
        const tool = (id, icon, tip, on, onClick) => div().id(id).size(22).flex().items_center().justify_center().rounded(4).cursor_pointer()
          .text_color(on ? t.foreground : t.dim).hover((s) => s.bg(t.selected).text_color(t.foreground)).tooltip(tip)
          .on_click(onClick)
          .child(svg(ICON(icon)).size(13));
        return el.child(h_flex().absolute().right(8).top(0).gap(1).p(1).rounded(5).bg(t.raised).border(1).border_color(t.input)
          .when(!inThread, (el) => el.child(tool(`sl-t-${m.ts}`, "message-square-reply", "Reply in thread", false, openThread)))
          .child(tool(`sl-p-${m.ts}`, "smile-plus", "Add reaction", picking, (_e, cx) => { cx.stop_propagation(); C.pick = picking ? null : m.ts; cx.notify(); })));
      });
  }

  conversation(t, S) {
    const o = S.open, C = this.chat, th = o.thread;
    // In a thread the same view shows the thread: its first message, then the replies.
    const list = th ? th.messages : o.messages;
    const viewKey = th ? `${o.id}:${th.ts}` : o.id;
    if (C.id !== viewKey) Object.assign(C, { id: viewKey, off: 0, viewH: 0, contentH: 0, hover: null, pick: null, askedOlder: null, link: null });
    // A send answered: the box empties when it went through, and keeps the text when it didn't.
    if (this.pending && S.result?.n === this.pending) {
      if (S.result.ok) { this.reply.set_value(""); this.replyEmpty = true; this.picked.clear(); this.mention = null; C.off = 0; }
      this.sendError = S.result.ok ? null : S.result.error;
      this.pending = null;
    }
    const max = () => Math.max(0, C.contentH - C.viewH);
    const older = () => {
      if (th) return;
      const oldest = o.messages[0]?.ts;
      if (o.more && !o.loadingOlder && oldest && C.askedOlder !== oldest) { C.askedOlder = oldest; this.command({ type: "older", id: o.id }); }
    };
    // The messages sit on the bottom edge. Scrolling back moves them down past it, up to the
    // height they have beyond the view; at the top, the 40 before the oldest load.
    const content = v_flex().flex_none().w_full().pb(6).on_size_change((s, cx) => {
      if (Math.abs(s.height - C.contentH) > 0.5) { C.contentH = s.height; cx.notify(); }
    });
    const loading = th ? th.loading : o.loading, error = th ? th.error : o.error;
    if (loading) content.child(div().px(12).text_size(12).text_color(t.dim).child(th ? "Loading thread…" : "Loading messages…"));
    else if (error) content.child(div().px(12).text_size(12).text_color(t.blocked).child(error));
    else if (!list.length) content.child(div().px(12).text_size(12).text_color(t.dim).child("No messages yet."));
    if (!th && o.loadingOlder) content.child(div().px(12).py(4).text_size(11.5).text_color(t.dim).child("Loading earlier messages…"));
    const colors = chatColors(list, settings()?.dark !== false);
    list.forEach((m, i) => {
      const prev = list[i - 1];
      const newDay = !prev || dayLabel(prev.t) !== dayLabel(m.t);
      if (newDay) content.child(h_flex().flex_none().gap(8).items_center().px(12).pt(i ? 10 : 4).pb(2)
        .child(div().flex_1().h(1).bg(t.border)).child(div().text_size(11).text_color(t.dim).child(dayLabel(m.t))).child(div().flex_1().h(1).bg(t.border)));
      content.child(this.messageView(t, o, m, newDay || prev.who !== m.who || m.t - prev.t > 300000, colors, Boolean(th)));
      if (th && i === 0 && list.length > 1) content.child(h_flex().flex_none().gap(8).items_center().px(12).pt(8).pb(2)
        .child(div().text_size(11).text_color(t.dim).child(`${list.length - 1} ${list.length === 2 ? "reply" : "replies"}`)).child(div().flex_1().h(1).bg(t.border)));
    });
    const view = v_flex().id("sl-view").flex_1().min_h(0).overflow_hidden().justify_end().relative()
      .on_size_change((s, cx) => { if (Math.abs(s.height - C.viewH) > 0.5) { C.viewH = s.height; cx.notify(); } })
      .on_scroll_wheel((e, cx) => {
        C.off = Math.min(max(), Math.max(0, C.off + e.delta.y));
        if (C.off >= max() - 40) older();
        cx.notify();
      })
      .child(v_flex().flex_none().relative().top(Math.min(C.off, max())).child(content))
      .when(C.off > 40, (el) => el.child(div().id("sl-down").absolute().right(12).bottom(10).h(24).px(9).flex().items_center().rounded(12).cursor_pointer()
        .bg(t.raised).border(1).border_color(t.input).text_size(11.5).text_color(t.foreground).hover((s) => s.bg(t.selected))
        .on_click((_e, cx) => { C.off = 0; cx.notify(); }).child("Latest ↓")));
    const sending = Boolean(this.pending);
    return v_flex().flex_1().min_h(0)
      .when(Boolean(th), (el) => el.child(h_flex().flex_none().h(30).px(12).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border)
        .child(div().id("sl-unthread").h(22).px(7).flex().items_center().gap(4).rounded(4).cursor_pointer().bg(t.raised).text_size(11.5).text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(`Back to ${o.title}`)
          .on_click((_e, cx) => { this.command({ type: "unthread" }); cx.notify(); })
          .child(svg(ICON("chevron-left")).size(12)).child("Back"))
        .child(div().font_semibold().text_size(12.5).text_color(t.foreground).child("Thread"))))
      .child(view)
      .when(Boolean(o.notice), (el) => el.child(div().flex_none().px(12).py(4).text_size(11.5).text_color(t.blocked).child(o.notice)))
      .when(Boolean(this.sendError), (el) => el.child(div().flex_none().px(12).py(4).text_size(11.5).text_color(t.blocked).child(`Couldn't send: ${this.sendError}`)))
      .when(Boolean(this.mention), (el) => {
        const list = this.mentionList();
        if (!list.length) return el;
        const sel = Math.min(this.mentionSel, list.length - 1);
        const palette = settings()?.dark !== false ? NAME_COLORS.dark : NAME_COLORS.light;
        return el.child(v_flex().flex_none().py(4).bg(t.popover ?? t.raised).border_t(1).border_color(t.border)
          .child(div().px(12).pb(2).text_size(10.5).font_semibold().text_color(t.dim).child("PEOPLE  ·  ↑↓ to move, Enter or Tab to pick"))
          .children(list.map((p, i) => h_flex().id(`sl-at-${p.id}`).h(30).mx(4).px(8).gap(8).items_center().rounded(4).cursor_pointer()
            .when(i === sel, (e) => e.bg(t.selected))
            .on_hover((on, cx) => { if (on && this.mentionSel !== i) { this.mentionSel = i; cx.notify(); } })
            .on_click((_e, cx) => this.pickMention(p, cx))
            .child(this.face(t, p.id, p.name, 20, palette[hashOf(p.id) % palette.length]))
            .child(div().flex_none().text_size(12.5).font_semibold().text_color(t.foreground).child(p.name))
            .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(p.real && p.real !== p.name ? p.real : p.handle ? `@${p.handle}` : "")))));
      })
      .child(h_flex().flex_none().gap(6).items_center().p(8).bg(t.chrome).border_t(1).border_color(t.border)
        .child(div().relative().flex_1().min_w(0)
          .on_key_down((e, cx) => {
            if (!this.mention) return;
            const list = this.mentionList();
            if (!list.length) return;
            if (e.keystroke === "down") this.mentionSel = (Math.min(this.mentionSel, list.length - 1) + 1) % list.length;
            else if (e.keystroke === "up") this.mentionSel = (Math.min(this.mentionSel, list.length - 1) + list.length - 1) % list.length;
            else if (e.keystroke === "tab") { cx.stop_propagation(); this.pickMention(list[Math.min(this.mentionSel, list.length - 1)], cx); return; }
            else if (e.keystroke === "escape") this.mention = null;
            else return;
            cx.stop_propagation();
            cx.notify();
          })
          .child(Input.new(this.reply).h(30).px(9).rounded(4).border(1).border_color(t.input).bg(t.canvas ?? t.background).text_size(12.5).text_color(t.foreground))
          .when(this.replyEmpty, (el) => el.child(div().absolute().left(10).top(0).h(30).flex().items_center().text_size(12.5).text_color(t.dim).child(th ? "Reply in thread…" : `Reply to ${o.title}…`))))
        .child(div().id("sl-send").size(30).flex_none().flex().items_center().justify_center().rounded(4).bg(t.solid ?? t.accent).text_color(t.solid_foreground ?? t.accent_foreground)
          .when(sending || this.replyEmpty, (el) => el.opacity(0.45))
          .when(!sending && !this.replyEmpty, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => this.send(cx)))
          .tooltip("Send (Enter)")
          .child(svg(ICON("send")).size(14))));
  }
}
