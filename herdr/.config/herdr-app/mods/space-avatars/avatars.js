// Pure helpers for space-avatars (no Herdr imports, so they test outside the app).

// Image types an icon can be, the first preferred when a repo has several.
export const ICON_TYPES = ["png", "jpg", "jpeg", "gif", "webp", "svg"];

// Where picked images are copied, relative to the app folder (image() reads only there).
export const DATA_DIR = "data/space-avatars";

// The shared key holding { [spaceId]: path relative to the app folder }.
export const SHARED_KEY = "space-avatars.icons";

const QUOTES = ['"', "'", "`"];

// What someone typed or pasted, as a path: trimmed, quotes from a drag-and-drop
// paste and a file:// prefix dropped, a terminal's escaped spaces unescaped, ~ expanded.
export function normalizePath(input, home) {
  let p = String(input ?? "").trim();
  if (p.length > 1 && QUOTES.includes(p[0]) && p[p.length - 1] === p[0]) p = p.slice(1, -1).trim();
  if (/^file:\/\//i.test(p)) {
    p = p.replace(/^file:\/\/(localhost)?/i, "");
    try { p = decodeURIComponent(p); } catch {}
    // file:///C:/x -> C:/x
    if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
  }
  // `My\ Icon.png`: a backslash before a space or shell character, not a Windows separator.
  if (!/^[A-Za-z]:\\/.test(p)) p = p.replace(/\\([ ()'"&;!$`[\]{}])/g, "$1");
  if (p === "~") return home;
  if (p.startsWith("~/")) return `${home}${p.slice(1)}`;
  return p;
}

// The file's image type (lowercased), or null when it isn't one an icon can be.
export function iconType(path) {
  const name = String(path ?? "").split(/[\\/]/).pop();
  const dot = name.lastIndexOf(".");
  if (dot < 1) return null;
  const type = name.slice(dot + 1).toLowerCase();
  return ICON_TYPES.includes(type) ? type : null;
}

// FNV-1a, 8 hex chars: enough to give each pick its own file name.
export function hashText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// The copy's path, relative to the app folder. A new name for every pick
// (`stamp`, e.g. Date.now()) so the sidebar draws the new image, not a cached one.
export function avatarFile(spaceId, source, stamp) {
  const type = iconType(source);
  if (!type) return null;
  const safe = String(spaceId).replace(/[^A-Za-z0-9_-]/g, "_");
  return `${DATA_DIR}/${safe}-${hashText(`${source}\n${stamp}`)}.${type}`;
}

// `ls -1` of space-icons/: lowercased repo name -> its image, relative to the app folder.
export function parseIconListing(listing) {
  const icons = {}, rank = {};
  for (const file of String(listing ?? "").split("\n")) {
    const dot = file.lastIndexOf(".");
    if (dot < 1) continue;
    const type = ICON_TYPES.indexOf(file.slice(dot + 1).toLowerCase());
    const name = file.slice(0, dot).toLowerCase();
    if (type < 0 || rank[name] <= type) continue;
    icons[name] = `space-icons/${file}`;
    rank[name] = type;
  }
  return icons;
}

// `cksum` output: path relative to the app folder -> its checksum.
export function parseChecksums(text) {
  const sums = {};
  for (const line of String(text ?? "").split("\n")) {
    const m = /^(\d+) \d+ (.+)$/.exec(line);
    if (m) sums[m[2]] = m[1];
  }
  return sums;
}

// Another machine's icons, as copies here: `shared` is its space-avatars.icons, `sums`
// its parseChecksums() of data/space-avatars/* and space-icons/*. A copy is named by
// machine and checksum, so a changed image gets a new one.
// { icons: { "machine/spaceId": copy }, folderIcons: { repo: copy }, files: { copy: its path there } }
export function remoteIcons(machine, shared, sums) {
  const files = {};
  const copy = (rel) => {
    if (typeof rel !== "string" || !sums?.[rel] || !iconType(rel)) return null;
    const safe = String(machine).replace(/[^A-Za-z0-9_-]/g, "_");
    const file = `${DATA_DIR}/remote/${safe}-${sums[rel]}-${rel.split("/").pop()}`;
    files[file] = rel;
    return file;
  };
  const icons = {};
  for (const [id, rel] of Object.entries(shared ?? {})) {
    const file = copy(rel);
    if (file) icons[`${machine}/${id}`] = file;
  }
  const listing = Object.keys(sums ?? {}).filter((rel) => rel.startsWith("space-icons/")).map((rel) => rel.slice(12)).join("\n");
  const folderIcons = {};
  for (const [repo, rel] of Object.entries(parseIconListing(listing))) folderIcons[repo] = copy(rel);
  return { icons, folderIcons, files };
}

// A space's avatar: its own icon, else (a space on another machine) that machine's icon
// for it or its repo, else its repo's from space-icons/, else null (the letter tile).
export function resolveIcon({ spaceId, repo, icons, folderIcons, remote }) {
  const name = String(repo ?? "").toLowerCase();
  return icons?.[spaceId] ?? remote?.icons?.[spaceId] ?? remote?.folderIcons?.[name] ?? folderIcons?.[name] ?? null;
}

// Only copies this mod made may be deleted: files directly in DATA_DIR.
export function ownsFile(path) {
  if (typeof path !== "string" || !path.startsWith(`${DATA_DIR}/`)) return false;
  const rest = path.slice(DATA_DIR.length + 1);
  return rest.length > 0 && !/[\\/]/.test(rest) && rest !== "." && rest !== "..";
}

export function withIcon(icons, spaceId, path) {
  return { ...(icons ?? {}), [spaceId]: path };
}

export function withoutIcon(icons, spaceId) {
  const out = { ...(icons ?? {}) };
  delete out[spaceId];
  return out;
}
