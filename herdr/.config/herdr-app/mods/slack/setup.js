// slack setup: the steps that get the panel from nothing to connected, inside the panel.
//   1  create the Slack app, from a link that carries its settings (MANIFEST)
//   2  the app-level token (xapp-), checked by opening a Socket Mode connection
//   3  the user token (xoxp-), checked with auth.test, its permissions probed
//   4  save both in data/slack/, readable by this user only, and reconnect
// Works on macOS, Linux and Windows: links open through the desktop, files are locked
// with chmod or icacls.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Input } from "gpui-base";
import { readTextFile, writeTextFile, exec, window as appWindow } from "herdr";
import * as fs from "fs/promises";

const ICON = (name) => `mods/slack/${name}.svg`;

// ── Slack API ────────────────────────────────────────────────────────────────────────────
export async function call(token, method, params = {}, post = false) {
  const res = post
    ? await fetch(`https://slack.com/api/${method}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(params) })
    : await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429) throw new Error("Slack is rate limiting this app; try again in a minute");
  return res.json();
}

// Errors that mean the token itself is wrong: the panel goes back to setup on these.
export const AUTH_ERRORS = new Set(["invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive", "not_allowed_token_type"]);

// Every user permission the panel uses, and what stops working without it.
export const SCOPES = [
  ["channels:read", "public channels in the list"],
  ["groups:read", "private channels in the list"],
  ["im:read", "direct messages in the list"],
  ["mpim:read", "group messages in the list"],
  ["channels:history", "reading public channels"],
  ["groups:history", "reading private channels"],
  ["im:history", "reading direct messages"],
  ["mpim:history", "reading group messages"],
  ["users:read", "people's names"],
  ["chat:write", "sending messages"],
  ["reactions:write", "reactions"],
  ["files:read", "file downloads"],
];

// The Slack app's settings. Slack doesn't allow "Slack" in an app name.
export const MANIFEST = {
  display_information: { name: "Herdr", description: "Read and answer Slack from Herdr's side panel." },
  oauth_config: { scopes: { user: SCOPES.map(([s]) => s) } },
  settings: {
    event_subscriptions: { user_events: ["message.channels", "message.groups", "message.im", "message.mpim"] },
    interactivity: { is_enabled: false },
    org_deploy_enabled: false,
    socket_mode_enabled: true,
    token_rotation_enabled: false,
  },
};
export const MANIFEST_URL = `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(MANIFEST))}`;
const APPS_URL = "https://api.slack.com/apps";

function explain(error, kind) {
  if (error === "invalid_auth" || error === "not_authed") return "Slack doesn't know this token. Copy it again, all of it.";
  if (error === "token_revoked" || error === "token_expired") return "This token no longer works. Make a new one.";
  if (error === "account_inactive") return "This Slack account is deactivated.";
  if (error === "not_allowed_token_type") return kind === "app" ? "This isn't an app-level token. It starts with xapp-." : "This isn't a user token. It starts with xoxp-.";
  if (error === "missing_scope" && kind === "app") return "This token lacks connections:write. Make a new one with that scope.";
  return `Slack says ${error}.`;
}

export async function checkApp(token) {
  if (!token.startsWith("xapp-")) return { ok: false, error: token.startsWith("xox") ? "This isn't the app-level token. Copy it from Basic Information → App-Level Tokens; it starts with xapp-." : "An app-level token starts with xapp-." };
  try {
    const j = await call(token, "apps.connections.open", {}, true);
    return j.ok ? { ok: true } : { ok: false, error: explain(j.error, "app") };
  } catch (e) { return { ok: false, error: `Couldn't reach Slack: ${e?.message ?? e}` }; }
}

export async function checkUser(token) {
  if (token.startsWith("xoxb-")) return { ok: false, error: "This is the bot token. Copy the User OAuth Token; it starts with xoxp-." };
  if (!token.startsWith("xoxp-")) return { ok: false, error: "A user token starts with xoxp-." };
  try {
    const who = await call(token, "auth.test");
    if (!who.ok) return { ok: false, error: explain(who.error, "user") };
    return { ok: true, user: who.user, team: who.team ?? "", missing: await missingScopes(token) };
  } catch (e) { return { ok: false, error: `Couldn't reach Slack: ${e?.message ?? e}` }; }
}

