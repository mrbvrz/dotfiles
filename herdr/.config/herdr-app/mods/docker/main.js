// Docker Management mod for Herdr.
// Built custom from scratch for Herdr GPUI.
// Features: Container lifecycle (start, stop, pause, unpause, restart, delete),
// grouping by Docker Network (e.g. dpmptsp-pekanbaru) or Compose Project,
// bulk group actions, live logs viewer drawer, terminal shell exec,
// image & volume management, and port click-to-open.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, InputState } from "gpui-base";
import { spaces, panes, focused, exec, theme, notify, run } from "herdr";

const ICONS = "mods/docker/icons";

async function dockerCmd(args, options = {}) {
  try {
    const res = await exec("docker", args, options);
    return res;
  } catch (err) {
    try {
      const res = await exec("/opt/homebrew/bin/docker", args, options);
      return res;
    } catch {
      try {
        const res = await exec("/usr/local/bin/docker", args, options);
        return res;
      } catch {
        throw err;
      }
    }
  }
}

function parsePorts(portStr) {
  if (!portStr) return [];
  const entries = portStr.split(",").map((s) => s.trim()).filter(Boolean);
  const result = [];
  for (const entry of entries) {
    const m = entry.match(/(?:0\.0\.0\.0|\[::\]|127\.0\.0\.1):(\d+)->(\d+)(?:\/(\w+))?/);
    if (m) {
      const hostPort = m[1];
      const contPort = m[2];
      const proto = m[3] || "tcp";
      if (!result.some((r) => r.host === hostPort && r.container === contPort)) {
        result.push({ host: hostPort, container: contPort, proto, raw: `${hostPort}->${contPort}` });
      }
    } else {
      const bare = entry.match(/(\d+)\/(\w+)/);
      if (bare && !result.some((r) => r.container === bare[1])) {
        result.push({ host: null, container: bare[1], proto: bare[2], raw: entry });
      }
    }
  }
  return result;
}

// Determines the primary network for a container.
// Custom named networks (like dpmptsp-pekanbaru) take precedence over *_default or bridge.
function getPrimaryNetwork(networks) {
  if (!networks || networks.length === 0) return "bridge";
  const custom = networks.find(
    (n) => n !== "bridge" && !n.endsWith("_default") && n !== "host" && n !== "none",
  );
  if (custom) return custom;
  return networks[0];
}

export default class DockerMod extends View {
  init(_props, cx) {
    this.cx = cx;
    this.tab = "containers"; // "containers" | "images" | "volumes"
    this.statusFilter = "all"; // "all" | "running" | "paused" | "stopped"

    let savedGroupBy = "network";
    try {
      savedGroupBy = localStorage.getItem("docker.groupBy") || "network";
    } catch {}
    this.groupBy = ["network", "project", "none"].includes(savedGroupBy) ? savedGroupBy : "network";

    this.groupFolded = new Set();
    try {
      this.groupFolded = new Set(JSON.parse(localStorage.getItem("docker.groupFolded") || "[]"));
    } catch {}

    this.search = InputState.new({ placeholder: "Search containers, networks, images..." });
    this.search.on("change", () => cx.notify());

    this.containers = [];
    this.images = [];
    this.volumes = [];
    this.loading = false;
    this.dockerAvailable = true;
    this.dockerError = null;

    this.actionInProgress = null; // Container/Image ID currently undergoing an action
    this.confirmDelete = null; // Item ID awaiting 2-step confirmation to delete
    this.confirmTimeout = null;

    this.activeLogs = null; // Container object for logs viewer drawer
    this.logsText = "";
    this.logsLoading = false;
    this.spaceOnly = false;

    this.refresh(cx);

    // Auto-refresh every 5 seconds to keep container states updated
    cx.timer.every(5000, () => {
      if (!this.actionInProgress && !this.logsLoading) {
        this.refreshQuiet(cx);
      }
    });
  }

  setConfirm(id, cx) {
    if (this.confirmTimeout) clearTimeout(this.confirmTimeout);
    this.confirmDelete = id;
    this.confirmTimeout = setTimeout(() => {
      this.confirmDelete = null;
      if (this.cx) this.cx.notify();
    }, 4000);
    cx.notify();
  }

  clearConfirm(cx) {
    if (this.confirmTimeout) clearTimeout(this.confirmTimeout);
    this.confirmDelete = null;
    if (cx) cx.notify();
  }

  async refresh(cx) {
    this.loading = true;
    cx.notify();
    await this.refreshQuiet(cx);
    this.loading = false;
    cx.notify();
  }

