// Agent Management & Mission Control for Herdr
// Cockpit, Task Dispatcher with Persona Templates, Live Hierarchy, and Full Persona Studio (CRUD)

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, Textarea, TextareaState } from "gpui-base";
import {
  agents,
  terminals,
  panes,
  focused,
  spaces,
  run,
  hc,
  exec,
  home,
  theme,
  shared,
  setShared,
  setAgentOrder,
  notify,
} from "herdr";

const ICONS = "mods/agent-manager/icons";
const SCRIPT_PATH = `${home()}/.config/herdr-app/mods/agent-manager/scripts/templates.py`;

const PERSONAS_META = {
  begu: {
    name: "Begu",
    cmd: "agy",
    desc: "Senior Fullstack Web Developer & Software Architect",
    color: "#61afef",
    badge: "Fullstack",
  },
  ipos: {
    name: "Ipos",
    cmd: "agy",
    desc: "Elite UI/UX Designer & Frontend Polisher",
    color: "#e5c07b",
    badge: "UI/UX",
  },
  bodat: {
    name: "Bodat",
    cmd: "claude",
    desc: "Senior Code Reviewer & Security Auditor",
    color: "#e06c75",
    badge: "Security",
  },
  datu: {
    name: "Datu",
    cmd: "codex --no-daemon",
    desc: "Database Architect & Query Optimizer",
    color: "#98c379",
    badge: "Database",
  },
  basing: {
    name: "Basing",
    cmd: "opencode",
    desc: "Code Janitor, Linter & Refactoring Specialist",
    color: "#56b6c2",
    badge: "Janitor",
  },
  pangulubalang: {
    name: "Pangulubalang",
    cmd: "agy",
    desc: "DevOps Guardian, Linux Server & CI/CD Engineer",
    color: "#d19a66",
    badge: "DevOps",
  },
  parhata: {
    name: "Parhata",
    cmd: "agy",
    desc: "Lead Technical Writer & Documentation Scribe",
    color: "#c678dd",
    badge: "Docs",
  },
  tombak: {
    name: "Tombak",
    cmd: "claude",
    desc: "QA Automation, Adversarial Testing & Edge-Case Hunter",
    color: "#be5046",
    badge: "QA / Test",
  },
};

const PROMPT_SUGGESTIONS = [
  "Review git diff terakhir dan audit potensi celah keamanan atau bug",
  "Refactor kode yang berantakan, bersihkan dead code dan unused imports",
  "Rancang arsitektur komponen UI baru dengan styling modern dan rapi",
  "Buatkan unit test dan edge-case testing untuk fitur yang baru dibuat",
  "Optimasi query database lambat dan periksa index yang hilang",
];

