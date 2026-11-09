import { spaces, panes, terminals, run } from "herdr";

const cleanStr = (s) => (s ?? "").replace(/[`*_\r\n]+/g, " ").replace(/\s+/g, " ").trim();

export function resolveTabTitle(tab, allPanes = panes(), allTerms = terminals()) {
  const mine = allPanes.filter((p) => p.tab === tab.id);
  const lead = mine.find((p) => p.program?.agent) ?? mine.find((p) => p.focused) ?? mine[0];
  if (!lead) return null;

  // Mod panes (e.g. settings, file-icons, etc.)
  if (lead.mod) {
    return cleanStr(lead.title || lead.mod);
  }

  const term = allTerms.find((t) => t.address === lead.terminal);

  // 1. Explicit terminal template/name (set by user or runner)
  if (term?.name && !term.name.startsWith("t") && term.name !== "hc") {
    return formatTitle(term.name);
  }

  // 2. Active foreground command
  const argv = term?.foreground?.argv;
  let activeCmd = null;
  if (argv && argv.length > 0) {
    const rawCmd = argv.join(" ").trim();
    // Exclude shell launchers like /bin/zsh -l
    if (!/^\/(?:bin|usr\/bin|usr\/local\/bin)\/(?:zsh|bash|sh|fish|nu)(?:\s+-[la]+)?$/.test(rawCmd)) {
      activeCmd = rawCmd;
    }
  }

  // 3. Clean pane title
  const rawTitle = cleanStr(lead.title ?? term?.title ?? "");
  const isTelling =
    rawTitle &&
    rawTitle !== lead.program?.name &&
    !/^[~/]|^[A-Za-z]:\\/.test(rawTitle) &&
    !rawTitle.includes("@") &&
    rawTitle.toLowerCase() !== lead.program?.key &&
    !["zsh", "bash", "sh", "fish", "nu", "agy", "claude", "codex"].includes(rawTitle.toLowerCase());

  // 4. If agent
  if (lead.program?.agent) {
    if (isTelling) return formatTitle(rawTitle);
    if (activeCmd && activeCmd !== "agy" && activeCmd !== "claude" && activeCmd !== "codex") {
      return formatTitle(activeCmd);
    }
    return lead.program?.name || "Agent";
  }

  // 5. If regular terminal running a process
  if (isTelling) return formatTitle(rawTitle);
  if (activeCmd) return formatTitle(activeCmd);
  if (lead.program?.name && !lead.program.shell) return lead.program.name;

  // 6. Idle shell in directory
  if (lead.cwd) {
    const parts = lead.cwd.replace(/\/+$/, "").split("/");
    const last = parts.at(-1);
    if (last && last !== "~") return last;
  }

  return lead.program?.name || "Terminal";
}

function formatTitle(s) {
  let title = cleanStr(s);
  if (!title) return "";
  // If executable path like ./bin/dev or /usr/local/bin/node
  if (/^(\.\/|\/)/.test(title)) {
    const spaceIdx = title.indexOf(" ");
    const exe = spaceIdx > 0 ? title.slice(0, spaceIdx) : title;
    const rest = spaceIdx > 0 ? title.slice(spaceIdx) : "";
    const base = exe.split("/").filter(Boolean).at(-1) || exe;
    title = (base + rest).trim();
  }
  if (title.length > 24) {
    return title.slice(0, 22).trim() + "…";
  }
  return title;
}

export function autoRenameTabs() {
  const sps = spaces();
  const pns = panes();
  const terms = terminals();

  for (const space of sps) {
    for (const tab of space.tabs ?? []) {
      const target = resolveTabTitle(tab, pns, terms);
      if (target && tab.name !== target) {
        run("tab.rename", { id: tab.id, name: target });
      }
    }
  }
}