  async refreshQuiet(cx) {
    try {
      const psRes = await dockerCmd(["ps", "-a", "--format", "{{json .}}"]);
      if (psRes.code === 0) {
        this.dockerAvailable = true;
        this.dockerError = null;
        const lines = psRes.stdout.trim().split("\n").filter(Boolean);
        this.containers = lines
          .map((line) => {
            try {
              const raw = JSON.parse(line);
              const name = (raw.Names || "").replace(/^\//, "");
              let composeProject = null;
              if (raw.Labels) {
                const m = raw.Labels.match(/com\.docker\.compose\.project=([^,]+)/);
                if (m && m[1]) composeProject = m[1];
              }
              const networks = (raw.Networks || "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              return {
                id: raw.ID,
                name,
                image: raw.Image || "",
                state: (raw.State || "").toLowerCase(),
                status: raw.Status || "",
                created: raw.CreatedAt || raw.RunningFor || "",
                ports: parsePorts(raw.Ports),
                portsRaw: raw.Ports || "",
                composeProject,
                networks,
                primaryNetwork: getPrimaryNetwork(networks),
                size: raw.Size || "",
              };
            } catch {
              return null;
            }
          })
          .filter(Boolean);
      } else {
        this.dockerAvailable = false;
        this.dockerError = psRes.stderr || "Docker daemon not responding";
      }

      if (this.tab === "images" || this.images.length === 0) {
        const imgRes = await dockerCmd(["images", "--format", "{{json .}}"]);
        if (imgRes.code === 0) {
          const lines = imgRes.stdout.trim().split("\n").filter(Boolean);
          this.images = lines
            .map((line) => {
              try {
                const r = JSON.parse(line);
                return {
                  id: r.ID,
                  repository: r.Repository,
                  tag: r.Tag,
                  size: r.Size,
                  created: r.CreatedSince || r.CreatedAt,
                };
              } catch {
                return null;
              }
            })
            .filter(Boolean);
        }
      }

      if (this.tab === "volumes" || this.volumes.length === 0) {
        const volRes = await dockerCmd(["volume", "ls", "--format", "{{json .}}"]);
        if (volRes.code === 0) {
          const lines = volRes.stdout.trim().split("\n").filter(Boolean);
          this.volumes = lines
            .map((line) => {
              try {
                const r = JSON.parse(line);
                return {
                  name: r.Name,
                  driver: r.Driver,
                  scope: r.Scope,
                };
              } catch {
                return null;
              }
            })
            .filter(Boolean);
        }
      }
    } catch (e) {
      this.dockerAvailable = false;
      this.dockerError = String(e?.message ?? e);
    }
    cx.notify();
  }

  // ── Single Container Actions ─────────────────────────────────────────────────

  async startContainer(c, cx) {
    this.actionInProgress = c.id;
    cx.notify();
    notify({ title: `Starting ${c.name}…`, level: "info", timeout: 2000 });
    try {
      const res = await dockerCmd(["start", c.id]);
      if (res.code === 0) {
        notify({ title: "Container Started", body: c.name, level: "success", timeout: 2500 });
      } else {
        notify({ title: "Start Failed", body: res.stderr || res.stdout, level: "error", timeout: 4000 });
      }
    } catch (e) {
      notify({ title: "Start Failed", body: String(e?.message ?? e), level: "error", timeout: 4000 });
    }
    this.actionInProgress = null;
    await this.refreshQuiet(cx);
  }

  async stopContainer(c, cx) {
    this.actionInProgress = c.id;
    cx.notify();
    notify({ title: `Stopping ${c.name}…`, level: "info", timeout: 2000 });
    try {
      const res = await dockerCmd(["stop", "-t", "5", c.id]);
      if (res.code === 0) {
        notify({ title: "Container Stopped", body: c.name, level: "success", timeout: 2500 });
      } else {
        notify({ title: "Stop Failed", body: res.stderr || res.stdout, level: "error", timeout: 4000 });
      }
    } catch (e) {
      notify({ title: "Stop Failed", body: String(e?.message ?? e), level: "error", timeout: 4000 });
    }
    this.actionInProgress = null;
    await this.refreshQuiet(cx);
  }

  async pauseContainer(c, cx) {
    this.actionInProgress = c.id;
    cx.notify();
    notify({ title: `Pausing ${c.name}…`, level: "info", timeout: 2000 });
    try {
      const res = await dockerCmd(["pause", c.id]);
      if (res.code === 0) {
        notify({ title: "Container Paused", body: c.name, level: "success", timeout: 2500 });
      } else {
        notify({ title: "Pause Failed", body: res.stderr || res.stdout, level: "error", timeout: 4000 });
      }
    } catch (e) {
      notify({ title: "Pause Failed", body: String(e?.message ?? e), level: "error", timeout: 4000 });
    }
    this.actionInProgress = null;
    await this.refreshQuiet(cx);
  }

  async unpauseContainer(c, cx) {
    this.actionInProgress = c.id;
    cx.notify();
    notify({ title: `Resuming ${c.name}…`, level: "info", timeout: 2000 });
    try {
      const res = await dockerCmd(["unpause", c.id]);
      if (res.code === 0) {
        notify({ title: "Container Resumed", body: c.name, level: "success", timeout: 2500 });
      } else {
        notify({ title: "Resume Failed", body: res.stderr || res.stdout, level: "error", timeout: 4000 });
      }
    } catch (e) {
      notify({ title: "Resume Failed", body: String(e?.message ?? e), level: "error", timeout: 4000 });
    }
    this.actionInProgress = null;
    await this.refreshQuiet(cx);
  }

  async restartContainer(c, cx) {
    this.actionInProgress = c.id;
    cx.notify();
    notify({ title: `Restarting ${c.name}…`, level: "info", timeout: 2000 });
    try {
      const res = await dockerCmd(["restart", "-t", "5", c.id]);
      if (res.code === 0) {
        notify({ title: "Container Restarted", body: c.name, level: "success", timeout: 2500 });
      } else {
        notify({ title: "Restart Failed", body: res.stderr || res.stdout, level: "error", timeout: 4000 });
      }
    } catch (e) {
      notify({ title: "Restart Failed", body: String(e?.message ?? e), level: "error", timeout: 4000 });
    }
    this.actionInProgress = null;
    await this.refreshQuiet(cx);
  }

  async deleteContainer(c, cx) {
    if (this.confirmDelete !== c.id) {
      this.setConfirm(c.id, cx);
      return;
    }
    this.clearConfirm(cx);
    this.actionInProgress = c.id;
    cx.notify();
    notify({ title: `Removing ${c.name}…`, level: "info", timeout: 2000 });
    try {
      const res = await dockerCmd(["rm", "-f", c.id]);
      if (res.code === 0) {
        notify({ title: "Container Removed", body: c.name, level: "success", timeout: 2500 });
      } else {
        notify({ title: "Delete Failed", body: res.stderr || res.stdout, level: "error", timeout: 4000 });
      }
    } catch (e) {
      notify({ title: "Delete Failed", body: String(e?.message ?? e), level: "error", timeout: 4000 });
    }
    this.actionInProgress = null;
    await this.refreshQuiet(cx);
  }

  async openTerminal(c, cx) {
    try {
      run("tab.new", {
        name: `docker: ${c.name}`,
        argv: ["docker", "exec", "-it", c.id, "sh"],
      });
      notify({ title: "Terminal Opened", body: `docker exec -it ${c.name} sh`, level: "info", timeout: 2000 });
    } catch (e) {
      notify({ title: "Terminal Failed", body: String(e?.message ?? e), level: "error", timeout: 4000 });
    }
    cx.notify();
  }

  async viewLogs(c, cx) {
    this.activeLogs = c;
    this.logsLoading = true;
    this.logsText = "Fetching logs…";
    cx.notify();
    try {
      const res = await dockerCmd(["logs", "--tail", "250", "--timestamps", c.id]);
      this.logsText = (res.stdout || res.stderr || "No logs output recorded.").trim();
    } catch (e) {
      this.logsText = `Error fetching logs: ${String(e?.message ?? e)}`;
    }
    this.logsLoading = false;
    cx.notify();
  }

  // ── Group Bulk Actions ───────────────────────────────────────────────────────

  async startGroup(containers, cx) {
    const targets = containers.filter((c) => c.state !== "running");
    if (!targets.length) return;
    notify({ title: `Starting ${targets.length} container(s)…`, level: "info", timeout: 2000 });
    for (const c of targets) {
      try {
        await dockerCmd(["start", c.id]);
      } catch {}
    }
    notify({ title: "Group Started", body: `Started ${targets.length} container(s)`, level: "success", timeout: 2500 });
    await this.refreshQuiet(cx);
  }

  async stopGroup(containers, cx) {
    const targets = containers.filter((c) => c.state === "running" || c.state === "paused");
    if (!targets.length) return;
    notify({ title: `Stopping ${targets.length} container(s)…`, level: "info", timeout: 2000 });
    for (const c of targets) {
      try {
        await dockerCmd(["stop", "-t", "5", c.id]);
      } catch {}
    }
    notify({ title: "Group Stopped", body: `Stopped ${targets.length} container(s)`, level: "success", timeout: 2500 });
    await this.refreshQuiet(cx);
  }

  async restartGroup(containers, cx) {
    notify({ title: `Restarting ${containers.length} container(s)…`, level: "info", timeout: 2000 });
    for (const c of containers) {
      try {
        await dockerCmd(["restart", "-t", "5", c.id]);
      } catch {}
    }
    notify({ title: "Group Restarted", body: `Restarted ${containers.length} container(s)`, level: "success", timeout: 2500 });
    await this.refreshQuiet(cx);
  }

  // ── Images & Volumes Actions ─────────────────────────────────────────────────

  async deleteImage(img, cx) {
    if (this.confirmDelete !== img.id) {
      this.setConfirm(img.id, cx);
      return;
    }
    this.clearConfirm(cx);
    this.actionInProgress = img.id;
    cx.notify();
    try {
      const res = await dockerCmd(["rmi", "-f", img.id]);
      if (res.code === 0) {
        notify({ title: "Image Removed", body: `${img.repository}:${img.tag}`, level: "success", timeout: 2500 });
      } else {
        notify({ title: "Remove Failed", body: res.stderr || res.stdout, level: "error", timeout: 4000 });
      }
    } catch (e) {
      notify({ title: "Remove Failed", body: String(e?.message ?? e), level: "error", timeout: 4000 });
    }
    this.actionInProgress = null;
    await this.refreshQuiet(cx);
  }

  async deleteVolume(vol, cx) {
    if (this.confirmDelete !== vol.name) {
      this.setConfirm(vol.name, cx);
      return;
    }
    this.clearConfirm(cx);
    this.actionInProgress = vol.name;
    cx.notify();
    try {
      const res = await dockerCmd(["volume", "rm", "-f", vol.name]);
      if (res.code === 0) {
        notify({ title: "Volume Removed", body: vol.name, level: "success", timeout: 2500 });
      } else {
        notify({ title: "Remove Failed", body: res.stderr || res.stdout, level: "error", timeout: 4000 });
      }
    } catch (e) {
      notify({ title: "Remove Failed", body: String(e?.message ?? e), level: "error", timeout: 4000 });
    }
    this.actionInProgress = null;
    await this.refreshQuiet(cx);
  }

  async pruneStopped(cx) {
    if (this.confirmDelete !== "prune-stopped") {
      this.setConfirm("prune-stopped", cx);
      return;
    }
    this.clearConfirm(cx);
    notify({ title: "Pruning Stopped Containers…", level: "info", timeout: 2000 });
    try {
      const res = await dockerCmd(["container", "prune", "-f"]);
      if (res.code === 0) {
        notify({
          title: "Prune Completed",
          body: res.stdout.trim() || "Cleaned up stopped containers",
          level: "success",
          timeout: 3000,
        });
      } else {
        notify({ title: "Prune Failed", body: res.stderr, level: "error", timeout: 4000 });
      }
    } catch (e) {
      notify({ title: "Prune Failed", body: String(e?.message ?? e), level: "error", timeout: 4000 });
    }
    await this.refreshQuiet(cx);
  }

  // ── Render Components ────────────────────────────────────────────────────────

  renderHeader(t, cx) {
    const running = this.containers.filter((c) => c.state === "running").length;
    const paused = this.containers.filter((c) => c.state === "paused").length;
    const stopped = this.containers.filter((c) => c.state === "exited" || c.state === "created").length;
    const isPruning = this.confirmDelete === "prune-stopped";

    return h_flex()
      .h(38)
      .flex_none()
      .px(12)
      .gap(8)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .bg(t.chrome)
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .child(svg(`${ICONS}/docker.svg`).size(16).text_color(t.accent || t.ansi4))
          .child(div().font_bold().text_size(13).text_color(t.foreground).child("Docker")),
      )
      .child(div().flex_1())
      .child(
        h_flex()
          .gap(5)
          .items_center()
          .when(running > 0, (el) =>
            el.child(
              h_flex()
                .gap(4)
                .px(6)
                .h(20)
                .rounded(4)
                .items_center()
                .bg(t.ansi2 + "22")
                .child(div().size(6).rounded(3).bg(t.ansi2))
                .child(div().text_size(10.5).font_medium().text_color(t.ansi2).child(`${running}`)),
            ),
          )
          .when(paused > 0, (el) =>
            el.child(
              h_flex()
                .gap(4)
                .px(6)
                .h(20)
                .rounded(4)
                .items_center()
                .bg(t.ansi3 + "22")
                .child(div().size(6).rounded(3).bg(t.ansi3))
                .child(div().text_size(10.5).font_medium().text_color(t.ansi3).child(`${paused}`)),
            ),
          )
          .when(stopped > 0, (el) =>
            el.child(
              h_flex()
                .gap(4)
                .px(6)
                .h(20)
                .rounded(4)
                .items_center()
                .bg(t.dim + "22")
                .child(div().size(6).rounded(3).bg(t.dim))
                .child(div().text_size(10.5).font_medium().text_color(t.dim).child(`${stopped}`)),
            ),
          ),
      )
      .child(
        h_flex()
          .gap(4)
          .items_center()
          .child(
            div()
              .size(24)
              .flex_none()
              .flex()
              .items_center()
              .justify_center()
              .rounded(5)
              .cursor_pointer()
              .tooltip(isPruning ? "Confirm: Prune Stopped?" : "Prune Stopped Containers")
              .when(isPruning, (el) => el.bg(t.ansi1 + "33"))
              .hover((s) => s.bg(isPruning ? t.ansi1 + "55" : t.hover))
              .on_click((_e, cx) => this.pruneStopped(cx))
              .child(svg(`${ICONS}/trash.svg`).size(13).text_color(isPruning ? t.ansi1 : t.dim)),
          )
          .child(
            div()
              .size(24)
              .flex_none()
              .flex()
              .items_center()
              .justify_center()
              .rounded(5)
              .cursor_pointer()
              .tooltip("Refresh")
              .hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => this.refresh(cx))
              .child(
                svg(`${ICONS}/refresh.svg`)
                  .size(13)
                  .text_color(t.dim)
                  .when(this.loading, (el) => el.spin(900)),
              ),
          ),
      );
  }

  renderTabs(t, cx) {
    const tabItem = (id, label, count) => {
      const active = this.tab === id;
      return h_flex()
        .id(`docker-tab-${id}`)
        .h(30)
        .px(12)
        .gap(6)
        .items_center()
        .cursor_pointer()
        .border_b(active ? 2 : 0)
        .border_color(t.accent || t.ansi4)
        .text_color(active ? t.foreground : t.muted)
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          this.tab = id;
          this.refresh(cx);
        })
        .child(div().text_size(12).font_medium().child(label))
        .child(
          div()
            .px(5)
            .h(16)
            .rounded(8)
            .flex()
            .items_center()
            .text_size(10)
            .bg(active ? t.raised : t.chrome)
            .text_color(t.dim)
            .child(String(count)),
        );
    };

    return h_flex()
      .h(32)
      .flex_none()
      .px(8)
      .gap(2)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .child(tabItem("containers", "Containers", this.containers.length))
      .child(tabItem("images", "Images", this.images.length))
      .child(tabItem("volumes", "Volumes", this.volumes.length));
  }

  renderToolbar(t, cx) {
    const activeSpace = spaces().find((s) => s.active);

    const filterChip = (id, label) => {
      const active = this.statusFilter === id;
      return div()
        .px(7)
        .h(20)
        .rounded(4)
        .flex_none()
        .flex()
        .items_center()
        .cursor_pointer()
        .text_size(10.5)
        .bg(active ? t.selected : t.chrome)
        .text_color(active ? t.foreground : t.dim)
        .border_1()
        .border_color(active ? t.border : t.chrome)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          this.statusFilter = id;
          cx.notify();
        })
        .child(label);
    };

    const groupChip = (id, label) => {
      const active = this.groupBy === id;
      return div()
        .px(7)
        .h(20)
        .rounded(4)
        .flex_none()
        .flex()
        .items_center()
        .cursor_pointer()
        .text_size(10.5)
        .bg(active ? t.selected : t.chrome)
        .text_color(active ? t.accent || t.foreground : t.dim)
        .border_1()
        .border_color(active ? t.border : t.chrome)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          this.groupBy = id;
          try {
            localStorage.setItem("docker.groupBy", id);
          } catch {}
          cx.notify();
        })
        .child(label);
    };

    return v_flex()
      .flex_none()
      .p(10)
      .gap(8)
      .bg(t.background)
      .border_b(1)
      .border_color(t.border)
      .child(
        // Search bar
        h_flex()
          .h(32)
          .px(10)
          .gap(8)
          .items_center()
          .rounded(8)
          .bg(t.raised)
          .border_1()
          .border_color(t.border)
          .child(svg(`${ICONS}/search.svg`).size(13).flex_none().text_color(t.dim))
          .child(
            Input.new(this.search)
              .h_full()
              .flex_1()
              .min_w(0)
              .text_size(12)
              .text_color(t.foreground),
          )
          .when(this.search.value().length > 0, (el) =>
            el.child(
              div()
                .size(16)
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .rounded(4)
                .cursor_pointer()
                .hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => {
                  this.search.set_value("");
                  cx.notify();
                })
                .child(svg(`${ICONS}/close.svg`).size(10).text_color(t.muted)),
            ),
          ),
      )
      .child(
        // Line 2: Status chips & Space filter
        h_flex()
          .gap(4)
          .items_center()
          .child(filterChip("all", "All"))
          .child(filterChip("running", "Running"))
          .child(filterChip("paused", "Paused"))
          .child(filterChip("stopped", "Stopped"))
          .child(div().flex_1())
          .when(Boolean(activeSpace?.name), (el) =>
            el.child(
              h_flex()
                .px(7)
                .h(20)
                .gap(4)
                .rounded(4)
                .flex_none()
                .items_center()
                .cursor_pointer()
                .text_size(10.5)
                .bg(this.spaceOnly ? t.accent + "26" : t.chrome)
                .text_color(this.spaceOnly ? t.accent : t.dim)
                .border_1()
                .border_color(this.spaceOnly ? t.accent + "55" : t.chrome)
                .hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => {
                  this.spaceOnly = !this.spaceOnly;
                  cx.notify();
                })
                .child(div().child(`In: ${activeSpace.name}`)),
            ),
          ),
      )
      .when(this.tab === "containers", (el) =>
        // Line 3: Group by options
        el.child(
          h_flex()
            .gap(4)
            .items_center()
            .child(div().text_size(10.5).text_color(t.dim).child("Group by:"))
            .child(groupChip("network", "Network"))
            .child(groupChip("project", "Project"))
            .child(groupChip("none", "Flat")),
        ),
      );
  }

  // ── Containers List & Grouping ───────────────────────────────────────────────

  renderGroupHeader(groupName, groupContainers, t, cx) {
    const isFolded = this.groupFolded.has(groupName);
    const running = groupContainers.filter((c) => c.state === "running").length;
    const total = groupContainers.length;

    return h_flex()
      .h(28)
      .flex_none()
      .px(8)
      .gap(6)
      .items_center()
      .rounded(6)
      .bg(t.chrome)
      .border_1()
      .border_color(t.border)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        if (this.groupFolded.has(groupName)) this.groupFolded.delete(groupName);
        else this.groupFolded.add(groupName);
        try {
          localStorage.setItem("docker.groupFolded", JSON.stringify([...this.groupFolded]));
        } catch {}
        cx.notify();
      })
      .child(
        svg(`${ICONS}/${this.groupBy === "network" ? "server" : "layers"}.svg`)
          .size(12)
          .text_color(t.accent || t.ansi4),
      )
      .child(
        div()
          .font_semibold()
          .text_size(12)
          .text_color(t.foreground)
          .truncate()
          .child(groupName),
      )
      .child(
        div()
          .px(5)
          .h(16)
          .rounded(4)
          .flex()
          .items_center()
          .text_size(9.5)
          .bg(running > 0 ? t.ansi2 + "22" : t.raised)
          .text_color(running > 0 ? t.ansi2 : t.dim)
          .child(`${running}/${total}`),
      )
      .child(div().flex_1())
      .child(
        h_flex()
          .gap(4)
          .items_center()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          // Group Start Button
          .when(running < total, (el) =>
            el.child(
              div()
                .size(20)
                .flex()
                .items_center()
                .justify_center()
                .rounded(4)
                .cursor_pointer()
                .tooltip("Start all in group")
                .hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => {
                  cx.stop_propagation();
                  this.startGroup(groupContainers, cx);
                })
                .child(svg(`${ICONS}/play.svg`).size(10).text_color(t.ansi2)),
            ),
          )
          // Group Stop Button
          .when(running > 0, (el) =>
            el.child(
              div()
                .size(20)
                .flex()
                .items_center()
                .justify_center()
                .rounded(4)
                .cursor_pointer()
                .tooltip("Stop all in group")
                .hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => {
                  cx.stop_propagation();
                  this.stopGroup(groupContainers, cx);
                })
                .child(svg(`${ICONS}/stop.svg`).size(10).text_color(t.ansi1)),
            ),
          )
          // Group Restart Button
          .child(
            div()
              .size(20)
              .flex()
              .items_center()
              .justify_center()
              .rounded(4)
              .cursor_pointer()
              .tooltip("Restart all in group")
              .hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => {
                cx.stop_propagation();
                this.restartGroup(groupContainers, cx);
              })
              .child(svg(`${ICONS}/refresh.svg`).size(10).text_color(t.dim)),
          )
          // Chevron
          .child(
            svg(`${ICONS}/chevron-${isFolded ? "down" : "up"}.svg`)
              .size(11)
              .text_color(t.dim),
          ),
      );
  }

  renderContainersList(t, cx) {
    const q = this.search.value().toLowerCase().trim();
    const activeSpace = spaces().find((s) => s.active)?.name?.toLowerCase();

    let list = this.containers.filter((c) => {
      if (this.statusFilter === "running" && c.state !== "running") return false;
      if (this.statusFilter === "paused" && c.state !== "paused") return false;
      if (this.statusFilter === "stopped" && c.state !== "exited" && c.state !== "created") return false;

      if (this.spaceOnly && activeSpace) {
        const matchesSpace =
          (c.composeProject && c.composeProject.toLowerCase().includes(activeSpace)) ||
          c.name.toLowerCase().includes(activeSpace) ||
          c.networks.some((n) => n.toLowerCase().includes(activeSpace));
        if (!matchesSpace) return false;
      }

      if (q) {
        const hay = `${c.name} ${c.image} ${c.composeProject ?? ""} ${c.networks.join(" ")} ${c.portsRaw} ${c.status}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (list.length === 0) {
      return v_flex()
        .flex_1()
        .items_center()
        .justify_center()
        .p(24)
        .gap(8)
        .child(svg(`${ICONS}/docker.svg`).size(36).text_color(t.dim))
        .child(
          div()
            .text_size(13)
            .font_medium()
            .text_color(t.muted)
            .child(this.containers.length === 0 ? "No containers found" : "No containers match filter"),
        )
        .when(this.containers.length > 0, (el) =>
          el.child(
            div()
              .text_size(11)
              .text_color(t.dim)
              .child("Try clearing search or filters"),
          ),
        );
    }

    if (this.groupBy === "none") {
      return v_flex()
        .id("docker-containers-scroll")
        .flex_1()
        .min_h(0)
        .overflow_y_scrollbar()
        .p(10)
        .gap(8)
        .children(list.map((c) => this.renderContainerCard(c, t, cx)));
    }

    // Grouping
    const groups = new Map();
    for (const c of list) {
      let key = "standalone";
      if (this.groupBy === "network") {
        key = c.primaryNetwork || "bridge";
      } else if (this.groupBy === "project") {
        key = c.composeProject || "standalone";
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }

    // Sort groups: put custom named network like 'dpmptsp-pekanbaru' at top
    const sortedGroupKeys = [...groups.keys()].sort((a, b) => {
      if (a === "dpmptsp-pekanbaru") return -1;
      if (b === "dpmptsp-pekanbaru") return 1;
      return a.localeCompare(b);
    });

    return v_flex()
      .id("docker-containers-scroll")
      .flex_1()
      .min_h(0)
      .overflow_y_scrollbar()
      .p(10)
      .gap(10)
      .children(
        sortedGroupKeys.flatMap((groupKey) => {
          const groupContainers = groups.get(groupKey);
          const isFolded = this.groupFolded.has(groupKey);
          return [
            this.renderGroupHeader(groupKey, groupContainers, t, cx),
            ...(!isFolded ? groupContainers.map((c) => this.renderContainerCard(c, t, cx)) : []),
          ];
        }),
      );
  }

  renderContainerCard(c, t, cx) {
    const isBusy = this.actionInProgress === c.id;
    const isConfirmingDelete = this.confirmDelete === c.id;

    // Status colors
    const isRunning = c.state === "running";
    const isPaused = c.state === "paused";
    const statusColor = isRunning ? t.ansi2 : isPaused ? t.ansi3 : t.ansi1;

    // Action button helper
    const actionBtn = (iconName, tooltip, onClick, danger = false) =>
      div()
        .size(24)
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(5)
        .cursor_pointer()
        .tooltip(tooltip)
        .bg(danger ? t.ansi1 + "22" : t.raised)
        .border_1()
        .border_color(danger ? t.ansi1 + "44" : t.border)
        .hover((s) => s.bg(danger ? t.ansi1 + "44" : t.hover))
        .on_click((_e, cx) => onClick(cx))
        .child(
          svg(`${ICONS}/${iconName}.svg`)
            .size(12)
            .text_color(danger ? t.ansi1 : t.foreground),
        );

    return v_flex()
      .id(`container-${c.id}`)
      .w_full()
      .flex_none()
      .p(10)
      .gap(7)
      .rounded(8)
      .bg(t.raised)
      .border_1()
      .border_color(c.state === "running" ? t.border : t.chrome)
      .child(
        // Header row: Status dot, Name, ID, actions
        h_flex()
          .gap(8)
          .items_center()
          .child(
            div()
              .size(8)
              .rounded(4)
              .flex_none()
              .bg(statusColor),
          )
          .child(
            div()
              .flex_1()
              .min_w(0)
              .truncate()
              .font_semibold()
              .text_size(13)
              .text_color(t.foreground)
              .child(c.name),
          )
          .child(
            div()
              .font_family("monospace")
              .text_size(10)
              .text_color(t.dim)
              .tooltip("Click to copy ID")
              .cursor_pointer()
              .hover((s) => s.text_color(t.foreground))
              .on_click((_e, cx) => {
                cx.write_to_clipboard(c.id);
                notify({ title: "Copied ID", body: c.id, timeout: 1500 });
              })
              .child(c.id.slice(0, 10)),
          ),
      )
      .child(
        // Badges row: Compose project badge + Network badges
        h_flex()
          .flex_wrap()
          .gap(4)
          .items_center()
          .when(Boolean(c.composeProject), (el) =>
            el.child(
              h_flex()
                .px(5)
                .h(18)
                .gap(3)
                .rounded(4)
                .items_center()
                .bg(t.chrome)
                .border_1()
                .border_color(t.border)
                .text_size(10)
                .text_color(t.muted)
                .cursor_pointer()
                .tooltip(`Compose Project: ${c.composeProject} · click to filter`)
                .hover((s) => s.bg(t.hover).text_color(t.foreground))
                .on_click((_e, cx) => {
                  this.search.set_value(c.composeProject);
                  cx.notify();
                })
                .child(svg(`${ICONS}/layers.svg`).size(9).text_color(t.dim))
                .child(c.composeProject),
            ),
          )
          .children(
            c.networks.map((net) => {
              const isHighlighted = net === "dpmptsp-pekanbaru";
              return h_flex()
                .px(5)
                .h(18)
                .gap(3)
                .rounded(4)
                .items_center()
                .bg(isHighlighted ? t.accent + "18" : t.chrome)
                .border_1()
                .border_color(isHighlighted ? t.accent + "44" : t.border)
                .text_size(10)
                .text_color(isHighlighted ? t.accent : t.dim)
                .cursor_pointer()
                .tooltip(`Network: ${net} · click to filter`)
                .hover((s) => s.bg(t.hover).text_color(t.foreground))
                .on_click((_e, cx) => {
                  this.search.set_value(net);
                  cx.notify();
                })
                .child(svg(`${ICONS}/server.svg`).size(9).text_color(isHighlighted ? t.accent : t.dim))
                .child(net);
            }),
          ),
      )
      .child(
        // Details row: Image, Status Uptime
        h_flex()
          .gap(10)
          .items_center()
          .text_size(11)
          .child(
            div()
              .flex_1()
              .min_w(0)
              .truncate()
              .text_color(t.muted)
              .tooltip(`Image: ${c.image}`)
              .child(c.image),
          )
          .child(
            div()
              .flex_none()
              .text_color(statusColor)
              .child(c.status),
          ),
      )
      .when(c.ports.length > 0, (el) =>
        // Ports row
        el.child(
          h_flex()
            .flex_wrap()
            .gap(4)
            .items_center()
            .children(
              c.ports.map((p) =>
                h_flex()
                  .px(6)
                  .h(18)
                  .rounded(4)
                  .items_center()
                  .bg(t.chrome)
                  .border_1()
                  .border_color(t.border)
                  .text_size(10)
                  .font_family("monospace")
                  .text_color(p.host ? t.accent : t.dim)
                  .tooltip(p.host ? `Click to open http://localhost:${p.host}` : `Port ${p.container}`)
                  .when(Boolean(p.host), (b) =>
                    b
                      .cursor_pointer()
                      .hover((s) => s.bg(t.hover).text_color(t.foreground))
                      .on_click(() => {
                        exec("open", [`http://localhost:${p.host}`]);
                      }),
                  )
                  .child(p.raw),
              ),
            ),
        ),
      )
      .child(
        // Actions toolbar row
        h_flex()
          .pt(4)
          .border_t(1)
          .border_color(t.border)
          .gap(6)
          .items_center()
          .when(isBusy, (el) =>
            el.child(
              h_flex()
                .gap(6)
                .items_center()
                .child(svg(`${ICONS}/refresh.svg`).size(12).text_color(t.accent).spin(900))
                .child(div().text_size(11).text_color(t.dim).child("Processing…")),
            ),
          )
          .when(!isBusy, (el) =>
            el
              // Start action (if stopped)
              .when(!isRunning && !isPaused, (b) =>
                b.child(actionBtn("play", "Start Container", () => this.startContainer(c, cx))),
              )
              // Pause / Unpause
              .when(isRunning, (b) =>
                b.child(actionBtn("pause", "Pause Container", () => this.pauseContainer(c, cx))),
              )
              .when(isPaused, (b) =>
                b.child(actionBtn("play", "Unpause Container", () => this.unpauseContainer(c, cx))),
              )
              // Stop action (if running or paused)
              .when(isRunning || isPaused, (b) =>
                b.child(actionBtn("stop", "Stop Container", () => this.stopContainer(c, cx))),
              )
              // Restart action
              .child(actionBtn("refresh", "Restart Container", () => this.restartContainer(c, cx)))
              // Terminal Exec action
              .child(actionBtn("terminal", "Exec Shell (Terminal tab)", () => this.openTerminal(c, cx)))
              // Logs action
              .child(actionBtn("file-text", "View Recent Logs", () => this.viewLogs(c, cx)))
              .child(div().flex_1())
              // Delete action with confirmation
              .child(
                isConfirmingDelete
                  ? h_flex()
                      .px(8)
                      .h(24)
                      .gap(4)
                      .rounded(5)
                      .items_center()
                      .cursor_pointer()
                      .bg(t.ansi1)
                      .text_color(t.raised)
                      .hover((s) => s.opacity(0.85))
                      .on_click((_e, cx) => this.deleteContainer(c, cx))
                      .child(svg(`${ICONS}/trash.svg`).size(11).text_color(t.raised))
                      .child(div().text_size(11).font_bold().child("Confirm Delete?"))
                  : actionBtn("trash", "Delete Container", () => this.deleteContainer(c, cx), false),
              ),
          ),
      );
  }

  renderImagesList(t, cx) {
    const q = this.search.value().toLowerCase().trim();
    let list = this.images.filter((img) => {
      if (q) {
        const hay = `${img.repository} ${img.tag} ${img.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (list.length === 0) {
      return v_flex()
        .flex_1()
        .items_center()
        .justify_center()
        .p(24)
        .gap(8)
        .child(svg(`${ICONS}/docker.svg`).size(36).text_color(t.dim))
        .child(div().text_size(13).font_medium().text_color(t.muted).child("No Docker images found"));
    }

    return v_flex()
      .id("docker-images-scroll")
      .flex_1()
      .min_h(0)
      .overflow_y_scrollbar()
      .p(10)
      .gap(8)
      .children(
        list.map((img) => {
          const isConfirming = this.confirmDelete === img.id;
          return h_flex()
            .id(`img-${img.id}`)
            .w_full()
            .p(10)
            .gap(8)
            .rounded(8)
            .bg(t.raised)
            .border_1()
            .border_color(t.border)
            .items_center()
            .child(
              v_flex()
                .flex_1()
                .min_w(0)
                .gap(4)
                .child(
                  h_flex()
                    .gap(6)
                    .items_center()
                    .child(
                      div()
                        .truncate()
                        .font_semibold()
                        .text_size(12.5)
                        .text_color(t.foreground)
                        .child(img.repository),
                    )
                    .child(
                      div()
                        .px(5)
                        .h(16)
                        .rounded(4)
                        .bg(t.chrome)
                        .text_size(10)
                        .text_color(t.dim)
                        .child(img.tag),
                    ),
                )
                .child(
                  h_flex()
                    .gap(10)
                    .text_size(11)
                    .text_color(t.dim)
                    .child(div().child(`Size: ${img.size}`))
                    .child(div().child(img.created)),
                ),
            )
            .child(
              isConfirming
                ? h_flex()
                    .px(8)
                    .h(24)
                    .gap(4)
                    .rounded(5)
                    .items_center()
                    .cursor_pointer()
                    .bg(t.ansi1)
                    .text_color(t.raised)
                    .on_click((_e, cx) => this.deleteImage(img, cx))
                    .child(div().text_size(11).font_bold().child("Delete?"))
                : div()
                    .size(24)
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(5)
                    .cursor_pointer()
                    .tooltip("Delete Image")
                    .hover((s) => s.bg(t.hover))
                    .on_click((_e, cx) => this.deleteImage(img, cx))
                    .child(svg(`${ICONS}/trash.svg`).size(12).text_color(t.dim)),
            );
        }),
      );
  }

  renderVolumesList(t, cx) {
    const q = this.search.value().toLowerCase().trim();
    let list = this.volumes.filter((v) => {
      if (q) {
        if (!v.name.toLowerCase().includes(q)) return false;
      }
      return true;
    });

    if (list.length === 0) {
      return v_flex()
        .flex_1()
        .items_center()
        .justify_center()
        .p(24)
        .gap(8)
        .child(svg(`${ICONS}/docker.svg`).size(36).text_color(t.dim))
        .child(div().text_size(13).font_medium().text_color(t.muted).child("No Docker volumes found"));
    }

    return v_flex()
      .id("docker-volumes-scroll")
      .flex_1()
      .min_h(0)
      .overflow_y_scrollbar()
      .p(10)
      .gap(8)
      .children(
        list.map((vol) => {
          const isConfirming = this.confirmDelete === vol.name;
          return h_flex()
            .id(`vol-${vol.name}`)
            .w_full()
            .p(10)
            .gap(8)
            .rounded(8)
            .bg(t.raised)
            .border_1()
            .border_color(t.border)
            .items_center()
            .child(
              v_flex()
                .flex_1()
                .min_w(0)
                .gap(4)
                .child(
                  div()
                    .truncate()
                    .font_semibold()
                    .text_size(12)
                    .font_family("monospace")
                    .text_color(t.foreground)
                    .tooltip(vol.name)
                    .child(vol.name),
                )
                .child(
                  div()
                    .text_size(11)
                    .text_color(t.dim)
                    .child(`Driver: ${vol.driver} · Scope: ${vol.scope}`),
                ),
            )
            .child(
              isConfirming
                ? h_flex()
                    .px(8)
                    .h(24)
                    .gap(4)
                    .rounded(5)
                    .items_center()
                    .cursor_pointer()
                    .bg(t.ansi1)
                    .text_color(t.raised)
                    .on_click((_e, cx) => this.deleteVolume(vol, cx))
                    .child(div().text_size(11).font_bold().child("Delete?"))
                : div()
                    .size(24)
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(5)
                    .cursor_pointer()
                    .tooltip("Delete Volume")
                    .hover((s) => s.bg(t.hover))
                    .on_click((_e, cx) => this.deleteVolume(vol, cx))
                    .child(svg(`${ICONS}/trash.svg`).size(12).text_color(t.dim)),
            );
        }),
      );
  }

  renderLogsDrawer(t, cx) {
    if (!this.activeLogs) return null;

    return v_flex()
      .h(260)
      .flex_none()
      .border_t(2)
      .border_color(t.accent || t.border)
      .bg(t.chrome)
      .child(
        // Drawer header
        h_flex()
          .h(32)
          .flex_none()
          .px(10)
          .gap(8)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .bg(t.raised)
          .child(svg(`${ICONS}/file-text.svg`).size(13).text_color(t.accent))
          .child(
            div()
              .flex_1()
              .min_w(0)
              .truncate()
              .font_semibold()
              .text_size(12)
              .text_color(t.foreground)
              .child(`Logs: ${this.activeLogs.name}`),
          )
          .child(
            h_flex()
              .gap(4)
              .items_center()
              .child(
                div()
                  .size(22)
                  .flex_none()
                  .flex()
                  .items_center()
                  .justify_center()
                  .rounded(4)
                  .cursor_pointer()
                  .tooltip("Copy Logs")
                  .hover((s) => s.bg(t.hover))
                  .on_click((_e, cx) => {
                    cx.write_to_clipboard(this.logsText);
                    notify({
                      title: "Logs Copied",
                      body: `${this.activeLogs.name} logs copied to clipboard`,
                      timeout: 2000,
                    });
                  })
                  .child(svg(`${ICONS}/info.svg`).size(12).text_color(t.dim)),
              )
              .child(
                div()
                  .size(22)
                  .flex_none()
                  .flex()
                  .items_center()
                  .justify_center()
                  .rounded(4)
                  .cursor_pointer()
                  .tooltip("Refresh Logs")
                  .hover((s) => s.bg(t.hover))
                  .on_click((_e, cx) => this.viewLogs(this.activeLogs, cx))
                  .child(
                    svg(`${ICONS}/refresh.svg`)
                      .size(12)
                      .text_color(t.dim)
                      .when(this.logsLoading, (el) => el.spin(900)),
                  ),
              )
              .child(
                div()
                  .size(22)
                  .flex_none()
                  .flex()
                  .items_center()
                  .justify_center()
                  .rounded(4)
                  .cursor_pointer()
                  .tooltip("Close Logs")
                  .hover((s) => s.bg(t.hover))
                  .on_click((_e, cx) => {
                    this.activeLogs = null;
                    cx.notify();
                  })
                  .child(svg(`${ICONS}/close.svg`).size(12).text_color(t.muted)),
              ),
          ),
      )
      .child(
        // Logs body
        v_flex()
          .id("docker-logs-scroll")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .p(8)
          .bg(t.background)
          .child(
            div()
              .font_family("monospace")
              .text_size(10.5)
              .text_color(t.foreground)
              .child(this.logsText),
          ),
      );
  }

  render(cx) {
    const t = theme();

    if (!this.dockerAvailable) {
      return v_flex()
        .size_full()
        .bg(t.background)
        .child(this.renderHeader(t, cx))
        .child(
          v_flex()
            .flex_1()
            .items_center()
            .justify_center()
            .p(24)
            .gap(12)
            .child(svg(`${ICONS}/docker.svg`).size(48).text_color(t.ansi1))
            .child(
              div()
                .font_semibold()
                .text_size(14)
                .text_color(t.foreground)
                .child("Docker Daemon Unreachable"),
            )
            .child(
              div()
                .max_w(280)
                .text_center()
                .text_size(11.5)
                .text_color(t.dim)
                .child(this.dockerError || "Make sure Docker Desktop or Colima is running on your machine."),
            )
            .child(
              div()
                .px(14)
                .h(30)
                .rounded(6)
                .flex()
                .items_center()
                .cursor_pointer()
                .bg(t.raised)
                .border_1()
                .border_color(t.border)
                .hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => this.refresh(cx))
                .child(div().text_size(12).text_color(t.foreground).child("Retry Connection")),
            ),
        );
    }

    return v_flex()
      .size_full()
      .bg(t.background)
      .child(this.renderHeader(t, cx))
      .child(this.renderTabs(t, cx))
      .child(this.renderToolbar(t, cx))
      .child(
        this.tab === "containers"
          ? this.renderContainersList(t, cx)
          : this.tab === "images"
            ? this.renderImagesList(t, cx)
            : this.renderVolumesList(t, cx),
      )
      .when(Boolean(this.activeLogs), (el) => el.child(this.renderLogsDrawer(t, cx)));
  }
}