const QUICK_COMMANDS = ["agy", "claude", "opencode", "codex", "gemini"];

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export default class AgentManager extends View {
  init(_props, cx) {
    this.tab = "cockpit"; // "cockpit" | "launch" | "personas" | "history"
    try {
      this.tab = localStorage.getItem("agents.activeTab") || "cockpit";
    } catch {}

    this.filterStatus = "all"; // "all" | "blocked" | "working" | "done" | "idle"
    this.sessionFilter = "agents"; // "agents" | "all"
    this.selectedPersona = "begu";
    this.launchMode = "tab"; // "tab" | "split" | "bg"
    this.selectedSpaceId = null;
    this.activeMessageAgent = null;
    this.foldedSubs = new Set();
    this.historyList = [];
    this.templatesList = [];
    this.notice = null;
    this.changed = {};

    // Persona Studio CRUD state
    this.isPersonaFormOpen = false;
    this.personaFormMode = "create"; // "create" | "edit"
    this.personaEditingId = null;
    this.personaConfirmDeleteId = null;
    this.expandedDirectives = new Set();

    try {
      this.changed = JSON.parse(localStorage.getItem("agents.changed") ?? "{}");
    } catch {}

    // Inputs
    this.searchInput = InputState.new({
      placeholder: "Filter agents, space, task...",
    });
    this.searchInput.on("change", (_e, cx) => cx.notify());

    this.taskInput = TextareaState.new({
      placeholder: "Tuliskan instruksi atau tugas spesifik untuk agent di sini...",
      rows: 4,
    });
    this.taskInput.on("change", (_e, cx) => cx.notify());

    this.msgInput = TextareaState.new({
      placeholder: "Kirim prompt tambahan atau jawaban...",
      rows: 2,
    });
    this.msgInput.on("change", (_e, cx) => cx.notify());

    // CRUD Persona Inputs
    this.formIdInput = InputState.new({
      placeholder: "ID unik (huruf kecil & tanda hubung, misal: reviewer, tester)...",
    });
    this.formIdInput.on("change", (_e, cx) => cx.notify());

    this.formNameInput = InputState.new({
      placeholder: "Nama Agent (misal: Begu, Code Reviewer)...",
    });
    this.formNameInput.on("change", (_e, cx) => cx.notify());

    this.formCmdInput = InputState.new({
      placeholder: "CLI Command (agy, claude, opencode, codex, dll)...",
    });
    this.formCmdInput.on("change", (_e, cx) => cx.notify());

    this.formDescInput = InputState.new({
      placeholder: "Deskripsi singkat keahlian agent...",
    });
    this.formDescInput.on("change", (_e, cx) => cx.notify());

    this.formPromptInput = TextareaState.new({
      placeholder: "System Directives & Core Instructions (Markdown format)...",
      rows: 8,
    });
    this.formPromptInput.on("change", (_e, cx) => cx.notify());

    // Auto refresh timer
    cx.timer.every(2500, (timerCx) => {
      this.updateStateBadges();
      timerCx.notify();
    });

    // Load templates and history in background
    cx.spawn(async (spawnCx) => {
      await this.loadTemplates();
      await this.loadHistory();
      spawnCx.notify();
    });
  }

  updateStateBadges() {
    try {
      const list = typeof agents === "function" ? agents() : [];
      const blocked = list.filter((a) => a.status === "blocked").length;
      const bObj = shared("mod-badges") || {};
      if (bObj.agents !== blocked) {
        setShared("mod-badges", { ...bObj, agents: blocked });
      }
    } catch {}
  }

  async loadTemplates() {
    try {
      const res = await exec("python3", [SCRIPT_PATH, "list"]);
      if (res && res.stdout) {
        const list = JSON.parse(res.stdout.trim());
        if (Array.isArray(list) && list.length > 0) {
          this.templatesList = list;
          return;
        }
      }
    } catch {}

    // Fallback if script fails
    try {
      const res = await hc(["templates", "--json"]);
      if (res && res.stdout) {
        const data = JSON.parse(res.stdout);
        if (Array.isArray(data.templates)) {
          this.templatesList = data.templates.map((t) => ({
            name: t.name,
            displayName: t.name.charAt(0).toUpperCase() + t.name.slice(1),
            description: t.description,
            command: t.command,
            prompt: "",
          }));
          return;
        }
      }
    } catch {}

    // Fallback to static templates
    this.templatesList = Object.entries(PERSONAS_META).map(([id, meta]) => ({
      name: id,
      displayName: meta.name,
      description: meta.desc,
      command: meta.cmd,
      prompt: "",
    }));
  }

  getPersonas() {
    if (this.templatesList && this.templatesList.length > 0) {
      return this.templatesList.map((tpl) => {
        const id = tpl.name.toLowerCase();
        const meta = PERSONAS_META[id] || {};
        return {
          id: id,
          name: tpl.displayName || meta.name || tpl.name,
          cmd: tpl.command || meta.cmd || "agy",
          desc: tpl.description || meta.desc || "",
          icon: meta.icon || "bot.svg",
          color: meta.color || "#61afef",
          badge: meta.badge || tpl.command || "Agent",
          prompt: tpl.prompt || "",
        };
      });
    }

    return Object.entries(PERSONAS_META).map(([id, meta]) => ({
      id,
      name: meta.name,
      cmd: meta.cmd,
      desc: meta.desc,
      icon: "bot.svg",
      color: meta.color,
      badge: meta.badge,
      prompt: "",
    }));
  }

  async loadHistory() {
    try {
      const res = await hc(["ls", "--json", "--all"]);
      if (res && res.stdout) {
        const data = JSON.parse(res.stdout);
        if (Array.isArray(data.terminals)) {
          this.historyList = data.terminals.filter((t) => t.state === "finished");
        }
      }
    } catch {}
  }

  trackChanges(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (dirty) {
      try {
        localStorage.setItem("agents.changed", JSON.stringify(this.changed));
      } catch {}
    }
  }

  since(address) {
    return this.changed[address]?.at ?? 0;
  }

  showNotice(msg, cx) {
    this.notice = msg;
    if (cx) {
      try {
        cx.notify();
      } catch {}
      try {
        cx.timer.after(3500, (timerCx) => {
          if (this.notice === msg) {
            this.notice = null;
            timerCx.notify();
          }
        });
      } catch {}
    }
  }

  handleLaunch(cx) {
    const task = this.taskInput.value().trim();
    if (!task) {
      this.showNotice("Silakan isi instruksi tugas terlebih dahulu.", cx);
      return;
    }

    const allSpaces = spaces();
    const activeSpace = allSpaces.find((s) => s.id === this.selectedSpaceId) || allSpaces.find((s) => s.active) || allSpaces[0];
    const persona = this.selectedPersona || "begu";
    const spaceId = activeSpace?.id;
    const folder = activeSpace?.cwd || undefined;

    cx.spawn(async (cx) => {
      try {
        if (this.launchMode === "tab") {
          run("tab.new", {
            space: spaceId,
            folder,
            argv: ["hc", "run", persona, task],
            name: `${persona}: ${task.slice(0, 16)}...`,
          });
          notify({ title: `Agent ${persona} Diluncurkan`, body: `Misi dimulai di Tab Baru`, level: "success", timeout: 3000 });
          this.showNotice(`Agent ${persona} diluncurkan di Tab Baru!`, cx);
        } else if (this.launchMode === "split") {
          run("pane.split", {
            direction: "right",
            argv: ["hc", "run", persona, task],
          });
          notify({ title: `Agent ${persona} Diluncurkan`, body: `Misi dimulai di Split Pane`, level: "success", timeout: 3000 });
          this.showNotice(`Agent ${persona} diluncurkan di Split Pane!`, cx);
        } else if (this.launchMode === "bg") {
          await hc(["run", "--bg", "--cwd", folder || "", persona, task]);
          notify({ title: `Agent ${persona} Diluncurkan`, body: `Misi berjalan di background`, level: "info", timeout: 3000 });
          this.showNotice(`Agent ${persona} berjalan di latar belakang!`, cx);
        }

        this.taskInput.set_value("");
        this.tab = "cockpit";
        cx.notify();
      } catch (err) {
        this.showNotice(`Gagal meluncurkan agent: ${err.message || err}`, cx);
      }
    });
  }

  handleInterrupt(address, cx) {
    cx.spawn(async (cx) => {
      try {
        await hc(["interrupt", address]);
        notify({ title: "Sinyal Stop", body: `Stop dikirim ke ${address}`, level: "warning", timeout: 2000 });
        this.showNotice(`Sinyal stop dikirim ke ${address}`, cx);
      } catch (err) {
        this.showNotice(`Gagal interrupt: ${err.message || err}`, cx);
      }
    });
  }

  handleKill(address, cx) {
    cx.spawn(async (cx) => {
      try {
        await hc(["kill", address]);
        notify({ title: "Agent Terminated", body: `Terminal ${address} dihentikan`, level: "info", timeout: 2000 });
        this.showNotice(`Terminal ${address} telah dihentikan`, cx);
        cx.notify();
      } catch (err) {
        this.showNotice(`Gagal menghentikan: ${err.message || err}`, cx);
      }
    });
  }

  handleSendMessage(address, cx) {
    const text = this.msgInput.value().trim();
    if (!text) return;
    cx.spawn(async (cx) => {
      try {
        await hc(["send", address, text]);
        this.msgInput.set_value("");
        this.activeMessageAgent = null;
        notify({ title: "Pesan Terkirim", body: `Input diteruskan ke ${address}`, level: "success", timeout: 2000 });
        this.showNotice(`Pesan terkirim ke ${address}`, cx);
        cx.notify();
      } catch (err) {
        this.showNotice(`Gagal mengirim pesan: ${err.message || err}`, cx);
      }
    });
  }

  handleRemoveHistory(address, cx) {
    cx.spawn(async (cx) => {
      try {
        await hc(["rm", address]);
        await this.loadHistory();
        cx.notify();
      } catch {}
    });
  }

  handleClearAllHistory(cx) {
    cx.spawn(async (cx) => {
      try {
        for (const t of this.historyList) {
          await hc(["rm", t.address]);
        }
        await this.loadHistory();
        notify({ title: "History Cleaned", body: "Seluruh riwayat dibersihkan", level: "info", timeout: 2000 });
        this.showNotice("Seluruh riwayat terminal selesai dibersihkan", cx);
        cx.notify();
      } catch {}
    });
  }

  // ── Persona Studio CRUD Actions ──────────────────────────────────────────────

  openCreatePersonaForm() {
    this.isPersonaFormOpen = true;
    this.personaFormMode = "create";
    this.personaEditingId = null;
    this.personaConfirmDeleteId = null;

    this.formIdInput.set_value("");
    this.formNameInput.set_value("");
    this.formCmdInput.set_value("agy");
    this.formDescInput.set_value("");
    this.formPromptInput.set_value("You are an expert AI agent.\n\n## Core Directives\n1. Focus on code quality and defensive programming.\n2. Work iteratively and report progress concisely.");
  }

  openEditPersonaForm(tpl) {
    this.isPersonaFormOpen = true;
    this.personaFormMode = "edit";
    this.personaEditingId = tpl.name;
    this.personaConfirmDeleteId = null;

    this.formIdInput.set_value(tpl.name);
    this.formNameInput.set_value(tpl.displayName || tpl.name);
    this.formCmdInput.set_value(tpl.command || "agy");
    this.formDescInput.set_value(tpl.description || "");
    this.formPromptInput.set_value(tpl.prompt || "");
  }

  closePersonaForm() {
    this.isPersonaFormOpen = false;
    this.personaEditingId = null;
    this.personaConfirmDeleteId = null;
  }

  savePersona(cx) {
    const id = this.formIdInput.value().trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    const name = this.formNameInput.value().trim();
    const cmd = this.formCmdInput.value().trim();
    const desc = this.formDescInput.value().trim();
    const prompt = this.formPromptInput.value().trim();

    if (!id) {
      this.showNotice("ID Persona tidak boleh kosong.", cx);
      return;
    }
    if (!name) {
      this.showNotice("Nama Agent tidak boleh kosong.", cx);
      return;
    }
    if (!cmd) {
      this.showNotice("CLI Command tidak boleh kosong.", cx);
      return;
    }

    cx.spawn(async (cx) => {
      try {
        const res = await exec("python3", [SCRIPT_PATH, "save", id, name, cmd, desc, prompt]);
        if (res && res.stdout && res.stdout.includes('"ok": true')) {
          notify({ title: "Persona Tersimpan", body: `${name} (${cmd}) siap digunakan`, level: "success", timeout: 3000 });
          this.showNotice(`Persona ${name} berhasil disimpan!`, cx);
          await this.loadTemplates();
          this.isPersonaFormOpen = false;
          this.personaEditingId = null;
          cx.notify();
        } else {
          this.showNotice(`Gagal menyimpan: ${res?.stderr || res?.stdout || "Unknown error"}`, cx);
        }
      } catch (err) {
        this.showNotice(`Gagal menyimpan persona: ${err.message || err}`, cx);
      }
    });
  }

  deletePersona(id, cx) {
    cx.spawn(async (cx) => {
      try {
        const res = await exec("python3", [SCRIPT_PATH, "delete", id]);
        if (res && res.stdout && res.stdout.includes('"ok": true')) {
          notify({ title: "Persona Dihapus", body: `Template ${id} telah dihapus`, level: "info", timeout: 2500 });
          this.showNotice(`Template ${id} berhasil dihapus!`, cx);
          this.personaConfirmDeleteId = null;
          await this.loadTemplates();
          if (this.selectedPersona === id) {
            this.selectedPersona = "begu";
          }
          cx.notify();
        } else {
          this.showNotice(`Gagal menghapus: ${res?.stderr || res?.stdout || "Unknown error"}`, cx);
        }
      } catch (err) {
        this.showNotice(`Gagal menghapus persona: ${err.message || err}`, cx);
      }
    });
  }

  // ── Render Components ────────────────────────────────────────────────────────

  renderHeader(stats, t) {
    const tabItem = (id, label, iconFile) => {
      const active = this.tab === id;
      return h_flex()
        .px(8)
        .h(26)
        .gap(5)
        .items_center()
        .rounded(6)
        .cursor_pointer()
        .when(active, (el) => el.bg(t.raised).text_color(t.foreground).font_medium())
        .when(!active, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)))
        .on_click((_e, cx) => {
          this.tab = id;
          try {
            localStorage.setItem("agents.activeTab", id);
          } catch {}
          if (id === "history") this.loadHistory();
          if (id === "personas") this.loadTemplates();
          cx.notify();
        })
        .child(svg(`${ICONS}/${iconFile}`).size(12))
        .child(div().text_size(11.5).child(label));
    };

    return v_flex()
      .p(10)
      .gap(8)
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .child(
            h_flex()
              .gap(7)
              .items_center()
              .child(svg(`${ICONS}/bot.svg`).size(16).text_color(t.accent || t.ansi4))
              .child(div().font_bold().text_size(13).text_color(t.foreground).child("Agent Mission Control")),
          )
          .child(
            h_flex()
              .gap(5)
              .items_center()
              .when(stats.blocked > 0, (el) =>
                el.child(
                  div()
                    .px(6)
                    .h(19)
                    .rounded(4)
                    .bg((t.blocked || "#e06c75") + "26")
                    .text_color(t.blocked || "#e06c75")
                    .text_size(10)
                    .font_bold()
                    .flex()
                    .items_center()
                    .cursor_pointer()
                    .tooltip("Ada agent yang butuh keputusan Anda!")
                    .on_click((_e, cx) => {
                      this.tab = "cockpit";
                      this.filterStatus = "blocked";
                      cx.notify();
                    })
                    .child(`! ${stats.blocked} Needs You`),
                ),
              )
              .when(stats.working > 0, (el) =>
                el.child(
                  div()
                    .px(6)
                    .h(19)
                    .rounded(4)
                    .bg((t.working || "#61afef") + "26")
                    .text_color(t.working || "#61afef")
                    .text_size(10)
                    .font_medium()
                    .flex()
                    .items_center()
                    .gap(4)
                    .child(svg(`${ICONS}/spinner.svg`).size(10).spin(900))
                    .child(`${stats.working} Running`),
                ),
              )
              .child(
                div()
                  .px(6)
                  .h(19)
                  .rounded(4)
                  .bg(t.raised)
                  .text_color(t.dim)
                  .text_size(10)
                  .flex()
                  .items_center()
                  .child(`${stats.total} Total`),
              ),
          ),
      )
      .child(
        h_flex()
          .gap(4)
          .items_center()
          .child(tabItem("cockpit", "Cockpit", "bot.svg"))
          .child(tabItem("launch", "New Mission", "play.svg"))
          .child(tabItem("personas", "Personas", "pencil.svg"))
          .child(tabItem("history", "History", "terminal.svg")),
      )
      .when(Boolean(this.notice), (el) =>
        el.child(
          h_flex()
            .px(8)
            .py(5)
            .rounded(6)
            .bg(t.popover)
            .border_1()
            .border_color(t.accent || t.border)
            .items_center()
            .justify_between()
            .child(div().text_size(11).text_color(t.foreground).child(this.notice))
            .child(
              div()
                .cursor_pointer()
                .p(2)
                .rounded(4)
                .text_color(t.dim)
                .hover((s) => s.bg(t.hover).text_color(t.foreground))
                .on_click((_e, cx) => {
                  this.notice = null;
                  cx.notify();
                })
                .child(svg(`${ICONS}/x.svg`).size(10)),
            ),
        ),
      );
  }

  // ── Cockpit (Live Monitoring & Controls) ─────────────────────────────────────

  renderAgentCard(agent, subagents, now, t) {
    const isFolded = this.foldedSubs.has(agent.address);
    const sinceMs = this.since(agent.address);
    const timeStr = sinceMs ? duration(now - sinceMs) : null;
    const isMsgOpen = this.activeMessageAgent === agent.address;

    const personaMeta = Object.values(PERSONAS_META).find((p) => (agent.title || "").toLowerCase().includes(p.name.toLowerCase())) || null;
    const agentColor = personaMeta?.color || (agent.status === "working" ? t.working : agent.status === "blocked" ? t.blocked : t.accent || t.ansi4);

    return v_flex()
      .id(`agent-card-${agent.address}`)
      .rounded(8)
      .border_1()
      .border_color(agent.status === "blocked" ? (t.blocked || "#e06c75") : t.border)
      .bg(t.chrome)
      .overflow_hidden()
      // Card Header
      .child(
        h_flex()
          .p(8)
          .gap(7)
          .items_center()
          .bg(t.raised)
          .child(
            div()
              .size(24)
              .rounded(5)
              .bg(t.background)
              .flex()
              .items_center()
              .justify_center()
              .child(svg(`${ICONS}/bot.svg`).size(14).text_color(agentColor)),
          )
          .child(
            v_flex()
              .flex_1()
              .min_w(0)
              .gap(1)
              .child(
                h_flex()
                  .gap(5)
                  .items_center()
                  .child(
                    div()
                      .font_semibold()
                      .text_size(12)
                      .text_color(t.foreground)
                      .truncate()
                      .child(agent.title || personaMeta?.name || agent.address),
                  )
                  .child(
                    div()
                      .px(4.5)
                      .h(15)
                      .rounded(3)
                      .bg(t.background)
                      .text_size(9.5)
                      .text_color(t.dim)
                      .child(agent.address),
                  ),
              )
              .child(
                h_flex()
                  .gap(4)
                  .items_center()
                  .child(div().text_size(10.5).text_color(t.dim).child(agent.space_name || "local"))
                  .when(Boolean(agent.tab_name), (el) =>
                    el.child(div().text_size(10.5).text_color(t.dim).child(`· ${agent.tab_name}`)),
                  ),
              ),
          )
          // Status Badge
          .child(
            h_flex()
              .gap(4)
              .items_center()
              .when(agent.status === "working", (el) =>
                el.child(
                  div()
                    .px(6)
                    .h(20)
                    .rounded(5)
                    .bg((t.working || "#61afef") + "26")
                    .text_color(t.working || "#61afef")
                    .text_size(10)
                    .font_medium()
                    .flex()
                    .items_center()
                    .gap(4)
                    .child(svg(`${ICONS}/spinner.svg`).size(10.5).spin(900))
                    .child("Working"),
                ),
              )
              .when(agent.status === "blocked", (el) =>
                el.child(
                  div()
                    .px(6)
                    .h(20)
                    .rounded(5)
                    .bg((t.blocked || "#e06c75") + "26")
                    .text_color(t.blocked || "#e06c75")
                    .text_size(10)
                    .font_bold()
                    .flex()
                    .items_center()
                    .gap(3)
                    .child("! Needs You"),
                ),
              )
              .when(agent.status === "done", (el) =>
                el.child(
                  div()
                    .px(6)
                    .h(20)
                    .rounded(5)
                    .bg((t.done || "#98c379") + "26")
                    .text_color(t.done || "#98c379")
                    .text_size(10)
                    .font_medium()
                    .flex()
                    .items_center()
                    .child("Done"),
                ),
              )
              .when(agent.status === "idle", (el) =>
                el.child(
                  div()
                    .px(6)
                    .h(20)
                    .rounded(5)
                    .bg(t.raised)
                    .text_color(t.dim)
                    .text_size(10)
                    .flex()
                    .items_center()
                    .child("Idle"),
                ),
              )
              .when(Boolean(timeStr), (el) =>
                el.child(div().text_size(10).text_color(t.dim).child(timeStr)),
              ),
          ),
      )
      // Subagents tree preview (if any)
      .when(subagents.length > 0, (el) =>
        el.child(
          v_flex()
            .px(8)
            .py(5)
            .gap(4)
            .bg(t.background)
            .border_t(1)
            .border_color(t.border)
            .child(
              h_flex()
                .items_center()
                .justify_between()
                .cursor_pointer()
                .on_click((_e, cx) => {
                  if (isFolded) this.foldedSubs.delete(agent.address);
                  else this.foldedSubs.add(agent.address);
                  cx.notify();
                })
                .child(
                  h_flex()
                    .gap(4)
                    .items_center()
                    .child(
                      svg(`${ICONS}/${isFolded ? "chevron-right" : "chevron-down"}.svg`)
                        .size(10)
                        .text_color(t.dim),
                    )
                    .child(
                      div()
                        .text_size(10.5)
                        .font_medium()
                        .text_color(t.dim)
                        .child(`Subagents (${subagents.length})`),
                    ),
                ),
            )
            .when(!isFolded, (subContainer) =>
              subContainer.children(
                subagents.map((sub) =>
                  h_flex()
                    .pl(14)
                    .pr(6)
                    .h(22)
                    .gap(6)
                    .items_center()
                    .rounded(4)
                    .bg(t.raised)
                    .cursor_pointer()
                    .hover((s) => s.bg(t.hover))
                    .on_click(() => run("terminal.peek", { terminal: sub.address }))
                    .child(svg(`${ICONS}/bot.svg`).size(10).text_color(t.dim))
                    .child(
                      div()
                        .flex_1()
                        .truncate()
                        .text_size(10.5)
                        .text_color(t.foreground)
                        .child(sub.name || sub.address),
                    )
                    .child(
                      div()
                        .size(6)
                        .rounded(3)
                        .bg(sub.status === "working" ? t.working : sub.status === "done" ? t.done : t.dim),
                    ),
                ),
              ),
            ),
        ),
      )
      // Action Toolbar
      .child(
        h_flex()
          .p(6)
          .gap(4)
          .items_center()
          .bg(t.background)
          .border_t(1)
          .border_color(t.border)
          // Focus Pane
          .child(
            h_flex()
              .h(24)
              .px(7)
              .gap(4)
              .items_center()
              .rounded(5)
              .bg(t.raised)
              .cursor_pointer()
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .text_color(t.muted)
              .tooltip("Buka dan fokus ke terminal pane")
              .on_click(() => {
                if (agent.pane) {
                  try {
                    run("pane.focus", { pane: agent.pane });
                    return;
                  } catch {}
                }
                try {
                  run("pane.focus", { terminal: agent.address });
                } catch {
                  run("terminal.peek", { terminal: agent.address });
                }
              })
              .child(svg(`${ICONS}/terminal.svg`).size(11))
              .child(div().text_size(10.5).child("Focus")),
          )
          // Peek Screen
          .child(
            h_flex()
              .h(24)
              .px(7)
              .gap(4)
              .items_center()
              .rounded(5)
              .bg(t.raised)
              .cursor_pointer()
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .text_color(t.muted)
              .tooltip("Intip layar terminal tanpa berpindah pane")
              .on_click(() => run("terminal.peek", { terminal: agent.address }))
              .child(svg(`${ICONS}/search.svg`).size(11))
              .child(div().text_size(10.5).child("Peek")),
          )
          // Send Message Toggle
          .child(
            h_flex()
              .h(24)
              .px(7)
              .gap(4)
              .items_center()
              .rounded(5)
              .bg(isMsgOpen ? t.hover : t.raised)
              .cursor_pointer()
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .text_color(isMsgOpen ? (t.accent || t.foreground) : t.muted)
              .tooltip("Kirim teks / feedback prompt ke agent ini")
              .on_click((_e, cx) => {
                this.activeMessageAgent = isMsgOpen ? null : agent.address;
                this.msgInput.set_value("");
                cx.notify();
              })
              .child(svg(`${ICONS}/send.svg`).size(10.5))
              .child(div().text_size(10.5).child("Prompt")),
          )
          .child(div().flex_1())
          // Stop / Interrupt
          .child(
            h_flex()
              .size(24)
              .items_center()
              .justify_center()
              .rounded(5)
              .bg(t.raised)
              .cursor_pointer()
              .hover((s) => s.bg(t.hover).text_color(t.blocked || "#e06c75"))
              .text_color(t.dim)
              .tooltip("Stop / Interrupt langkah agent saat ini")
              .on_click((_e, cx) => this.handleInterrupt(agent.address, cx))
              .child(svg(`${ICONS}/stop.svg`).size(11)),
          )
          // Pin Toggle
          .child(
            h_flex()
              .size(24)
              .items_center()
              .justify_center()
              .rounded(5)
              .bg(t.raised)
              .cursor_pointer()
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .text_color(agent.pinned ? (t.accent || t.ansi4) : t.dim)
              .tooltip(agent.pinned ? "Lepas pin" : "Pin ke paling atas")
              .on_click((_e, cx) => {
                run("terminal.pin", { terminal: agent.address, pinned: !agent.pinned });
                cx.notify();
              })
              .child(svg(`${ICONS}/${agent.pinned ? "pin-off" : "pin"}.svg`).size(11)),
          )
          // Kill / Terminate
          .child(
            h_flex()
              .size(24)
              .items_center()
              .justify_center()
              .rounded(5)
              .bg(t.raised)
              .cursor_pointer()
              .hover((s) => s.bg(t.hover).text_color(t.blocked || "#e06c75"))
              .text_color(t.dim)
              .tooltip("Matikan dan tutup terminal agent")
              .on_click((_e, cx) => this.handleKill(agent.address, cx))
              .child(svg(`${ICONS}/trash.svg`).size(11)),
          ),
      )
      // Inline Send Message Box
      .when(isMsgOpen, (el) =>
        el.child(
          v_flex()
            .p(8)
            .gap(6)
            .bg(t.popover)
            .border_t(1)
            .border_color(t.border)
            .child(
              div()
                .p(4)
                .h(60)
                .rounded(6)
                .border_1()
                .border_color(t.accent || t.border)
                .bg(t.background)
                .child(Textarea.new(this.msgInput).size_full().text_size(12).text_color(t.foreground)),
            )
            .child(
              h_flex()
                .justify_end()
                .gap(6)
                .child(
                  h_flex()
                    .h(22)
                    .px(8)
                    .items_center()
                    .rounded(4)
                    .bg(t.raised)
                    .cursor_pointer()
                    .hover((s) => s.bg(t.hover))
                    .text_size(10.5)
                    .text_color(t.muted)
                    .on_click((_e, cx) => {
                      this.activeMessageAgent = null;
                      cx.notify();
                    })
                    .child("Batal"),
                )
                .child(
                  h_flex()
                    .h(22)
                    .px(10)
                    .gap(4)
                    .items_center()
                    .rounded(4)
                    .bg(t.accent || t.ansi4)
                    .cursor_pointer()
                    .hover((s) => s.opacity(0.85))
                    .text_size(10.5)
                    .font_medium()
                    .text_color(t.accent_foreground || "#ffffff")
                    .on_click((_e, cx) => this.handleSendMessage(agent.address, cx))
                    .child(svg(`${ICONS}/send.svg`).size(10))
                    .child("Kirim"),
                ),
            ),
        ),
      );
  }

  getCandidates(liveAgents, allTerms) {
    const candidates = [];
    const seen = new Set();

    for (const a of liveAgents) {
      candidates.push(a);
      seen.add(a.address);
    }

    for (const t of allTerms) {
      if (t.state === "live" && !seen.has(t.address)) {
        const isAgent = t.template || (t.agent && t.agent !== "zsh") || t.status || (t.where || "").includes("hc run") || (t.name || "").includes("hc run");
        if (this.sessionFilter === "all" || isAgent) {
          candidates.push({
            address: t.address,
            pane: t.pane || null,
            space: t.space || "",
            space_name: t.space_name || t.where || "local",
            tab: t.tab || "",
            tab_name: t.tab_name || t.name || "",
            status: t.status || (t.state === "live" ? "working" : "idle"),
            title: t.name || t.where || t.template || t.agent || t.address,
            program: t.program || { name: t.template || t.agent || "terminal" },
            app: t.agent || t.template || null,
            pinned: Boolean(t.pinned),
          });
          seen.add(t.address);
        }
      }
    }
    return candidates;
  }

  renderCockpit(candidates, allTerms, now, t) {
    const q = this.searchInput.value().toLowerCase().trim();

    // Filter by query and status
    const filtered = candidates.filter((a) => {
      if (this.filterStatus !== "all" && a.status !== this.filterStatus) return false;
      if (q) {
        const titleMatch = (a.title || "").toLowerCase().includes(q);
        const spaceMatch = (a.space_name || "").toLowerCase().includes(q);
        const addrMatch = a.address.toLowerCase().includes(q);
        if (!titleMatch && !spaceMatch && !addrMatch) return false;
      }
      return true;
    });

    const statusFilterChip = (id, label) => {
      const active = this.filterStatus === id;
      return div()
        .px(7)
        .h(22)
        .rounded(5)
        .cursor_pointer()
        .text_size(10.5)
        .flex()
        .items_center()
        .when(active, (el) => el.bg(t.accent || t.ansi4).text_color(t.accent_foreground || "#ffffff").font_medium())
        .when(!active, (el) => el.bg(t.raised).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)))
        .on_click((_e, cx) => {
          this.filterStatus = id;
          cx.notify();
        })
        .child(label);
    };

    const sessionChip = (id, label) => {
      const active = this.sessionFilter === id;
      return div()
        .px(7)
        .h(22)
        .rounded(5)
        .cursor_pointer()
        .text_size(10)
        .flex()
        .items_center()
        .when(active, (el) => el.bg(t.raised).text_color(t.foreground).font_medium())
        .when(!active, (el) => el.text_color(t.dim).hover((s) => s.text_color(t.foreground)))
        .on_click((_e, cx) => {
          this.sessionFilter = id;
          cx.notify();
        })
        .child(label);
    };

    return v_flex()
      .flex_1()
      .p(10)
      .gap(8)
      .overflow_y_scrollbar()
      // Filter & Search Bar
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .child(
            h_flex()
              .flex_1()
              .h(28)
              .px(7)
              .gap(6)
              .items_center()
              .rounded(6)
              .bg(t.background)
              .border_1()
              .border_color(t.border)
              .child(svg(`${ICONS}/search.svg`).size(12).text_color(t.dim))
              .child(Input.new(this.searchInput).flex_1().h_full().text_size(11.5).text_color(t.foreground)),
          )
          .child(
            h_flex()
              .h(28)
              .px(8)
              .gap(4)
              .items_center()
              .rounded(6)
              .bg(t.accent || t.ansi4)
              .cursor_pointer()
              .hover((s) => s.opacity(0.9))
              .text_color(t.accent_foreground || "#ffffff")
              .on_click((_e, cx) => {
                this.tab = "launch";
                cx.notify();
              })
              .child(svg(`${ICONS}/plus.svg`).size(11))
              .child(div().text_size(11).font_medium().child("New Mission")),
          ),
      )
      // Status & Session Type Filters
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .child(
            h_flex()
              .gap(4)
              .items_center()
              .child(statusFilterChip("all", "All"))
              .child(statusFilterChip("blocked", "Needs You"))
              .child(statusFilterChip("working", "Working"))
              .child(statusFilterChip("done", "Done"))
              .child(statusFilterChip("idle", "Idle")),
          )
          .child(
            h_flex()
              .gap(3)
              .items_center()
              .child(sessionChip("agents", "Agents"))
              .child(sessionChip("all", "All Live")),
          ),
      )
      // Agents List
      .when(filtered.length === 0, (el) =>
        el.child(
          v_flex()
            .py(40)
            .gap(10)
            .items_center()
            .justify_center()
            .child(svg(`${ICONS}/bot.svg`).size(36).text_color(t.dim))
            .child(
              div()
                .text_size(13)
                .font_medium()
                .text_color(t.muted)
                .child(q || this.filterStatus !== "all" ? "Tidak ada agent yang cocok dengan filter" : "Belum ada agent aktif yang berjalan"),
            )
            .child(
              div()
                .text_size(11)
                .text_color(t.dim)
                .text_center()
                .max_w(260)
                .child("Luncurkan tugas baru dengan memilih salah satu Persona template tangguh."),
            )
            .child(
              h_flex()
                .mt(4)
                .h(28)
                .px(12)
                .gap(5)
                .items_center()
                .rounded(6)
                .bg(t.accent || t.ansi4)
                .cursor_pointer()
                .hover((s) => s.opacity(0.9))
                .text_color(t.accent_foreground || "#ffffff")
                .text_size(11.5)
                .font_medium()
                .on_click((_e, cx) => {
                  this.tab = "launch";
                  cx.notify();
                })
                .child(svg(`${ICONS}/play.svg`).size(11))
                .child("Luncurkan Agent Baru"),
            ),
        ),
      )
      .children(
        filtered.map((agent) => {
          const subs = allTerms.filter((term) => term.parent === agent.address && term.state === "live");
          return this.renderAgentCard(agent, subs, now, t);
        }),
      );
  }

  // ── Launch Mission (Task Dispatcher) ─────────────────────────────────────────

  renderLaunchMission(t) {
    const allSpaces = spaces();
    const activeSpace = allSpaces.find((s) => s.id === this.selectedSpaceId) || allSpaces.find((s) => s.active) || allSpaces[0];
    const personas = this.getPersonas();

    const modeChip = (id, label, icon) => {
      const active = this.launchMode === id;
      return h_flex()
        .px(8)
        .h(26)
        .gap(5)
        .items_center()
        .rounded(6)
        .cursor_pointer()
        .when(active, (el) => el.bg(t.accent || t.ansi4).text_color(t.accent_foreground || "#ffffff").font_medium())
        .when(!active, (el) => el.bg(t.raised).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)))
        .on_click((_e, cx) => {
          this.launchMode = id;
          cx.notify();
        })
        .child(svg(`${ICONS}/${icon}`).size(11))
        .child(div().text_size(11).child(label));
    };

    return v_flex()
      .flex_1()
      .p(10)
      .gap(10)
      .overflow_y_scrollbar()
      // Step 1: Persona Selection
      .child(
        v_flex()
          .gap(6)
          .child(
            h_flex()
              .items_center()
              .justify_between()
              .child(div().text_size(11).font_bold().text_color(t.foreground).child("1. PILIH PERSONA AGENT"))
              .child(
                div()
                  .text_size(10.5)
                  .text_color(t.dim)
                  .cursor_pointer()
                  .hover((s) => s.text_color(t.foreground))
                  .on_click((_e, cx) => {
                    this.tab = "personas";
                    cx.notify();
                  })
                  .child("Kelola Persona »"),
              ),
          )
          .child(
            v_flex()
              .gap(6)
              .children(
                personas.map((meta) => {
                  const on = this.selectedPersona === meta.id;
                  return h_flex()
                    .p(7)
                    .gap(8)
                    .items_center()
                    .rounded(7)
                    .border_1()
                    .border_color(on ? (t.accent || meta.color) : t.border)
                    .bg(on ? t.raised : t.chrome)
                    .cursor_pointer()
                    .hover((s) => s.bg(t.hover))
                    .on_click((_e, cx) => {
                      this.selectedPersona = meta.id;
                      cx.notify();
                    })
                    .child(
                      div()
                        .size(24)
                        .rounded(5)
                        .bg(t.background)
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(svg(`${ICONS}/bot.svg`).size(13).text_color(meta.color)),
                    )
                    .child(
                      v_flex()
                        .flex_1()
                        .min_w(0)
                        .gap(1)
                        .child(
                          h_flex()
                            .gap(6)
                            .items_center()
                            .child(div().font_semibold().text_size(11.5).text_color(t.foreground).child(meta.name))
                            .child(
                              div()
                                .px(4.5)
                                .h(14)
                                .rounded(3)
                                .bg(meta.color + "26")
                                .text_color(meta.color)
                                .text_size(9)
                                .font_bold()
                                .child(meta.badge),
                            ),
                        )
                        .child(div().text_size(10.5).text_color(t.dim).truncate().child(meta.desc)),
                    )
                    .when(on, (el) =>
                      el.child(svg(`${ICONS}/check.svg`).size(14).text_color(t.accent || t.ansi4)),
                    );
                }),
              ),
          ),
      )
      // Step 2: Target Workspace & Mode
      .child(
        v_flex()
          .gap(6)
          .child(div().text_size(11).font_bold().text_color(t.foreground).child("2. WORKSPACE & MODE EKSEKUSI"))
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(modeChip("tab", "Tab Baru", "play.svg"))
              .child(modeChip("split", "Split Pane", "terminal.svg"))
              .child(modeChip("bg", "Background Worker", "refresh.svg")),
          )
          .when(allSpaces.length > 0, (el) =>
            el.child(
              h_flex()
                .px(8)
                .h(28)
                .gap(6)
                .items_center()
                .rounded(6)
                .bg(t.chrome)
                .border_1()
                .border_color(t.border)
                .child(div().text_size(10.5).text_color(t.dim).child("Workspace:"))
                .child(
                  div()
                    .flex_1()
                    .text_size(11)
                    .font_medium()
                    .text_color(t.foreground)
                    .truncate()
                    .child(activeSpace?.name || "Workspace Aktif"),
                ),
            ),
          ),
      )
      // Step 3: Mission Task Prompt
      .child(
        v_flex()
          .gap(6)
          .child(
            h_flex()
              .justify_between()
              .items_center()
              .child(div().text_size(11).font_bold().text_color(t.foreground).child("3. INSTRUKSI & PROMPT TUGAS"))
              .child(
                div()
                  .text_size(10.5)
                  .text_color(t.dim)
                  .cursor_pointer()
                  .hover((s) => s.text_color(t.foreground))
                  .on_click((_e, cx) => {
                    this.taskInput.set_value("");
                    cx.notify();
                  })
                  .child("Clear"),
              ),
          )
          .child(
            div()
              .p(6)
              .h(90)
              .rounded(7)
              .border_1()
              .border_color(t.accent || t.border)
              .bg(t.background)
              .child(Textarea.new(this.taskInput).size_full().text_size(12).text_color(t.foreground)),
          )
          // Suggestions Chips
          .child(
            v_flex()
              .gap(4)
              .child(div().text_size(10).text_color(t.dim).child("Template Cepat:"))
              .children(
                PROMPT_SUGGESTIONS.map((sug) =>
                  div()
                    .px(8)
                    .py(4)
                    .rounded(5)
                    .bg(t.chrome)
                    .border_1()
                    .border_color(t.border)
                    .cursor_pointer()
                    .hover((s) => s.bg(t.hover).border_color(t.accent || t.border))
                    .on_click((_e, cx) => {
                      this.taskInput.set_value(sug);
                      cx.notify();
                    })
                    .child(div().text_size(10.5).text_color(t.muted).truncate().child(`• ${sug}`)),
                ),
              ),
          ),
      )
      // Launch Button
      .child(
        h_flex()
          .mt(4)
          .h(34)
          .gap(7)
          .items_center()
          .justify_center()
          .rounded(7)
          .bg(t.accent || t.ansi4)
          .cursor_pointer()
          .hover((s) => s.opacity(0.9))
          .text_color(t.accent_foreground || "#ffffff")
          .font_semibold()
          .text_size(12)
          .on_click((_e, cx) => this.handleLaunch(cx))
          .child(svg(`${ICONS}/play.svg`).size(13))
          .child(`Dispatch Mission ke ${personas.find((p) => p.id === this.selectedPersona)?.name || "Agent"}`),
      );
  }

  // ── Personas Studio (Full CRUD: List, Add, Edit, Delete) ─────────────────────

  renderPersonaForm(t) {
    const isEdit = this.personaFormMode === "edit";

    return v_flex()
      .flex_1()
      .p(10)
      .gap(10)
      .overflow_y_scrollbar()
      // Form Top Bar
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(
                div()
                  .px(6)
                  .h(22)
                  .rounded(4)
                  .bg(t.raised)
                  .cursor_pointer()
                  .hover((s) => s.bg(t.hover).text_color(t.foreground))
                  .text_color(t.muted)
                  .text_size(10.5)
                  .flex()
                  .items_center()
                  .on_click((_e, cx) => {
                    this.closePersonaForm();
                    cx.notify();
                  })
                  .child("« Kembali"),
              )
              .child(
                div()
                  .font_bold()
                  .text_size(12.5)
                  .text_color(t.foreground)
                  .child(isEdit ? `Edit Persona: ${this.personaEditingId}` : "Tambah Persona Baru"),
              ),
          ),
      )
      // Form Fields Container
      .child(
        v_flex()
          .p(10)
          .gap(9)
          .rounded(8)
          .border_1()
          .border_color(t.border)
          .bg(t.chrome)
          // 1. Template ID (File Name)
          .child(
            v_flex()
              .gap(4)
              .child(
                h_flex()
                  .gap(4)
                  .items_center()
                  .child(div().text_size(10.5).font_semibold().text_color(t.foreground).child("ID File Template"))
                  .child(div().text_size(9.5).text_color(t.dim).child("(.md di ~/.config/herdr-core/templates/)")),
              )
              .child(
                h_flex()
                  .h(28)
                  .px(8)
                  .items_center()
                  .rounded(6)
                  .border_1()
                  .border_color(t.border)
                  .bg(isEdit ? t.raised : t.background)
                  .child(Input.new(this.formIdInput).flex_1().h_full().text_size(11.5).text_color(t.foreground)),
              ),
          )
          // 2. Display Name
          .child(
            v_flex()
              .gap(4)
              .child(div().text_size(10.5).font_semibold().text_color(t.foreground).child("Nama Tampilan Agent"))
              .child(
                h_flex()
                  .h(28)
                  .px(8)
                  .items_center()
                  .rounded(6)
                  .border_1()
                  .border_color(t.border)
                  .bg(t.background)
                  .child(Input.new(this.formNameInput).flex_1().h_full().text_size(11.5).text_color(t.foreground)),
              ),
          )
          // 3. CLI Command
          .child(
            v_flex()
              .gap(4)
              .child(
                h_flex()
                  .justify_between()
                  .items_center()
                  .child(div().text_size(10.5).font_semibold().text_color(t.foreground).child("CLI Command yang Dijalankan"))
                  .child(
                    h_flex()
                      .gap(3)
                      .items_center()
                      .children(
                        QUICK_COMMANDS.map((qc) =>
                          div()
                            .px(4.5)
                            .h(16)
                            .rounded(3)
                            .bg(t.raised)
                            .cursor_pointer()
                            .text_size(9)
                            .text_color(t.dim)
                            .hover((s) => s.bg(t.hover).text_color(t.foreground))
                            .on_click((_e, cx) => {
                              this.formCmdInput.set_value(qc);
                              cx.notify();
                            })
                            .child(qc),
                        ),
                      ),
                  ),
              )
              .child(
                h_flex()
                  .h(28)
                  .px(8)
                  .items_center()
                  .rounded(6)
                  .border_1()
                  .border_color(t.border)
                  .bg(t.background)
                  .child(Input.new(this.formCmdInput).flex_1().h_full().text_size(11.5).text_color(t.foreground)),
              ),
          )
          // 4. Description
          .child(
            v_flex()
              .gap(4)
              .child(div().text_size(10.5).font_semibold().text_color(t.foreground).child("Deskripsi Singkat Keahlian"))
              .child(
                h_flex()
                  .h(28)
                  .px(8)
                  .items_center()
                  .rounded(6)
                  .border_1()
                  .border_color(t.border)
                  .bg(t.background)
                  .child(Input.new(this.formDescInput).flex_1().h_full().text_size(11.5).text_color(t.foreground)),
              ),
          )
          // 5. System Directives & Instructions Prompt
          .child(
            v_flex()
              .gap(4)
              .child(div().text_size(10.5).font_semibold().text_color(t.foreground).child("System Directives / Prompt Instruksi"))
              .child(
                div()
                  .p(6)
                  .h(140)
                  .rounded(6)
                  .border_1()
                  .border_color(t.border)
                  .bg(t.background)
                  .child(Textarea.new(this.formPromptInput).size_full().text_size(11.5).text_color(t.foreground)),
              ),
          )
          // Form Actions
          .child(
            h_flex()
              .mt(4)
              .gap(6)
              .justify_end()
              .child(
                h_flex()
                  .h(28)
                  .px(10)
                  .items_center()
                  .rounded(6)
                  .bg(t.raised)
                  .cursor_pointer()
                  .hover((s) => s.bg(t.hover))
                  .text_color(t.muted)
                  .text_size(11)
                  .on_click((_e, cx) => {
                    this.closePersonaForm();
                    cx.notify();
                  })
                  .child("Batal"),
              )
              .child(
                h_flex()
                  .h(28)
                  .px(14)
                  .gap(5)
                  .items_center()
                  .rounded(6)
                  .bg(t.accent || t.ansi4)
                  .cursor_pointer()
                  .hover((s) => s.opacity(0.9))
                  .text_color(t.accent_foreground || "#ffffff")
                  .text_size(11)
                  .font_semibold()
                  .on_click((_e, cx) => this.savePersona(cx))
                  .child(svg(`${ICONS}/check.svg`).size(11))
                  .child(isEdit ? "Perbarui Persona" : "Simpan Persona Baru"),
              ),
          ),
      );
  }

  renderPersonasStudio(t) {
    if (this.isPersonaFormOpen) {
      return this.renderPersonaForm(t);
    }

    const personas = this.getPersonas();

    return v_flex()
      .flex_1()
      .p(10)
      .gap(10)
      .overflow_y_scrollbar()
      // Top Title & Add Button Bar
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .child(
            v_flex()
              .gap(2)
              .child(
                h_flex()
                  .gap(6)
                  .items_center()
                  .child(div().font_bold().text_size(12.5).text_color(t.foreground).child("Persona Templates Studio"))
                  .child(
                    div()
                      .px(5)
                      .h(15)
                      .rounded(3)
                      .bg(t.raised)
                      .text_size(9.5)
                      .text_color(t.dim)
                      .child(`${personas.length} Templates`),
                  ),
              )
              .child(
                div()
                  .text_size(10)
                  .text_color(t.dim)
                  .child("Kelola, tambah, edit, atau hapus system prompt persona agent."),
              ),
          )
          .child(
            h_flex()
              .h(26)
              .px(8)
              .gap(4)
              .items_center()
              .rounded(6)
              .bg(t.accent || t.ansi4)
              .cursor_pointer()
              .hover((s) => s.opacity(0.9))
              .text_color(t.accent_foreground || "#ffffff")
              .on_click((_e, cx) => {
                this.openCreatePersonaForm();
                cx.notify();
              })
              .child(svg(`${ICONS}/plus.svg`).size(11))
              .child(div().text_size(11).font_medium().child("Tambah")),
          ),
      )
      // Persona Cards List
      .children(
        personas.map((meta) => {
          const rawTpl = this.templatesList.find((x) => x.name.toLowerCase() === meta.id) || meta;
          const isExpanded = this.expandedDirectives.has(meta.id);
          const isConfirmDelete = this.personaConfirmDeleteId === meta.id;

          return v_flex()
            .id(`persona-card-${meta.id}`)
            .p(8)
            .gap(6)
            .rounded(8)
            .border_1()
            .border_color(isConfirmDelete ? (t.blocked || "#e06c75") : t.border)
            .bg(t.chrome)
            // Header Row
            .child(
              h_flex()
                .gap(7)
                .items_center()
                .child(
                  div()
                    .size(26)
                    .rounded(6)
                    .bg(t.background)
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(svg(`${ICONS}/bot.svg`).size(15).text_color(meta.color)),
                )
                .child(
                  v_flex()
                    .flex_1()
                    .min_w(0)
                    .gap(1)
                    .child(
                      h_flex()
                        .gap(6)
                        .items_center()
                        .child(div().font_bold().text_size(12).text_color(t.foreground).child(meta.name))
                        .child(
                          div()
                            .px(5)
                            .h(15)
                            .rounded(3)
                            .bg(meta.color + "26")
                            .text_color(meta.color)
                            .text_size(9)
                            .font_bold()
                            .child(meta.badge),
                        ),
                    )
                    .child(
                      h_flex()
                        .gap(4)
                        .items_center()
                        .child(div().text_size(10).text_color(t.dim).child(`CLI: ${meta.cmd}`))
                        .child(div().text_size(10).text_color(t.dim).child(`· id: ${meta.id}`)),
                    ),
                )
                // Actions (Pakai, Edit, Hapus)
                .child(
                  h_flex()
                    .gap(3)
                    .items_center()
                    // Pakai / Launch
                    .child(
                      h_flex()
                        .h(22)
                        .px(7)
                        .gap(3)
                        .items_center()
                        .rounded(4)
                        .bg(t.raised)
                        .cursor_pointer()
                        .hover((s) => s.bg(t.hover).text_color(t.foreground))
                        .text_color(t.muted)
                        .text_size(10.5)
                        .tooltip("Pilih persona ini di New Mission")
                        .on_click((_e, cx) => {
                          this.selectedPersona = meta.id;
                          this.tab = "launch";
                          cx.notify();
                        })
                        .child(svg(`${ICONS}/play.svg`).size(9.5))
                        .child("Pakai"),
                    )
                    // Edit
                    .child(
                      h_flex()
                        .size(22)
                        .items_center()
                        .justify_center()
                        .rounded(4)
                        .bg(t.raised)
                        .cursor_pointer()
                        .hover((s) => s.bg(t.hover).text_color(t.foreground))
                        .text_color(t.dim)
                        .tooltip("Edit direktif dan pengaturan persona")
                        .on_click((_e, cx) => {
                          this.openEditPersonaForm(rawTpl);
                          cx.notify();
                        })
                        .child(svg(`${ICONS}/pencil.svg`).size(10.5)),
                    )
                    // Hapus
                    .child(
                      h_flex()
                        .size(22)
                        .items_center()
                        .justify_center()
                        .rounded(4)
                        .bg(t.raised)
                        .cursor_pointer()
                        .hover((s) => s.bg(t.hover).text_color(t.blocked || "#e06c75"))
                        .text_color(t.dim)
                        .tooltip("Hapus template persona ini")
                        .on_click((_e, cx) => {
                          this.personaConfirmDeleteId = isConfirmDelete ? null : meta.id;
                          cx.notify();
                        })
                        .child(svg(`${ICONS}/trash.svg`).size(10.5)),
                    ),
                ),
            )
            // Description
            .child(div().text_size(11).text_color(t.muted).child(meta.desc || "Tidak ada deskripsi."))
            // Directives Toggle
            .child(
              h_flex()
                .gap(4)
                .items_center()
                .cursor_pointer()
                .on_click((_e, cx) => {
                  if (isExpanded) this.expandedDirectives.delete(meta.id);
                  else this.expandedDirectives.add(meta.id);
                  cx.notify();
                })
                .child(
                  svg(`${ICONS}/${isExpanded ? "chevron-down" : "chevron-right"}.svg`)
                    .size(10)
                    .text_color(t.dim),
                )
                .child(
                  div()
                    .text_size(10)
                    .font_medium()
                    .text_color(t.dim)
                    .hover((s) => s.text_color(t.foreground))
                    .child(isExpanded ? "Tutup System Directives" : "Lihat System Directives"),
                ),
            )
            // Expanded Directives Preview
            .when(isExpanded, (el) =>
              el.child(
                div()
                  .p(8)
                  .rounded(6)
                  .bg(t.background)
                  .border_1()
                  .border_color(t.border)
                  .text_size(10.5)
                  .text_color(t.dim)
                  .child(meta.prompt || "Belum ada instruksi prompt tersimpan."),
              ),
            )
            // Confirm Delete Banner
            .when(isConfirmDelete, (el) =>
              el.child(
                h_flex()
                  .p(6)
                  .gap(6)
                  .items_center()
                  .justify_between()
                  .rounded(5)
                  .bg((t.blocked || "#e06c75") + "15")
                  .border_1()
                  .border_color((t.blocked || "#e06c75") + "40")
                  .child(
                    div()
                      .text_size(10.5)
                      .font_medium()
                      .text_color(t.blocked || "#e06c75")
                      .child(`Yakin hapus template "${meta.name}"?`),
                  )
                  .child(
                    h_flex()
                      .gap(4)
                      .child(
                        h_flex()
                          .h(20)
                          .px(6)
                          .items_center()
                          .rounded(4)
                          .bg(t.raised)
                          .cursor_pointer()
                          .hover((s) => s.bg(t.hover))
                          .text_size(10)
                          .text_color(t.muted)
                          .on_click((_e, cx) => {
                            this.personaConfirmDeleteId = null;
                            cx.notify();
                          })
                          .child("Batal"),
                      )
                      .child(
                        h_flex()
                          .h(20)
                          .px(8)
                          .items_center()
                          .rounded(4)
                          .bg(t.blocked || "#e06c75")
                          .cursor_pointer()
                          .hover((s) => s.opacity(0.85))
                          .text_size(10)
                          .font_semibold()
                          .text_color("#ffffff")
                          .on_click((_e, cx) => this.deletePersona(meta.id, cx))
                          .child("Hapus"),
                      ),
                  ),
              ),
            );
        }),
      );
  }

  // ── History View (Finished Runs) ─────────────────────────────────────────────

  renderHistory(t) {
    return v_flex()
      .flex_1()
      .p(10)
      .gap(8)
      .overflow_y_scrollbar()
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .child(
            v_flex()
              .gap(1)
              .child(div().font_bold().text_size(12).text_color(t.foreground).child("Riwayat Terminal Selesai"))
              .child(div().text_size(10.5).text_color(t.dim).child(`${this.historyList.length} terminal finished`)),
          )
          .when(this.historyList.length > 0, (el) =>
            el.child(
              h_flex()
                .h(24)
                .px(8)
                .gap(4)
                .items_center()
                .rounded(5)
                .bg(t.raised)
                .cursor_pointer()
                .hover((s) => s.bg(t.hover).text_color(t.blocked || "#e06c75"))
                .text_color(t.dim)
                .text_size(10.5)
                .on_click((_e, cx) => this.handleClearAllHistory(cx))
                .child(svg(`${ICONS}/trash.svg`).size(11))
                .child("Clear All"),
            ),
          ),
      )
      .when(this.historyList.length === 0, (el) =>
        el.child(
          v_flex()
            .py(40)
            .items_center()
            .justify_center()
            .gap(8)
            .child(svg(`${ICONS}/terminal.svg`).size(32).text_color(t.dim))
            .child(div().text_size(12).text_color(t.dim).child("Tidak ada riwayat terminal yang tersimpan")),
        ),
      )
      .children(
        this.historyList.map((hist) => {
          const isOk = hist.exit_code === 0;
          return h_flex()
            .p(7)
            .gap(7)
            .items_center()
            .rounded(6)
            .border_1()
            .border_color(t.border)
            .bg(t.chrome)
            .child(
              div()
                .px(5)
                .h(18)
                .rounded(4)
                .bg(isOk ? (t.done || "#98c379") + "26" : (t.blocked || "#e06c75") + "26")
                .text_color(isOk ? (t.done || "#98c379") : (t.blocked || "#e06c75"))
                .text_size(9.5)
                .font_bold()
                .child(hist.address),
            )
            .child(
              v_flex()
                .flex_1()
                .min_w(0)
                .gap(1)
                .child(div().font_medium().text_size(11).text_color(t.foreground).truncate().child(hist.where || hist.name || hist.agent))
                .child(div().text_size(9.5).text_color(t.dim).truncate().child(`${hist.cwd || ""} · ${hist.turn || 0} turns`)),
            )
            .child(
              div()
                .size(20)
                .rounded(4)
                .cursor_pointer()
                .flex()
                .items_center()
                .justify_center()
                .text_color(t.dim)
                .hover((s) => s.bg(t.hover).text_color(t.blocked || "#e06c75"))
                .tooltip("Hapus terminal ini dari riwayat")
                .on_click((_e, cx) => this.handleRemoveHistory(hist.address, cx))
                .child(svg(`${ICONS}/trash.svg`).size(11)),
            );
        }),
      );
  }

  // ── Main Render ──────────────────────────────────────────────────────────────

  render(_cx) {
    const t = theme();
    const now = Date.now();
    const liveAgents = typeof agents === "function" ? agents() : [];
    const allTerms = typeof terminals === "function" ? terminals() : [];
    const candidates = this.getCandidates(liveAgents, allTerms);

    this.trackChanges(candidates, now);

    // Calculate live stats
    const stats = {
      total: candidates.length,
      blocked: candidates.filter((a) => a.status === "blocked").length,
      working: candidates.filter((a) => a.status === "working").length,
      done: candidates.filter((a) => a.status === "done").length,
      idle: candidates.filter((a) => a.status === "idle").length,
    };

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.background)
      .child(this.renderHeader(stats, t))
      .when(this.tab === "cockpit", (el) => el.child(this.renderCockpit(candidates, allTerms, now, t)))
      .when(this.tab === "launch", (el) => el.child(this.renderLaunchMission(t)))
      .when(this.tab === "personas", (el) => el.child(this.renderPersonasStudio(t)))
      .when(this.tab === "history", (el) => el.child(this.renderHistory(t)));
  }
}
