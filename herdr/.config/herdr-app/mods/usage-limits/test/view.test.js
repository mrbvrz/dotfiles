process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentView } from "../lib/view.js";
import claude from "../providers/claude.js";
import { read } from "./_util.js";

const NOW = Date.UTC(2026, 10, 4, 8, 0, 0) / 1000;
const W = (o) => ({ id: "x", short: "wk", long: "Weekly", percent: 50, resetsAt: NOW + 58 * 3600, durationSec: 604800, ...o });

test("ok segment: percent only, fill and tick", () => {
  const s = segmentView(W(), NOW);
  assert.equal(s.text, "50%");
  assert.equal(s.level, "ok");
  assert.equal(s.fill, 0.5);
  assert.ok(Math.abs(s.tick - 0.6548) < 0.001);
  assert.equal(s.expired, false);
  assert.equal(s.short, "wk");
});

test("hot segment appends time to reset", () => {
  const s = segmentView(W({ percent: 92, resetsAt: NOW + 38 * 60, durationSec: 18000 }), NOW);
  assert.equal(s.text, "92% · 38m");
  assert.equal(s.level, "hot");
});

test("warn segment appends time to reset", () => {
  assert.equal(segmentView(W({ percent: 74 }), NOW).text, "74% · 2d 10h");
});

test("segment of a passed window is '—' with no tick", () => {
  const s = segmentView(W({ percent: 95, resetsAt: NOW - 1 }), NOW);
  assert.deepEqual([s.text, s.fill, s.tick, s.level, s.expired], ["—", 0, null, "ok", true]);
});

test("fill is clamped to 0–1", () => {
  assert.equal(segmentView(W({ percent: 130 }), NOW).fill, 1);
});

// ---- barModel / chooseDensity (Task 4) ----
import { barModel, cardModel, chooseDensity, panelOnEnter } from "../lib/view.js";
import codex from "../providers/codex.js";

const PREFS = { hidden: [], hiddenWindows: [] };
const ok = (p, file, at = NOW) => ({ ...p.parse(read(file), at), observedAt: at });
const STATES = () => ({
  claude: { report: ok(claude, "claude-get-usage.max.json"), lastGood: ok(claude, "claude-get-usage.max.json"), installed: true },
  codex: { report: ok(codex, "codex-app-server.plus.json"), lastGood: ok(codex, "codex-app-server.plus.json"), installed: true },
});

test("barModel: both providers, all windows, in registry order", () => {
  const m = barModel(STATES(), PREFS, NOW);
  assert.equal(m.empty, false);
  assert.deepEqual(m.groups.map((g) => [g.providerId, g.name, g.icon, g.mark, g.dim]), [
    ["claude", "Claude", "icons/claude.svg", null, false],
    ["codex", "Codex", "icons/codex.svg", null, false],
  ]);
  assert.deepEqual(m.groups[0].segments.map((s) => s.short), ["5h", "wk", "Fable"]);
});

test("barModel: hidden provider and hidden window are dropped", () => {
  const m = barModel(STATES(), { hidden: ["codex"], hiddenWindows: ["claude:session"] }, NOW);
  assert.deepEqual(m.groups.map((g) => g.providerId), ["claude"]);
  assert.deepEqual(m.groups[0].segments.map((s) => s.id), ["weekly_all", "weekly_scoped:Fable"]);
});

test("barModel: failing provider keeps last good reading, dimmed, with '!'", () => {
  const s = STATES();
  s.claude.report = { status: "error", message: "offline", plan: null, observedAt: NOW, source: "claude CLI", windows: [] };
  const g = barModel(s, PREFS, NOW).groups[0];
  assert.deepEqual([g.mark, g.dim, g.segments.length], ["!", true, 3]);
});

test("barModel: failing provider with no last reading → '!' and no segments", () => {
  const s = STATES();
  s.codex = { report: { status: "error", message: "x", plan: null, observedAt: NOW, source: "s", windows: [] }, lastGood: null, installed: true };
  const g = barModel(s, PREFS, NOW).groups[1];
  assert.deepEqual([g.mark, g.segments.length], ["!", 0]);
});

test("barModel: not installed → absent; loading → '…'", () => {
  const s = STATES();
  s.codex = { report: null, lastGood: null, installed: false };
  s.claude = { report: null, lastGood: null, installed: null };
  const m = barModel(s, PREFS, NOW);
  assert.deepEqual(m.groups.map((g) => [g.providerId, g.mark, g.segments.length]), [["claude", "…", 0]]);
});