// Slack has no call that lists a token's permissions, but a call it refuses for a missing
// one names all the permissions the token has. These calls change nothing: the file, the
// reaction's channel and the message's channel don't exist.
export async function missingScopes(token) {
  const probes = [
    ["files.info", { file: "F0000000000" }, false],
    ["reactions.add", { channel: "C0000000000", timestamp: "1.000001", name: "eyes" }, true],
    ["chat.postMessage", { channel: "C0000000000", text: "." }, true],
    ["conversations.list", { types: "public_channel,private_channel,mpim,im", limit: "1" }, false],
    ["users.list", { limit: "1" }, false],
  ];
  for (const [method, params, post] of probes) {
    const j = await call(token, method, params, post).catch(() => null);
    if (j?.error === "missing_scope" && j.provided != null) {
      const have = new Set(String(j.provided).split(",").map((s) => s.trim()));
      return SCOPES.filter(([s]) => !have.has(s)).map(([scope, what]) => ({ scope, what }));
    }
  }
  return [];
}

// ── files ────────────────────────────────────────────────────────────────────────────────
// Only this user may read the tokens: chmod on macOS and Linux, icacls on Windows (the
// folder's inherited permissions removed, full control for this user alone).
export async function lock(path, folder) {
  if (appWindow().platform === "windows") {
    const who = (await exec("whoami")).stdout.trim();
    const r = await exec("icacls", [path.replace(/\//g, "\\"), "/inheritance:r", "/grant:r", `${who}:${folder ? "(OI)(CI)F" : "F"}`]);
    if (r.code !== 0) throw new Error(`icacls: ${r.stderr.trim() || r.stdout.trim()}`);
  } else {
    const r = await exec("chmod", [folder ? "700" : "600", path]);
    if (r.code !== 0) throw new Error(`chmod: ${r.stderr.trim()}`);
  }
}

export async function saveTokens(dir, tokens) {
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  await lock(dir, true);
  for (const [file, value] of Object.entries(tokens)) {
    if (!value) continue;
    const path = `${dir}/${file}`;
    const before = await readTextFile(path).catch(() => null);
    await writeTextFile(path, `${value}\n`, before);
    await lock(path, false);
  }
}

export async function removeTokens(dir) {
  for (const file of ["app-token", "user-token"]) await fs.unlink(`${dir}/${file}`).catch(() => {});
}

// ── the steps, drawn ─────────────────────────────────────────────────────────────────────
// `v` is the panel: v.wiz (where you are), v.appIn / v.userIn (the token fields),
// v.finishSetup(cx) and v.closeSetup(cx).
export function newWizard(S, fix = false) {
  const step = fix || S?.needs === "user" ? 3 : S?.needs === "app" ? 2 : S?.has?.app || S?.has?.user ? 2 : 1;
  return { step, fix, check: { app: null, user: null }, show: { app: false, user: false }, copied: false, saving: false, error: null };
}

export const button = (t, id, label, onClick, { primary = false, icon = null, disabled = false } = {}) =>
  h_flex().id(id).h(28).px(10).gap(6).flex_none().items_center().justify_center().rounded(4).text_size(12).font_medium()
    .when(primary, (el) => el.bg(disabled ? t.raised : t.solid).text_color(disabled ? t.dim : t.solid_foreground))
    .when(!primary, (el) => el.bg(t.raised).border(1).border_color(t.input).text_color(disabled ? t.dim : t.foreground))
    .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.85)).on_click(onClick))
    .when(Boolean(icon), (el) => el.child(svg(ICON(icon)).size(13).flex_none()))
    .child(label);

const iconButton = (t, id, icon, tip, onClick) =>
  div().id(id).size(30).flex_none().flex().items_center().justify_center().rounded(4).cursor_pointer()
    .bg(t.raised).border(1).border_color(t.input).text_color(t.dim).hover((s) => s.text_color(t.foreground))
    .tooltip(tip).on_click(onClick).child(svg(ICON(icon)).size(14));

const para = (t, text) => div().text_size(12.5).text_color(t.muted).child(text);

const steps = (t, lines) => v_flex().gap(6).children(lines.map((line, i) => h_flex().gap(8).items_start()
  .child(div().size(18).flex_none().rounded_full().bg(t.raised).border(1).border_color(t.input).flex().items_center().justify_center()
    .text_size(10.5).font_semibold().text_color(t.foreground).child(String(i + 1)))
  .child(div().flex_1().min_w(0).text_size(12.5).text_color(t.muted).child(line))));

