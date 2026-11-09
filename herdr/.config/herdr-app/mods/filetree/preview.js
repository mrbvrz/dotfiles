import { createHash } from "crypto";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"]);
export const isImageExt = (ext) => IMAGE_EXTS.has(String(ext ?? "").toLowerCase());

const CACHE_DIR = "data/filetree/images";
const MAX_IMAGE = 20 * 1024 * 1024;
const MAX_MD_IMAGES = 32;

const PROBE_SCRIPT = [
  'p=$1',
  'if [ ! -e "$p" ]; then echo -1; exit 0; fi',
  'if stat -c%s / >/dev/null 2>&1; then stat -L -c "%s %Y" "$p"; else stat -L -f "%z %m" "$p"; fi',
  'head -c 65536 "$p" | od -An -v -tx1',
].join("\n");

const FETCH_LOCAL = 'mkdir -p "${3%/*}" && head -c $(( $4 + 1 )) < "$1" > "$2" && { [ "$(wc -c < "$2")" -eq "$4" ] && mv -f -- "$2" "$3" || { rm -f -- "$2"; exit 1; }; }';

const MAGIC = { png: [0x89, 0x50, 0x4e, 0x47], jpeg: [0xff, 0xd8, 0xff], gif: [0x47, 0x49, 0x46, 0x38] };
const at = (b, i, s) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
const u16 = (b, i) => b[i] | (b[i + 1] << 8), u24 = (b, i) => u16(b, i) | (b[i + 2] << 16);
const b16 = (b, i) => (b[i] << 8) | b[i + 1], b32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const i32 = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
const format = (b) => Object.keys(MAGIC).find((k) => MAGIC[k].every((v, i) => b[i] === v)) ?? (at(b, 0, "RIFF") && at(b, 8, "WEBP") ? "webp" : b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 && u16(b, 4) > 0 ? "ico" : null);
const head = (b) => String.fromCharCode(...b.subarray(0, 4096)).replace(/^\xef\xbb\xbf/, "");

function svgStart(s) {
  for (let i = 0; ;) {
    while (/\s/.test(s[i] ?? "")) i++;
    const low = s.slice(i, i + 9).toLowerCase(), end = low.startsWith("<?") ? "?>" : low.startsWith("<!--") ? "-->" : low === "<!doctype" ? ">" : null;
    if (!end) return low.startsWith("<svg") && !/\w/.test(low[4] ?? "") ? i + 4 : -1;
    const j = s.indexOf(end, i + 2);
    if (j < 0) return -1;
    i = j + end.length;
  }
}