test("barModel: reading older than 15 min is dimmed", () => {
  const s = STATES();
  s.codex.report = { ...s.codex.report, observedAt: NOW - 901 };
  assert.equal(barModel(s, PREFS, NOW).groups[1].dim, true);
});

test("barModel: everything hidden → empty", () => {
  assert.equal(barModel(STATES(), { hidden: ["claude", "codex"], hiddenWindows: [] }, NOW).empty, true);
  assert.equal(barModel({}, PREFS, NOW).empty, false, "unknown state = loading groups");
});

test("chooseDensity: full at 600px, no bars at 400px, percents only at 140px", () => {
  const m = barModel(STATES(), PREFS, NOW);
  assert.equal(chooseDensity(m, 600), 0);
  assert.equal(chooseDensity(m, 400), 1);
  assert.equal(chooseDensity(m, 140), 3);
});

// ---- reset time always on ----

test("chooseDensity: with bars off it never picks the bars, and still narrows", () => {
  const m = barModel(STATES(), PREFS, NOW);
  assert.equal(chooseDensity(m, 600, false), 1);
  assert.equal(chooseDensity(m, 140, false), chooseDensity(m, 140));
});

test("showResetTime: a calm window shows its time too", () => {
  assert.equal(segmentView(W(), NOW, true).text, "50% · 2d 10h");
});

test("showResetTime off: a calm window stays percent only", () => {
  assert.equal(segmentView(W(), NOW, false).text, "50%");
});

test("brief drops the time of a calm window only", () => {
  assert.equal(segmentView(W(), NOW, true).brief, "50%");
  assert.equal(segmentView(W({ percent: 74 }), NOW, true).brief, "74% · 2d 10h");
});

test("showResetTime: no reset known, or already passed, adds no time", () => {
  assert.equal(segmentView(W({ resetsAt: null }), NOW, true).text, "50%");
  const s = segmentView(W({ resetsAt: NOW - 1 }), NOW, true);
  assert.deepEqual([s.text, s.brief], ["—", "—"]);
});

test("barModel: applies showResetTime from prefs", () => {
  const texts = (prefs) => barModel(STATES(), prefs, NOW).groups[0].segments.map((s) => s.text);
  assert.ok(texts({ ...PREFS, showResetTime: true }).every((t) => t.includes(" · ")));
  assert.ok(!texts(PREFS).some((t) => t.includes(" · ")));
});

test("chooseDensity: times of calm windows go last, so providers still fit", () => {
  const on = barModel(STATES(), { ...PREFS, showResetTime: true }, NOW);
  assert.equal(chooseDensity(on, 2000), 0);
  assert.equal(chooseDensity(on, 300), 3);
});

// ---- hover card ----

test("cardModel: a provider's plan, age and one row per window", () => {
  const s = STATES();
  s.claude.report = { ...s.claude.report, observedAt: NOW - 60 };
  const g = cardModel(s, NOW).groups[0];
  assert.deepEqual([g.providerId, g.name, g.plan, g.status, g.failed, g.dim], ["claude", "Claude", "Max", "updated just now", false, false]);
  assert.deepEqual(g.rows.map((r) => r.long), ["5-hour", "Weekly", "Weekly · Fable"]);
});

test("cardModel: a row carries percent, level, bar and time left, on one line", () => {
  const report = { status: "ok", plan: "max", observedAt: NOW, source: "x", windows: [W({ percent: 74, resetsAt: NOW + 58 * 3600 })] };
  const r = cardModel({ claude: { report, lastGood: report, installed: true } }, NOW, [claude]).groups[0].rows[0];
  assert.deepEqual([r.percent, r.level, r.fill], ["74%", "warn", 0.74]);
  assert.ok(Math.abs(r.tick - 0.6548) < 0.001);
  assert.equal(r.left, "2d 10h");
  assert.equal(r.detail, "");
});

const hintFor = (w) => {
  const report = { status: "ok", plan: null, observedAt: NOW, source: "x", windows: [W(w)] };
  return cardModel({ claude: { report, lastGood: report, installed: true } }, NOW, [claude]).groups[0].rows[0].hint;
};

