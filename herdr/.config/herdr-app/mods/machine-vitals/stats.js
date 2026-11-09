// Parsers for the macOS command output that the panel samples. No Herdr imports,
// so tests can load this file with plain Node.

const GIB = 2 ** 30;

// `iostat -n 0 -c 2 -w 1`: the first row counts from boot, the last one covers the last second.
export const SCRIPT = [
  "echo @cpu; iostat -n 0 -c 2 -w 1",
  "echo @vm; vm_stat",
  "echo @sys; sysctl -n hw.memsize kern.memorystatus_vm_pressure_level vm.swapusage",
  "echo @df; df -k /",
  "echo @batt; pmset -g batt",
  "echo @net; netstat -ibn | awk '/<Link/{ if ($1 !~ /^lo/) { inb+=$7; outb+=$10 } } END { print inb, outb }'",
].join("; ");

// Asked only while the pointer is on the CPU row: `ps` reads every process.
export const PROCS = "ps -Aceo pcpu=,comm= -r | head -n 6";

export function parse(out) {
  const part = (name) => out.split(`@${name}\n`)[1]?.split("\n@")[0] ?? "";

  const cpuRow = part("cpu").trim().split("\n").at(-1)?.trim().split(/\s+/) ?? [];
  const idle = cpuRow.length >= 3 && /^\d+$/.test(cpuRow[2]) ? Number(cpuRow[2]) : null;

  const vm = part("vm");
  const pageSize = Number(vm.match(/page size of (\d+)/)?.[1] ?? 16384);
  const pages = (label) => Number(vm.match(new RegExp(`${label}:\\s+(\\d+)`))?.[1] ?? 0);
  // Activity Monitor's "Memory Used": app memory + wired + compressed.
  const used = (pages("Anonymous pages") - pages("Pages purgeable") + pages("Pages wired down") + pages("Pages occupied by compressor")) * pageSize;

  const [memsize, pressure, swap = ""] = part("sys").split("\n");
  const swapUsed = swap.match(/used = ([\d.]+)([MG])/);

  const df = part("df").trim().split("\n").at(-1)?.split(/\s+/) ?? [];
  const batt = part("batt");
  const level = batt.match(/(\d+)%;\s*([^;]+)/);

  const netParts = part("net").trim().split(/\s+/);
  const inBytes = Number(netParts[0]) || 0;
  const outBytes = Number(netParts[1]) || 0;

  return {
    cpu: idle === null ? null : Math.max(0, Math.min(100, 100 - idle)),
    mem: { used, total: Number(memsize) || 0, pressure: Number(pressure) || 1 },
    swap: swapUsed ? Number(swapUsed[1]) * (swapUsed[2] === "G" ? GIB : 2 ** 20) : 0,
    disk: df.length > 3 ? { total: Number(df[1]) * 1024, free: Number(df[3]) * 1024 } : null,
    battery: level ? { pct: Number(level[1]), state: level[2].trim(), ac: batt.includes("AC Power") } : null,
    net: { inBytes, outBytes, time: Date.now() },
  };
}

// `ps -Aceo pcpu=,comm= -r`: the busiest processes, without the ones this panel started.
export function parseProcs(out, count = 3) {
  return out.split("\n")
    .map((l) => l.match(/^\s*([\d.]+)\s+(.+?)\s*$/))
    .filter((m) => m && !["ps", "head", "sh"].includes(m[2]))
    .slice(0, count)
    .map((m) => ({ name: m[2], cpu: Number(m[1]) }));
}

export const gb = (bytes) => String(bytes / GIB >= 100 ? Math.round(bytes / GIB) : Math.round((bytes / GIB) * 10) / 10);

export function fmtSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec < 100) return "0 B/s";
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${Math.round(bytesPerSec / 1024)} KB/s`;
  if (bytesPerSec < 100 * 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  return `${Math.round(bytesPerSec / (1024 * 1024))} MB/s`;
}

export function fmtShort(b) {
  if (!b || b < 100) return "0";
  if (b < 1024 * 1000) return `${Math.round(b / 1024)}K`;
  if (b < 1000 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)}M`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(1)}G`;
}
