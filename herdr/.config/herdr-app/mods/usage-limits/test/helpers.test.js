import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MOD, HERE } from "./_util.js";

const FAKE = join(HERE, "fake-cli", "claude");

function run(helper, env) {
  const t0 = Date.now();
  const r = spawnSync("sh", [join(MOD, "helpers", helper)], { env: { ...process.env, ...env }, encoding: "utf8", timeout: 30000 });
  assert.doesNotMatch(r.stderr ?? "", /No such file|can't open/, "helper script missing");
  return { ...r, ms: Date.now() - t0 };
}

function alive(pattern) {
  return spawnSync("pgrep", ["-f", pattern], { encoding: "utf8" }).stdout.trim() !== "";
}

test("claude helper: bogus bin → exit 127", () => {
  const r = run("claude-usage.sh", { HERDR_USAGE_CLAUDE_BIN: "/nonexistent/claude" });
  assert.equal(r.status, 127);
  assert.equal(r.stdout, "");
});

test("claude helper: skips banner and system events, prints the control_response line", () => {
  const r = run("claude-usage.sh", { HERDR_USAGE_CLAUDE_BIN: FAKE });
  assert.equal(r.status, 0);
  const msg = JSON.parse(r.stdout.trim());
  assert.equal(msg.type, "control_response");
  assert.equal(msg.response.request_id, "herdr-usage-limits");
  assert.ok(r.ms < 5000, `took ${r.ms} ms`);
  assert.equal(alive("fake-cli/claude"), false, "fake CLI left running");
});

test("claude helper: CLI that never answers → exit 1 within 20 s and no leftover process", { timeout: 30000 }, () => {
  const r = run("claude-usage.sh", { HERDR_USAGE_CLAUDE_BIN: FAKE, HANG: "1" });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.ok(r.ms < 20000, `took ${r.ms} ms`);
  assert.equal(alive("sleep 60"), false, "hung CLI left running");
});

test("codex helper: bogus bin and no sessions dir → exit 127", () => {
  const r = run("codex-limits.sh", { HERDR_USAGE_CODEX_BIN: "/nonexistent/codex", CODEX_HOME: mkdtempSync(join(tmpdir(), "codex-home-")) });
  assert.equal(r.status, 127);
  assert.equal(r.stdout, "");
});

test("codex helper: codex missing but session logs exist → exit 127 (not a stale 'ok')", () => {
  const home = mkdtempSync(join(tmpdir(), "codex-home-"));
  mkdirSync(join(home, "sessions", "2026", "11", "04"), { recursive: true });
  const snap = JSON.parse(readFileSync(join(HERE, "fixtures", "codex-session-snapshot.json"), "utf8")).snapshot;
  writeFileSync(join(home, "sessions", "2026", "11", "04", "rollout.jsonl"), JSON.stringify(snap) + "\n");
  const r = run("codex-limits.sh", { HERDR_USAGE_CODEX_BIN: "/nonexistent/codex", CODEX_HOME: home });
  assert.equal(r.status, 127);
  assert.equal(r.stdout, "");
});

// ---- session.sh ----

function session(args, env) {
  return spawnSync("sh", [join(MOD, "helpers", "session.sh"), ...args], { env: { ...process.env, ...env }, encoding: "utf8", timeout: 10000 });
}

function claudeHome(fixture) {
  const dir = mkdtempSync(join(tmpdir(), "ul-claude-"));
  mkdirSync(join(dir, "sessions"));
  mkdirSync(join(dir, "projects", "-some-project"), { recursive: true });
  writeFileSync(join(dir, "sessions", "123.json"), JSON.stringify({ pid: 123, sessionId: "abc-1", cwd: "/x" }));
  copyFileSync(join(HERE, "fixtures", fixture), join(dir, "projects", "-some-project", "abc-1.jsonl"));
  return dir;
}

test("session helper, claude: numbers from the main thread, not from quoted text or subagents", () => {
  const r = session(["claude", "123"], { CLAUDE_CONFIG_DIR: claudeHome("claude-session.jsonl") });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "tokens=182010 calls=3 compactions=2 lastTrigger=auto lastPre=259912 lastPost=10364\n", "prompts only: the trap line, a string and a text block");
});

test("session helper, claude: right after a compaction the context is what's left", () => {
  const r = session(["claude", "123"], { CLAUDE_CONFIG_DIR: claudeHome("claude-session-compacted.jsonl") });
  assert.match(r.stdout, /^tokens=10364 /);
});

test("session helper, claude: a turn with server tools counts its last request, not their sum", () => {
  const r = session(["claude", "123"], { CLAUDE_CONFIG_DIR: claudeHome("claude-session-iterations.jsonl") });
  assert.match(r.stdout, /^tokens=321002 /);
});

test("session helper, claude: prints no conversation text", () => {
  const r = session(["claude", "123"], { CLAUDE_CONFIG_DIR: claudeHome("claude-session.jsonl") });
  assert.doesNotMatch(r.stdout, /secret/);
});

test("session helper, claude: unknown process → exit 1, no output", () => {
  const r = session(["claude", "999"], { CLAUDE_CONFIG_DIR: claudeHome("claude-session.jsonl") });
  assert.deepEqual([r.status, r.stdout], [1, ""]);
});

test("session helper: a pid that isn't a number is refused", () => {
  const r = session(["claude", "../../etc/passwd"], { CLAUDE_CONFIG_DIR: claudeHome("claude-session.jsonl") });
  assert.deepEqual([r.status, r.stdout], [1, ""]);
});

function fakeTools(rollout) {
  const dir = mkdtempSync(join(tmpdir(), "ul-bin-"));
  const tool = (name, body) => {
    writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  };
  tool("pgrep", 'echo 456');
  const files = [rollout].flat().filter(Boolean).map((f) => `n${f}\\n`).join("");
  tool("lsof", files ? `[ "$4" = 456 ] && printf 'p456\\nn/other/file\\n${files}'` : "exit 1");
  return dir;
}

test("session helper, codex: the file its app-server holds open, last usage and window", () => {
  const home = mkdtempSync(join(tmpdir(), "ul-codex-"));
  const day = join(home, "sessions", "2026", "11", "04");
  mkdirSync(day, { recursive: true });
  const rollout = join(day, "rollout-2026-11-04T12-55-35-abc.jsonl");
  copyFileSync(join(HERE, "fixtures", "codex-rollout.jsonl"), rollout);
  const r = session(["codex", "123"], { PATH: `${fakeTools(rollout)}:${process.env.PATH}` });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "tokens=115225 window=475000 calls=2\n");
});

test("session helper, codex: no open session file → exit 1, never a guess", () => {
  const r = session(["codex", "123"], { PATH: `${fakeTools(null)}:${process.env.PATH}` });
  assert.deepEqual([r.status, r.stdout], [1, ""]);
});

test("session helper, codex: with two files open, the one being written", () => {
  const day = join(mkdtempSync(join(tmpdir(), "ul-codex-")), "sessions", "2026", "11", "04");
  mkdirSync(day, { recursive: true });
  const old = join(day, "rollout-a.jsonl");
  const live = join(day, "rollout-b.jsonl");
  writeFileSync(old, '{"payload":{"type":"token_count","info":{"last_token_usage":{"total_tokens":7},"model_context_window":100}}}\n');
  copyFileSync(join(HERE, "fixtures", "codex-rollout.jsonl"), live);
  utimesSync(old, 1000, 1000);
  const r = session(["codex", "123"], { PATH: `${fakeTools([old, live])}:${process.env.PATH}` });
  assert.match(r.stdout, /^tokens=115225 /);
});