function status(t, check) {
  if (!check) return null;
  if (check.busy) return div().text_size(12).text_color(t.dim).child("Checking with Slack…");
  if (!check.ok) return h_flex().gap(6).items_start().text_size(12).text_color(t.blocked)
    .child(svg(ICON("x")).size(13).flex_none().mt(1)).child(div().flex_1().min_w(0).child(check.error));
  return v_flex().gap(4)
    .child(h_flex().gap(6).items_center().text_size(12).text_color(t.done)
      .child(svg(ICON("check")).size(13).flex_none())
      .child(check.user ? `Signed in as ${check.user}${check.team ? ` · ${check.team}` : ""}` : "Token works"))
    .children((check.missing ?? []).map((m) => h_flex().gap(6).items_start().text_size(12).text_color(t.working)
      .child(svg(ICON("triangle-alert")).size(13).flex_none().mt(1))
      .child(div().flex_1().min_w(0).child(`${m.scope} is missing: no ${m.what}`))));
}

function field(v, t, key, cx) {
  const W = v.wiz, state = key === "app" ? v.appIn : v.userIn, empty = key === "app" ? v.appEmpty : v.userEmpty;
  return h_flex().gap(6).items_center()
    .child(div().relative().flex_1().min_w(0)
      .child(Input.new(state).h(30).px(9).rounded(4).border(1).border_color(t.input).bg(t.canvas ?? t.background).text_size(12).text_color(t.foreground))
      .when(empty, (el) => el.child(div().absolute().left(10).top(0).h(30).flex().items_center().text_size(12).text_color(t.dim)
        .child(key === "app" ? "Paste the xapp-… token" : "Paste the xoxp-… token"))))
    .child(iconButton(t, `sl-su-eye-${key}`, W.show[key] ? "eye-off" : "eye", W.show[key] ? "Hide token" : "Show token", (_e, cx) => {
      W.show[key] = !W.show[key];
      state.set_masked(!W.show[key]);
      cx.notify();
    }))
    .child(iconButton(t, `sl-su-paste-${key}`, "clipboard", "Paste from clipboard", (_e, cx) => {
      const text = cx.read_from_clipboard();
      if (text) { state.set_value(text.replace(/\s+/g, "")); W.check[key] = null; }
      cx.notify();
    }));
}

export function runCheck(v, key, cx) {
  const W = v.wiz, value = (key === "app" ? v.appIn : v.userIn).value().replace(/\s+/g, "");
  if (!value) return;
  W.check[key] = { busy: true };
  cx.notify();
  cx.spawn(async (cx) => {
    const r = key === "app" ? await checkApp(value) : await checkUser(value);
    if (v.wiz !== W) return;
    W.check[key] = r;
    if (r.ok && key === "app") W.step = 3;
    cx.notify();
  });
}