function svgAttrs(s, i) {
  const re = /\s*(?:([^\s=>/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?|(\/?>))/y, map = new Map();
  for (re.lastIndex = i; ;) {
    const m = re.exec(s);
    if (!m || m[0] === "") return null;
    if (m[5]) return map;
    if (map.has(m[1])) return null;
    map.set(m[1], m[2] ?? m[3] ?? m[4] ?? "");
  }
}

function dimensions(bytes) {
  const f = format(bytes);
  let w = 0, h = 0;
  if (f === "ico") {
    const n = u16(bytes, 4);
    if (6 + 16 * n > bytes.length) return null;
    for (let i = 0; i < n; i++) {
      const e = 6 + 16 * i, off = bytes[e + 12] + bytes[e + 13] * 256 + bytes[e + 14] * 65536 + bytes[e + 15] * 16777216;
      let [ew, eh] = [bytes[e] || 256, bytes[e + 1] || 256];
      if (off + 16 > bytes.length) return null;
      if (MAGIC.png.every((v, k) => bytes[off + k] === v) && at(bytes, off + 4, "\x0d\x0a\x1a\x0a")) {
        if (off + 24 > bytes.length || !at(bytes, off + 12, "IHDR")) return null;
        [ew, eh] = [b32(bytes, off + 16), b32(bytes, off + 20)];
      } else {
        const bw = i32(bytes, off + 4), bh = Math.abs(i32(bytes, off + 8)) / 2;
        if (bw <= 0) return null;
        [ew, eh] = [Math.max(ew, bw), Math.max(eh, bh)];
      }
      if (ew * eh > w * h) [w, h] = [ew, eh];
    }
  } else if (f === "png") [w, h] = [b32(bytes, 16), b32(bytes, 20)];
  else if (f === "gif") [w, h] = [u16(bytes, 6), u16(bytes, 8)];
  else if (f === "webp") {
    if (at(bytes, 12, "VP8X")) [w, h] = [u24(bytes, 24) + 1, u24(bytes, 27) + 1];
    else if (at(bytes, 12, "VP8L")) { const v = b32(bytes.slice(21, 25).reverse(), 0); [w, h] = [(v & 0x3fff) + 1, ((v >>> 14) & 0x3fff) + 1]; }
    else if (at(bytes, 12, "VP8 ")) [w, h] = [u16(bytes, 26) & 0x3fff, u16(bytes, 28) & 0x3fff];
  } else if (f === "jpeg") {
    for (let i = 2; i + 8 < bytes.length;) {
      const m = bytes[i + 1];
      if (bytes[i] !== 0xff || m === 0xff) i++;
      else if (m === 0x01 || (m >= 0xd0 && m <= 0xd9)) i += 2;
      else if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { [h, w] = [b16(bytes, i + 5), b16(bytes, i + 7)]; break; }
      else i += 2 + b16(bytes, i + 2);
    }
  } else {
    const text = head(bytes), at0 = svgStart(text), attrs = at0 >= 0 ? svgAttrs(text, at0) : null;
    if (!attrs) return null;
    const plain = /^\s*(\d+\.?\d*|\.\d+)(?:px)?\s*$/, percent = /^\s*(\d+\.?\d*|\.\d+)%\s*$/, num = "[+-]?(?:\\d+\\.?\\d*|\\.\\d+)";
    const kind = (v) => v === undefined || percent.test(v) ? "box" : plain.test(v) ? "num" : "bad";
    const [aw, ah] = [attrs.get("width"), attrs.get("height")], [kw, kh] = [kind(aw), kind(ah)];
    if (kw === "bad" || kh === "bad") return null;
    if (kw === "num" && kh === "num") [w, h] = [parseFloat(aw), parseFloat(ah)];
    else {
      const m = (attrs.get("viewBox") ?? "").match(new RegExp(`^\\s*${num}[\\s,]+${num}[\\s,]+(${num})[\\s,]+(${num})\\s*$`)), [bw, bh] = m ? [+m[1], +m[2]] : [0, 0];
      if (!(bw > 0 && bh > 0)) return null;
      if (kw === "num") [w, h] = [parseFloat(aw), parseFloat(aw) * bh / bw];
      else if (kh === "num") [w, h] = [parseFloat(ah) * bw / bh, parseFloat(ah)];
      else [w, h] = [bw, bh];
    }
  }
  return +w > 0 && +h > 0 ? { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) } : null;
}

export async function loadImageFile(path, { exec, appHome, on }) {
  const ext = (path.split(".").pop() || "").toLowerCase();
  if (!isImageExt(ext)) return { error: "Unsupported image extension" };
  let probe;
  try { probe = await exec("sh", ["-c", PROBE_SCRIPT, "x", path], { on }); }
  catch (e) { return { error: String(e?.message ?? e) }; }
  if (probe.code !== 0) return { error: probe.stderr?.trim() || "Cannot read image" };
  const [first, ...rest] = probe.stdout.split("\n"), [size, mtime] = first.trim().split(" ").map(Number);
  if (!(size >= 0)) return { error: "Image file not found" };
  if (size > MAX_IMAGE) return { error: "Image larger than 20 MB" };
  const bytes = Uint8Array.from(rest.join(" ").match(/\b[0-9a-f]{2}\b/g) ?? [], (h) => parseInt(h, 16));
  const f = format(bytes) ?? (svgStart(head(bytes)) >= 0 ? "svg" : null);
  const expected = ext === "jpg" ? "jpeg" : ext;
  if (!f || f !== expected) return { error: `File header does not match .${ext}` };
  const dims = dimensions(bytes);
  if (!dims) return { error: "Image dimensions unknown" };
  const key = createHash("sha256").update(JSON.stringify([on ?? "", path, size, mtime])).digest("hex");
  const name = `${key}.${f}`, rel = `${CACHE_DIR}/${name}`, dest = `${appHome()}/${rel}`;
  const part = `${dest}.${Math.random().toString(36).slice(2, 8)}.part`;
  if (!on) {
    const r = await exec("sh", ["-c", `[ -f "$3" ] || (${FETCH_LOCAL})`, "x", path, part, dest, String(size)]);
    if (r.code !== 0) return { error: r.stderr?.trim() || "Failed to cache image" };
  } else {
    return { error: "Remote image preview not supported in filetree" };
  }
  return { path: rel, width: dims.width, height: dims.height };
}

function isLocalImageSrc(raw) {
  const s = (raw ?? "").trim();
  if (!s || s.startsWith("#") || s.startsWith("//")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return false;
  return true;
}

export function resolveMarkdownImagePath(baseDir, rootDir, rawSrc) {
  let clean = (rawSrc ?? "").trim();
  if (clean.startsWith("<") && clean.endsWith(">")) clean = clean.slice(1, -1).trim();
  const spaceIdx = clean.search(/\s/);
  if (spaceIdx > 0) clean = clean.slice(0, spaceIdx);
  clean = clean.split(/[?#]/)[0];
  try { clean = decodeURIComponent(clean); } catch {}
  if (!isLocalImageSrc(clean)) return null;
  const start = clean.startsWith("/") ? (rootDir || "/") : (baseDir || rootDir || "");
  const rel = clean.replace(/^\/+/, "");
  const combined = start ? `${start.replace(/\/+$/, "")}/${rel}` : rel;
  const lead = combined.startsWith("/") ? "/" : "";
  const segs = [];
  for (const part of combined.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (segs.length) segs.pop();
      else return null;
    } else segs.push(part);
  }
  const resolved = lead + segs.join("/");
  if (rootDir) {
    const normRoot = rootDir.replace(/\/+$/, "");
    if (resolved !== normRoot && !resolved.startsWith(normRoot + "/")) return null;
  }
  const ext = (resolved.split(".").pop() || "").toLowerCase();
  if (!isImageExt(ext)) return null;
  return resolved;
}

function parseImgTag(tag) {
  const getAttr = (name) => {
    const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` + "`" + `]+))`, "i").exec(tag);
    return m ? (m[1] ?? m[2] ?? m[3] ?? "").trim() : "";
  };
  const src = getAttr("src");
  const alt = getAttr("alt");
  const widthRaw = getAttr("width");
  let widthPx = null, widthPct = null;
  if (widthRaw) {
    const pm = /^(\d+(?:\.\d+)?)%$/.exec(widthRaw);
    const pxm = /^(\d+(?:\.\d+)?)(?:px)?$/i.exec(widthRaw);
    if (pm) widthPct = Math.min(100, Math.max(5, Number(pm[1])));
    else if (pxm) widthPx = Math.max(16, Math.round(Number(pxm[1])));
  }
  return { src, alt, widthPx, widthPct };
}

function extractLineImages(line, canTake) {
  const items = [];
  let out = line.replace(/<img\b[^>]*>/gi, (tag) => {
    const info = parseImgTag(tag);
    if (isLocalImageSrc(info.src) && canTake()) {
      items.push(info);
      return "";
    }
    return info.alt ? `[${info.alt}]` : "";
  });
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (full, alt, rawTarget) => {
    let target = rawTarget.trim();
    if (target.startsWith("<")) {
      const end = target.indexOf(">");
      if (end > 0) target = target.slice(1, end);
    } else {
      target = target.split(/\s+/)[0];
    }
    if (isLocalImageSrc(target) && canTake()) {
      items.push({ src: target, alt: alt.trim(), widthPx: null, widthPct: null });
      return "";
    }
    return full;
  });
  return { line: out, items };
}

const hasVisibleContent = (lines) => {
  const joined = lines.join("\n")
    .replace(/<\/?(?:p|div|table|thead|tbody|tfoot|tr|td|th|center|span|br|hr)\b[^>]*>/gi, "")
    .trim();
  return joined.length > 0;
};

const cleanTrailingBreaks = (lines) => {
  const text = lines.join("\n").replace(/(?:<br\s*\/?>|\s)+(?=<\/(?:p|td|th|div)\s*>)/gi, "");
  return text.split("\n");
};

export function splitMarkdownImages(md, maxImages = MAX_MD_IMAGES) {
  const lines = md.split("\n");
  const chunks = [];
  let mdLines = [];
  let totalImages = 0;

  const flushMd = () => {
    if (!mdLines.length) return;
    const text = mdLines.join("\n");
    if (text.trim()) chunks.push({ kind: "markdown", text });
    mdLines = [];
  };

  let fence = null;
  let mode = null;
  let blockLines = [];
  let pendingImages = [];
  let blockAlign = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];

    const fm = /^\s*(`{3,}|~{3,})/.exec(rawLine);
    if (fm) {
      if (!fence) fence = { ch: fm[1][0], len: fm[1].length };
      else if (fm[1][0] === fence.ch && fm[1].length >= fence.len && /^\s*(`+|~+)\s*$/.test(rawLine)) fence = null;
      if (mode) blockLines.push(rawLine);
      else mdLines.push(rawLine);
      continue;
    }
    if (fence) {
      if (mode) blockLines.push(rawLine);
      else mdLines.push(rawLine);
      continue;
    }

    if (!mode && /<table\b/i.test(rawLine)) {
      mode = "table";
      blockLines = [];
      pendingImages = [];
      blockAlign = /align\s*=\s*["']?center/i.test(rawLine) ? "center" : null;
    } else if (!mode && /<p\b/i.test(rawLine) && !/<\/p\s*>/i.test(rawLine)) {
      mode = "para";
      blockLines = [];
      pendingImages = [];
      blockAlign = /align\s*=\s*["']?center/i.test(rawLine) ? "center" : null;
    }

    const { line, items } = extractLineImages(rawLine, () => totalImages < maxImages && (++totalImages <= maxImages));

    if (mode === "table") {
      if (/align\s*=\s*["']?center/i.test(rawLine)) blockAlign = "center";
      if (items.length) pendingImages.push(...items);
      blockLines.push(line);
      if (/<\/table\s*>/i.test(rawLine)) {
        if (hasVisibleContent(blockLines)) mdLines.push(...cleanTrailingBreaks(blockLines));
        if (pendingImages.length) {
          flushMd();
          chunks.push({ kind: "md-image", items: pendingImages, align: blockAlign });
        }
        mode = null; blockLines = []; pendingImages = []; blockAlign = null;
      }
      continue;
    }

    if (mode === "para") {
      if (/align\s*=\s*["']?center/i.test(rawLine)) blockAlign = "center";
      if (items.length) pendingImages.push(...items);
      blockLines.push(line);
      if (/<\/p\s*>/i.test(rawLine)) {
        if (hasVisibleContent(blockLines)) mdLines.push(...cleanTrailingBreaks(blockLines));
        if (pendingImages.length) {
          flushMd();
          chunks.push({ kind: "md-image", items: pendingImages, align: blockAlign });
        }
        mode = null; blockLines = []; pendingImages = []; blockAlign = null;
      }
      continue;
    }

    if (items.length) {
      const align = /align\s*=\s*["']?center/i.test(rawLine) ? "center" : null;
      if (hasVisibleContent([line])) mdLines.push(line);
      flushMd();
      chunks.push({ kind: "md-image", items, align });
    } else {
      mdLines.push(rawLine);
    }
  }

  if (blockLines.length) {
    if (hasVisibleContent(blockLines)) mdLines.push(...cleanTrailingBreaks(blockLines));
    if (pendingImages.length) {
      flushMd();
      chunks.push({ kind: "md-image", items: pendingImages, align: blockAlign });
    }
  }
  flushMd();
  return { chunks, images: totalImages };
}
