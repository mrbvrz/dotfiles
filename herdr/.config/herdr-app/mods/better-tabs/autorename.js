import { spaces, panes, terminals, run, exec } from "herdr";

const cache = new Map(); // tid -> { time, title }
const CACHE_TTL_MS = 3000;

function cleanStr(s) {
  if (!s || typeof s !== "string") return "";
  return s.replace(/[`*_\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function formatTitle(s, maxLen = 22) {
  let title = cleanStr(s);
  if (!title) return "";
  if (title.length > 15) {
    title = title.replace(/\s*\([^)]*\)$/, "");
  }
  // If executable path like ./bin/dev or /usr/local/bin/node
  if (/^(\.\/|\/)/.test(title)) {
    const spaceIdx = title.indexOf(" ");
    const exe = spaceIdx > 0 ? title.slice(0, spaceIdx) : title;
    const rest = spaceIdx > 0 ? title.slice(spaceIdx) : "";
    const base = exe.split("/").filter(Boolean).at(-1) || exe;
    title = (base + rest).trim();
  }
  if (title.length > maxLen) {
    return title.slice(0, maxLen - 1).trim() + "…";
  }
  return title;
}

export function extractTaskFromMsg(msg) {
  if (!msg || typeof msg !== "string") return null;

  // 1. Look for bold markdown **...**
  const boldMatches = [...msg.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1].trim());
  const goodBolds = boldMatches.filter(
    (b) => b.length >= 3 && !/^(user|role|done|error|warning|perbaikan|penyebab|catatan|solusi)$/i.test(b)
  );
  if (goodBolds.length > 0) {
    let candidate = goodBolds[0].replace(/[`'\"]/g, "").trim();
    const sub = candidate.match(/\((?:role\s+)?([^)]+)\)/i);
    if (sub) candidate = sub[1].trim();
    return formatTitle(candidate, 22);
  }

  // 2. Look for backticks `...`
  const tickMatches = [...msg.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
  const goodTicks = tickMatches.filter(
    (t) => t.length >= 3 && !t.startsWith("/") && t.length <= 25 && !/^[0-9a-f]{7,40}$/i.test(t)
  );
  if (goodTicks.length > 0) {
    return formatTitle(goodTicks[0], 22);
  }

  // 3. Commit / push pattern
  if (/commit/i.test(msg) && /push/i.test(msg)) {
    const branch = msg.match(/branch\s+`?([a-zA-Z0-9_\-\.]+)/i);
    return branch ? `Push ${branch[1]}` : "Commit & Push";
  }

  // 4. First short clause
  const first = msg.split(/[:\.\n]/)[0].replace(/[`*_\r\n]+/g, " ").trim();
  if (first && first.length >= 4 && first.length <= 25) {
    return formatTitle(first, 22);
  }

  return null;
}

export function extractTaskFromScreen(screen) {
  if (!screen || typeof screen !== "string") return null;
  const lines = screen.split("\n").map((l) => l.trim()).filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];

    // File edit or create: ● Edit(...) or ● Create(...)
    const fileMatch = line.match(/●\s*(Edit|Create)\([^)]*\/([^\/)]+)\)/);
    if (fileMatch) return formatTitle(`${fileMatch[1]} ${fileMatch[2]}`, 22);

    // Bash command: ● Bash(cmd)
    const bashMatch = line.match(/●\s*Bash\(([^)]+)\)/);
    if (bashMatch) {
      let cmd = bashMatch[1].trim().split("&&")[0].split("|")[0].trim();
      cmd = cmd.replace(/^cd\s+[^&]+\s*&&\s*/, "");
      if (!/^(touch|find|ls|cat|which|mkdir|rm)\b/.test(cmd)) {
        return formatTitle(cmd, 22);
      }
    }

    // Markdown section heading: ### 1. Foo or ## Foo
    const headMatch = line.match(/^#{1,4}\s+(?:\d+[\.\)]\s+)?([^\n\r]+)/);
    if (headMatch) {
      const h = headMatch[1].replace(/[`*_\r\n]+/g, " ").trim();
      if (h.length >= 3 && h.length <= 80 && !/^(summary|ringkasan|catatan|overview)$/i.test(h)) {
        return formatTitle(h, 22);
      }
    }

    // User prompt marker like "> ..." or "❯ ..."
    const promptMatch = line.match(/^[>❯]\s*(.+)$/);
    if (promptMatch) {
      const p = promptMatch[1].trim();
      if (p.length >= 3 && !p.startsWith("Try ") && !p.startsWith("Claude Code")) {
        return formatTitle(p, 22);
      }
    }
  }

  return null;
}

export async function fetchLiveTask(tid) {
  if (!tid) return null;
  const now = Date.now();
  const cached = cache.get(tid);
  if (cached && now - cached.time < CACHE_TTL_MS) {
    return cached.title;
  }

  try {
    const res = await exec("hc", ["get", "--json", tid]);
    if (res.code === 0 && res.stdout) {
      const info = JSON.parse(res.stdout);
      const msg = info.status?.msg;
      let task = extractTaskFromMsg(msg);

      if (!task) {
        const readRes = await exec("hc", ["read", tid]);
        if (readRes.code === 0 && readRes.stdout) {
          task = extractTaskFromScreen(readRes.stdout);
        }
      }

      cache.set(tid, { time: now, title: task });
      return task;
    }
  } catch {}

  return null;
}

export function resolveTabSync(tab, allPanes = panes(), allTerms = terminals()) {
  const mine = allPanes.filter((p) => p.tab === tab.id);
  const lead = mine.find((p) => p.program?.agent) ?? mine.find((p) => p.focused) ?? mine[0];
  if (!lead) return null;

  if (lead.mod) {
    return formatTitle(lead.title || lead.mod);
  }

  const term = allTerms.find((t) => t.address === lead.terminal);

  // Check cached live task (from agent status or screen)
  const cached = cache.get(lead.terminal);
  if (cached?.title) {
    return cached.title;
  }

  // Explicit terminal template or custom name
  if (term?.name && !term.name.startsWith("t") && term.name !== "hc") {
    return formatTitle(term.name);
  }

  // Active CLI foreground command (if not shell and not agent)
  const argv = term?.foreground?.argv;
  if (argv && argv.length > 0) {
    const rawCmd = argv.join(" ").trim();
    if (!/^\/(?:bin|usr\/bin|usr\/local\/bin)\/(?:zsh|bash|sh|fish|nu)(?:\s+-[la]+)?$/.test(rawCmd)) {
      if (!/^(zsh|bash|sh|fish|nu|agy|claude|codex|opencode)\b/.test(rawCmd)) {
        return formatTitle(rawCmd);
      }
    }
  }

  // Fallback to program name
  if (lead.program?.name && !lead.program.shell) {
    return lead.program.name;
  }

  // Fallback to directory name
  if (lead.cwd) {
    const parts = lead.cwd.replace(/\/+$/, "").split("/");
    const last = parts.at(-1);
    if (last && last !== "~") return last;
  }

  return "Terminal";
}

let running = false;
export async function autoRenameTabs() {
  if (running) return;
  running = true;

  try {
    const sps = spaces();
    const pns = panes();
    const terms = terminals();

    for (const space of sps) {
      const tabs = space.tabs ?? [];
      const spaceTitles = [];

      for (const tab of tabs) {
        const mine = pns.filter((p) => p.tab === tab.id);
        const lead = mine.find((p) => p.program?.agent) ?? mine.find((p) => p.focused) ?? mine[0];
        if (lead?.terminal) {
          await fetchLiveTask(lead.terminal);
        }

        const target = resolveTabSync(tab, pns, terms);
        spaceTitles.push({ tab, target });
      }

      // Check duplicates within the same space
      const countMap = new Map();
      for (const { target } of spaceTitles) {
        if (target) {
          countMap.set(target, (countMap.get(target) || 0) + 1);
        }
      }

      const seenMap = new Map();
      for (const { tab, target } of spaceTitles) {
        if (!target) continue;
        let finalTitle = target;
        if ((countMap.get(target) || 0) > 1) {
          const idx = (seenMap.get(target) || 0) + 1;
          seenMap.set(target, idx);
          finalTitle = `${target} #${idx}`;
        }
        if (tab.name !== finalTitle) {
          run("tab.rename", { id: tab.id, name: finalTitle });
        }
      }
    }
  } finally {
    running = false;
  }
}