export function renderSetup(v, t, S, cx) {
  const W = v.wiz, has = S?.has ?? {};
  const canClose = Boolean(has.app && has.user) && S?.status !== "setup";
  const bar = h_flex().gap(4).children([1, 2, 3, 4].map((n) => div().flex_1().h(3).rounded(2).bg(n <= W.step ? t.accent : t.raised)));
  const head = v_flex().gap(8)
    .child(h_flex().items_center().gap(8)
      .child(svg(ICON("key")).size(14).flex_none().text_color(t.dim))
      .child(div().flex_1().font_semibold().text_color(t.foreground).child(W.fix ? "Fix Slack permissions" : "Set up Slack"))
      .when(!(W.fix && W.step === 3), (el) => el.child(div().text_size(11).text_color(t.dim).child(`Step ${W.step} of 4`)))
      .when(canClose, (el) => el.child(div().id("sl-su-close").size(22).flex_none().flex().items_center().justify_center().rounded(4).cursor_pointer()
        .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Close setup")
        .on_click((_e, cx) => v.closeSetup(cx)).child(svg(ICON("x")).size(13)))))
    .when(!(W.fix && W.step === 3), (el) => el.child(bar))
    .when(Boolean(S?.error) && S?.status === "setup", (el) => el.child(h_flex().gap(6).items_start().text_size(12).text_color(t.working)
      .child(svg(ICON("triangle-alert")).size(13).flex_none().mt(1)).child(div().flex_1().min_w(0).child(S.error))));

  const go = (step) => (_e, cx) => { W.step = step; cx.notify(); };
  const copyButton = button(t, "sl-su-copy", W.copied ? "Copied" : "Copy settings", (_e, cx) => {
    cx.write_to_clipboard(JSON.stringify(MANIFEST, null, 2));
    W.copied = true;
    cx.timer.after(1500, (cx) => { W.copied = false; cx.notify(); });
    cx.notify();
  }, { icon: W.copied ? "check" : "copy" });
  const footer = (...buttons) => h_flex().gap(8).pt(4).justify_end().children(buttons);
  let body;

  if (W.step === 1) {
    body = v_flex().gap(12)
      .child(div().font_medium().text_color(t.foreground).child("Create the Slack app"))
      .child(para(t, "Slack opens with the app's settings filled in: the permissions this panel needs, Socket Mode and the message events."))
      .child(steps(t, ["Pick your workspace, then click Next.", "Check the settings, then click Create."]))
      .child(h_flex().gap(8).flex_wrap()
        .child(button(t, "sl-su-create", "Create Slack app", (_e, cx) => cx.open_url(MANIFEST_URL), { primary: true, icon: "external-link" }))
        .child(copyButton))
      .child(div().text_size(11.5).text_color(t.dim).child("If the form comes up empty: click Create New App → From a manifest, and paste the copied settings."))
      .child(footer(button(t, "sl-su-next1", "I have the app", go(2), { primary: true })));
  } else if (W.step === 2) {
    const value = v.appIn.value().trim();
    body = v_flex().gap(12)
      .child(div().font_medium().text_color(t.foreground).child("App token"))
      .child(para(t, "Lets the panel get new messages the moment they arrive."))
      .child(steps(t, [
        "In your app, open Basic Information.",
        "Under App-Level Tokens, click Generate Token and Scopes.",
        "Name it (herdr, say), add the connections:write scope, click Generate.",
        "Copy the token. It starts with xapp-.",
      ]))
      .child(h_flex().child(button(t, "sl-su-apps2", "Open your Slack apps", (_e, cx) => cx.open_url(APPS_URL), { icon: "external-link" })))
      .child(field(v, t, "app", cx))
      .when(Boolean(W.check.app), (el) => el.child(status(t, W.check.app)))
      .child(footer(
        button(t, "sl-su-back2", "Back", go(1)),
        !value && has.app
          ? button(t, "sl-su-keep2", "Keep current token", go(3), { primary: true })
          : button(t, "sl-su-check2", "Check token", (_e, cx) => runCheck(v, "app", cx), { primary: true, disabled: !value || W.check.app?.busy })));
  } else if (W.step === 3 && W.fix) {
    // Fixing permissions keeps the token: reinstalling the app adds the new permissions to
    // the token it already gave, so all that's left is to check again.
    const missing = S?.missing ?? [];
    const checking = Boolean(W.rescope) && !((S?.scopedAt ?? 0) >= W.rescope);
    const checked = Boolean(W.rescope) && !checking;
    body = v_flex().gap(12)
      .child(div().font_medium().text_color(t.foreground).child("Add the missing permissions"))
      .child(para(t, "Your token stays the same: Slack adds the permissions to it when you reinstall the app."))
      .child(missing.length
        ? v_flex().gap(4).children(missing.map((m) => h_flex().gap(6).items_start().text_size(12).text_color(t.working)
          .child(svg(ICON("triangle-alert")).size(13).flex_none().mt(1))
          .child(div().flex_1().min_w(0).child(`${m.scope}: ${m.what}`))))
        : h_flex().gap(6).items_center().text_size(12).text_color(t.done)
          .child(svg(ICON("check")).size(13).flex_none()).child("Every permission is granted."))
      .when(missing.length > 0, (el) => el
        .child(steps(t, [
          "Click Copy settings. In your app, open App Manifest, paste over what's there, click Save Changes.",
          "Slack asks you to reinstall the app: click Reinstall to Workspace (or Install App → Reinstall), then Allow.",
          "Come back here and click Check permissions.",
        ]))
        .child(h_flex().gap(8).flex_wrap()
          .child(button(t, "sl-su-appsf", "Open your Slack apps", (_e, cx) => cx.open_url(APPS_URL), { icon: "external-link" }))
          .child(copyButton)))
      .when(checked && missing.length > 0, (el) => el.child(div().text_size(11.5).text_color(t.dim)
        .child("Still missing. Did you click Allow after Reinstall? Slack can take a few seconds.")))
      .child(div().id("sl-su-newtok").text_size(11.5).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground).underline())
        .on_click((_e, cx) => { W.fix = false; cx.notify(); })
        .child("Slack gave you a new token? Paste it instead"))
      .child(footer(missing.length === 0
        ? button(t, "sl-su-done", "Done", (_e, cx) => v.closeSetup(cx), { primary: true })
        : button(t, "sl-su-rescope", checking ? "Checking…" : "Check permissions", (_e, cx) => {
          W.rescope = Date.now();
          v.command({ type: "rescope" });
          cx.notify();
        }, { primary: true, icon: "refresh", disabled: checking })));
  } else if (W.step === 3) {
    const value = v.userIn.value().trim(), c = W.check.user;
    const lines = W.fix || (S?.missing?.length ?? 0) > 0
      ? ["Click Copy settings. In your app, open App Manifest, paste over what's there, click Save.",
        "Open Install App, click Reinstall to Workspace, then Allow.",
        "Copy the User OAuth Token again: Slack gives a new one."]
      : ["In your app, open Install App, click Install to Workspace, then Allow.",
        "Copy the User OAuth Token. It starts with xoxp-."];
    body = v_flex().gap(12)
      .child(div().font_medium().text_color(t.foreground).child("User token"))
      .child(para(t, "Reads and sends messages as you."))
      .child(steps(t, lines))
      .child(h_flex().gap(8).flex_wrap()
        .child(button(t, "sl-su-apps3", "Open your Slack apps", (_e, cx) => cx.open_url(APPS_URL), { icon: "external-link" }))
        .when(lines.length === 3, (el) => el.child(copyButton)))
      .child(field(v, t, "user", cx))
      .when(Boolean(c), (el) => el.child(status(t, c)))
      .child(footer(
        button(t, "sl-su-back3", "Back", go(2)),
        c?.ok ? button(t, "sl-su-next3", "Next", go(4), { primary: true })
          : !value && has.user ? button(t, "sl-su-keep3", "Keep current token", go(4), { primary: true })
          : button(t, "sl-su-check3", "Check token", (_e, cx) => runCheck(v, "user", cx), { primary: true, disabled: !value || c?.busy })));
  } else {
    const app = v.appIn.value().trim(), user = v.userIn.value().trim(), c = W.check.user;
    // A pasted token counts once Slack accepted it; an empty field keeps the saved one.
    const appOk = app ? Boolean(W.check.app?.ok) : Boolean(has.app), userOk = user ? Boolean(c?.ok) : Boolean(has.user);
    const missing = (user ? c?.missing : S?.missing) ?? [];
    const row = (label, text, good) => h_flex().gap(8).items_center().text_size(12.5)
      .child(div().w(84).flex_none().text_color(t.dim).child(label))
      .child(svg(ICON(good ? "check" : "triangle-alert")).size(13).flex_none().text_color(good ? t.done : t.working))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(text));
    body = v_flex().gap(12)
      .child(div().font_medium().text_color(t.foreground).child("Save and connect"))
      .child(v_flex().gap(6)
        .child(row("App token", app ? (appOk ? "Checked" : "Not checked yet") : has.app ? "Current one kept" : "Missing", appOk))
        .child(row("User token", user ? (userOk ? `${c.user}${c.team ? ` · ${c.team}` : ""}` : "Not checked yet") : has.user ? "Current one kept" : "Missing", userOk))
        .when(missing.length > 0, (el) => el.child(row("Permissions", `${missing.length} missing: no ${missing.map((m) => m.what).join(", ")}`, false))))
      .child(para(t, `Saved in ${v.dir}, readable by your user account only.`))
      .when(Boolean(W.error), (el) => el.child(status(t, { ok: false, error: W.error })))
      .child(footer(
        button(t, "sl-su-back4", "Back", go(3)),
        button(t, "sl-su-save", W.saving ? "Saving…" : "Save and connect", (_e, cx) => v.finishSetup(cx), { primary: true, disabled: W.saving || !(appOk && userOk) })));
  }
  return v_flex().id("sl-setup").flex_1().min_h(0).overflow_y_scroll().p(14).gap(14).child(head).child(body);
}
