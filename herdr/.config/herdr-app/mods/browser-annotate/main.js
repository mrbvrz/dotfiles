// Browser Annotate Mod for Herdr
// Integrates Chrome Browser UI inspection & area marquee annotations with Herdr coding agents.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { theme, settings, home, exec, notify, hc } from "herdr";

const BRIDGE_PORT = 7890;
const BRIDGE_URL = `http://127.0.0.1:${BRIDGE_PORT}`;
const BRIDGE_PATH = () => `${home()}/.config/herdr-app/mods/browser-annotate/bridge/server.js`;
const EXTENSION_PATH = () => `${home()}/.config/herdr-app/mods/browser-annotate/extension`;

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default class BrowserAnnotateMod extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.isBridgeRunning = false;
    this.terminals = [];
    this.history = [];
    this.selectedTarget = "";
    this.loading = false;
    this.copiedBookmarklet = false;

    // Check bridge and auto-start if needed
    this.checkBridgeStatus(cx);

    // Refresh interval
    cx.timer.every(4000, () => {
      this.refreshData(cx);
    });
  }

  async checkBridgeStatus(cx) {
    try {
      const res = await exec("curl", ["-s", `${BRIDGE_URL}/health`]);
      if (res.stdout && res.stdout.includes("herdr-browser-annotate-bridge")) {
        this.isBridgeRunning = true;
        await this.loadData(cx);
      } else {
        this.isBridgeRunning = false;
        // Auto-start bridge in background
        await this.startBridge(cx);
      }
    } catch {
      this.isBridgeRunning = false;
      await this.startBridge(cx);
    }
    cx.notify();
  }

  async startBridge(cx) {
    this.loading = true;
    cx.notify();
    try {
      // Check if node or bun is available
      await exec("nohup", ["node", BRIDGE_PATH()], { bg: true });
      // Wait a moment for server to bind
      await new Promise((r) => setTimeout(r, 600));
      this.isBridgeRunning = true;
      await this.loadData(cx);
      notify("Browser Annotate Bridge running on port 7890");
    } catch (err) {
      this.isBridgeRunning = false;
    } finally {
      this.loading = false;
      cx.notify();
    }
  }

  async stopBridge(cx) {
    try {
      await exec("pkill", ["-f", "browser-annotate/bridge/server.js"]);
      this.isBridgeRunning = false;
      notify("Browser Annotate Bridge stopped");
    } catch (err) {
      // Ignore
    }
    cx.notify();
  }

  async refreshData(cx) {
    try {
      const res = await exec("curl", ["-s", `${BRIDGE_URL}/health`]);
      if (res.stdout && res.stdout.includes("herdr-browser-annotate-bridge")) {
        this.isBridgeRunning = true;
        await this.loadData(cx);
      } else {
        this.isBridgeRunning = false;
      }
    } catch {
      this.isBridgeRunning = false;
    }
    cx.notify();
  }

  async loadData(cx) {
    try {
      // Load terminals
      const tRes = await exec("curl", ["-s", `${BRIDGE_URL}/api/terminals`]);
      if (tRes.stdout) {
        const data = JSON.parse(tRes.stdout);
        this.terminals = data.terminals || [];
      }

      // Load history
      const hRes = await exec("curl", ["-s", `${BRIDGE_URL}/api/history`]);
      if (hRes.stdout) {
        const hData = JSON.parse(hRes.stdout);
        this.history = hData.history || [];
      }
    } catch {
      // Silent error
    }
    cx.notify();
  }

  async resendPrompt(item, cx) {
    try {
      const target = this.selectedTarget || item.terminal || "t1";
      await hc(["send", target, item.prompt]);
      notify(`Re-sent annotation to agent ${target}`);
    } catch (err) {
      notify(`Failed to re-send: ${err.message}`);
    }
  }

  async copyBookmarklet(cx) {
    const bookmarklet = `javascript:(function(){var s=document.createElement('script');s.src='http://127.0.0.1:7890/content.js?t='+Date.now();document.body.appendChild(s);var c=document.createElement('link');c.rel='stylesheet';c.href='http://127.0.0.1:7890/content.css?t='+Date.now();document.head.appendChild(c);})();`;
    try {
      await exec("pbcopy", [], { stdin: bookmarklet });
      this.copiedBookmarklet = true;
      notify("Bookmarklet copied to clipboard! Paste it into browser URL bar.");
      cx.notify();
      setTimeout(() => {
        this.copiedBookmarklet = false;
        cx.notify();
      }, 3000);
    } catch (err) {
      notify(`Failed to copy: ${err.message}`);
    }
  }

  async openChromeWithExtension(cx) {
    try {
      await exec("open", ["-a", "Google Chrome", "chrome://extensions"]);
      notify("Opened Google Chrome extensions page. Turn on 'Developer mode' and click 'Load unpacked'.");
    } catch (err) {
      notify(`Error opening Chrome: ${err.message}`);
    }
  }

  render() {
    const t = theme();

    return v_flex()
      .id("browser-annotate-mod")
      .track_focus(this.handle)
      .w_full()
      .h_full()
      .bg(t.background)
      .text_color(t.foreground)
      .p(16)
      .gap(14)
      .child(this.renderHeader(t))
      .child(this.renderSetupCard(t))
      .child(this.renderHistorySection(t));
  }

  renderHeader(t) {
    const isOnline = this.isBridgeRunning;
    const accentCol = t.accent ?? t.working ?? "#E6A854";
    const greenCol = t.done ?? t.ansi2 ?? "#74BBA2";
    const redCol = t.danger ?? "#E06C75";

    return h_flex()
      .w_full()
      .items_center()
      .justify_between()
      .p(12)
      .bg(t.raised)
      .rounded(10)
      .border_1()
      .border_color(t.input)
      .child(
        h_flex()
          .items_center()
          .gap(10)
          .child(
            div()
              .size(28)
              .rounded(6)
              .bg(accentCol)
              .text_color(t.background)
              .items_center()
              .justify_center()
              .font_bold()
              .text_size(14)
              .child("H"),
          )
          .child(
            v_flex()
              .gap(2)
              .child(
                div()
                  .text_size(14)
                  .font_semibold()
                  .text_color(t.foreground)
                  .child("Browser Annotate (ADE)"),
              )
              .child(
                h_flex()
                  .items_center()
                  .gap(6)
                  .child(
                    div()
                      .size(7)
                      .rounded(4)
                      .bg(isOnline ? greenCol : redCol),
                  )
                  .child(
                    div()
                      .text_size(11)
                      .text_color(isOnline ? greenCol : t.muted)
                      .child(isOnline ? `Bridge Online (port ${BRIDGE_PORT})` : "Bridge Stopped"),
                  ),
              ),
          ),
      )
      .child(
        h_flex()
          .items_center()
          .gap(8)
          .child(
            div()
              .px(10)
              .py(5)
              .rounded(6)
              .bg(isOnline ? t.background : accentCol)
              .text_color(isOnline ? t.foreground : t.background)
              .border_1()
              .border_color(isOnline ? t.input : accentCol)
              .text_size(11.5)
              .font_medium()
              .cursor_pointer()
              .hover((s) => s.opacity(0.85))
              .on_click((_e, cx) => (isOnline ? this.stopBridge(cx) : this.startBridge(cx)))
              .child(isOnline ? "Stop Bridge" : "Start Bridge"),
          )
          .child(
            div()
              .px(10)
              .py(5)
              .rounded(6)
              .bg(t.background)
              .text_color(t.foreground)
              .border_1()
              .border_color(t.input)
              .text_size(11.5)
              .font_medium()
              .cursor_pointer()
              .hover((s) => s.opacity(0.85))
              .on_click((_e, cx) => this.refreshData(cx))
              .child("Refresh"),
          ),
      );
  }

  renderSetupCard(t) {
    const accentCol = t.accent ?? t.working ?? "#E6A854";
    const greenCol = t.done ?? t.ansi2 ?? "#74BBA2";

    return v_flex()
      .w_full()
      .p(14)
      .bg(t.raised)
      .rounded(10)
      .border_1()
      .border_color(t.input)
      .gap(10)
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .child(
            div()
              .text_size(12.5)
              .font_semibold()
              .text_color(t.foreground)
              .child("Cara Pakai di Browser (Chrome / Arc / Safari)"),
          ),
      )
      .child(
        div()
          .text_size(11.5)
          .text_color(t.muted)
          .child(
            "Pilih salah satu metode di bawah ini untuk mengaktifkan inspector ADE di browser Anda:",
          ),
      )
      .child(
        h_flex()
          .w_full()
          .gap(10)
          .child(
            v_flex()
              .flex_1()
              .p(10)
              .bg(t.background)
              .rounded(8)
              .border_1()
              .border_color(t.input)
              .gap(6)
              .child(
                div()
                  .text_size(12)
                  .font_medium()
                  .text_color(accentCol)
                  .child("Metode 1: Bookmarklet (Instan tanpa install)"),
              )
              .child(
                div()
                  .text_size(11)
                  .text_color(t.dim)
                  .child("Copy bookmarklet dan simpan di bookmark bar browser Anda:"),
              )
              .child(
                div()
                  .px(10)
                  .py(6)
                  .rounded(6)
                  .bg(this.copiedBookmarklet ? greenCol : t.raised)
                  .text_color(this.copiedBookmarklet ? t.background : t.foreground)
                  .border_1()
                  .border_color(t.input)
                  .text_size(11.5)
                  .font_medium()
                  .cursor_pointer()
                  .items_center()
                  .justify_center()
                  .hover((s) => s.opacity(0.85))
                  .on_click((_e, cx) => this.copyBookmarklet(cx))
                  .child(this.copiedBookmarklet ? "✓ Berhasil Di-Copy!" : "📋 Copy Bookmarklet Script"),
              ),
          )
          .child(
            v_flex()
              .flex_1()
              .p(10)
              .bg(t.background)
              .rounded(8)
              .border_1()
              .border_color(t.input)
              .gap(6)
              .child(
                div()
                  .text_size(12)
                  .font_medium()
                  .text_color(accentCol)
                  .child("Metode 2: Chrome Extension (Full Fitur)"),
              )
              .child(
                div()
                  .text_size(11)
                  .text_color(t.dim)
                  .child("Load unpacked extension dari folder mod ini di chrome://extensions:"),
              )
              .child(
                div()
                  .px(10)
                  .py(6)
                  .rounded(6)
                  .bg(t.raised)
                  .text_color(t.foreground)
                  .border_1()
                  .border_color(t.input)
                  .text_size(11.5)
                  .font_medium()
                  .cursor_pointer()
                  .items_center()
                  .justify_center()
                  .hover((s) => s.opacity(0.85))
                  .on_click((_e, cx) => this.openChromeWithExtension(cx))
                  .child("🚀 Buka chrome://extensions"),
              ),
          ),
      );
  }

  renderHistorySection(t) {
    const accentCol = t.accent ?? t.working ?? "#E6A854";

    return v_flex()
      .w_full()
      .flex_1()
      .min_h(0)
      .p(14)
      .bg(t.raised)
      .rounded(10)
      .border_1()
      .border_color(t.input)
      .gap(10)
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .child(
            div()
              .text_size(12.5)
              .font_semibold()
              .text_color(t.foreground)
              .child(`Anotasi Masuk Terbaru (${this.history.length})`),
          ),
      )
      .child(
        this.history.length === 0
          ? v_flex()
              .flex_1()
              .items_center()
              .justify_center()
              .gap(8)
              .p(24)
              .child(
                div()
                  .text_size(12.5)
                  .text_color(t.muted)
                  .child("Belum ada anotasi yang dikirim dari browser."),
              )
              .child(
                div()
                  .text_size(11)
                  .text_color(t.dim)
                  .child("Buka web app Anda di browser, aktifkan Cek atau Block, lalu kirim instruksi."),
              )
          : v_flex()
              .flex_1()
              .min_h(0)
              .gap(8)
              .children(
                this.history.map((item) => {
                  return h_flex()
                    .w_full()
                    .p(10)
                    .bg(t.background)
                    .rounded(8)
                    .border_1()
                    .border_color(t.input)
                    .justify_between()
                    .items_center()
                    .gap(12)
                    .child(
                      v_flex()
                        .flex_1()
                        .gap(3)
                        .child(
                          h_flex()
                            .items_center()
                            .gap(8)
                            .child(
                              div()
                                .px(6)
                                .py(2)
                                .rounded(4)
                                .bg(t.raised)
                                .text_color(accentCol)
                                .text_size(11)
                                .font_medium()
                                .child(`Agent [${item.terminal}]`),
                            )
                            .child(
                              div()
                                .text_size(11)
                                .text_color(t.dim)
                                .child(timeAgo(item.timestamp)),
                            ),
                        )
                        .child(
                          div()
                            .text_size(12)
                            .font_medium()
                            .text_color(t.foreground)
                            .child(item.instruction || "Anotasi UI"),
                        )
                        .child(
                          div()
                            .text_size(11)
                            .text_color(t.muted)
                            .truncate()
                            .child(`${item.element?.selector || item.pageUrl || ""}`),
                        ),
                    )
                    .child(
                      div()
                        .px(8)
                        .py(4)
                        .rounded(6)
                        .bg(t.raised)
                        .border_1()
                        .border_color(t.input)
                        .text_size(11)
                        .text_color(t.foreground)
                        .cursor_pointer()
                        .hover((s) => s.opacity(0.85))
                        .on_click((_e, cx) => this.resendPrompt(item, cx))
                        .child("Kirim Ulang"),
                    );
                }),
              ),
      );
  }
}