test("cardModel: a row's hint explains its tick with its own numbers", () => {
  const left = { resetsAt: NOW + 58 * 3600 }; // 65% of a week gone
  assert.equal(hintFor({ percent: 70, ...left }), "Tick: 65% of the time has passed.\nYou've used 70%, so you're on pace.");
  assert.equal(hintFor({ percent: 92, ...left }), "Tick: 65% of the time has passed.\nYou've used 92%, so you're using it up too fast.");
  assert.equal(hintFor({ percent: 20, ...left }), "Tick: 65% of the time has passed.\nYou've used 20%, so you have room to spare.");
});

test("cardModel: no tick, no hint", () => {
  assert.equal(hintFor({ resetsAt: null, durationSec: null }), null);
  assert.equal(hintFor({ percent: 95, resetsAt: NOW - 1 }), null);
});

test("cardModel: a row with no known reset has no time left", () => {
  const report = { status: "ok", plan: null, observedAt: NOW, source: "x", windows: [W({ resetsAt: null, durationSec: null })] };
  const g = cardModel({ claude: { report, lastGood: report, installed: true } }, NOW, [claude]).groups[0];
  assert.equal(g.plan, null);
  assert.deepEqual([g.rows[0].left, g.rows[0].detail], ["", ""]);
});

test("cardModel: a passed reset shows '—', never a number", () => {
  const report = { status: "ok", plan: null, observedAt: NOW, source: "x", windows: [W({ percent: 95, resetsAt: NOW - 1 })] };
  const r = cardModel({ claude: { report, lastGood: report, installed: true } }, NOW, [claude]).groups[0].rows[0];
  assert.deepEqual([r.percent, r.level, r.fill, r.tick, r.left, r.detail], ["—", "ok", 0, null, "", "reset, waiting for a new reading"]);
});

test("cardModel: not installed providers are left out", () => {
  const s = STATES();
  s.codex = { report: null, lastGood: null, installed: false };
  assert.deepEqual(cardModel(s, NOW).groups.map((g) => g.providerId), ["claude"]);
});

test("cardModel: nothing installed means no limits to show", () => {
  const gone = { report: null, lastGood: null, installed: false };
  assert.equal(cardModel({ claude: gone, codex: gone }, NOW).empty, true);
});

test("cardModel: a failing provider says why and keeps its last reading, dimmed, with its age", () => {
  const s = STATES();
  s.claude.lastGood = { ...s.claude.lastGood, observedAt: NOW - 1200 };
  s.claude.report = { status: "error", message: "Not logged in", plan: null, observedAt: NOW, source: "claude CLI", windows: [] };
  const g = cardModel(s, NOW).groups[0];
  assert.deepEqual([g.status, g.failed, g.dim, g.age, g.rows.length], ["Not logged in", true, true, "Last reading 20 min ago", 3]);
});

test("cardModel: a failing provider with no last reading has no rows", () => {
  const s = STATES();
  s.claude = { report: { status: "error", message: "offline", plan: null, observedAt: NOW, source: "x", windows: [] }, lastGood: null, installed: true };
  const g = cardModel(s, NOW).groups[0];
  assert.deepEqual([g.status, g.failed, g.age, g.rows.length], ["offline", true, null, 0]);
});

test("cardModel: a provider still loading says so", () => {
  const g = cardModel({}, NOW).groups[0];
  assert.deepEqual([g.status, g.failed, g.rows.length], ["loading…", false, 0]);
});

test("cardModel: a reading older than 15 min is dimmed", () => {
  const s = STATES();
  s.codex.report = { ...s.codex.report, observedAt: NOW - 901 };
  const g = cardModel(s, NOW).groups[1];
  assert.equal(g.dim, true);
  assert.equal(g.status, "updated 15 min ago");
});

// ---- which side of the panel shows ----

test("panelOnEnter: settings stay while the pointer only crosses the gap", () => {
  assert.equal(panelOnEnter("settings", 1000, 1200, 300), "settings");
});

test("panelOnEnter: back to limits once the panel has closed", () => {
  assert.equal(panelOnEnter("settings", 1000, 1301, 300), "limits");
});

test("panelOnEnter: settings stay if the pointer never left", () => {
  assert.equal(panelOnEnter("settings", null, 5000, 300), "settings");
});

test("panelOnEnter: limits stay limits", () => {
  assert.equal(panelOnEnter("limits", 1000, 9000, 300), "limits");
});
