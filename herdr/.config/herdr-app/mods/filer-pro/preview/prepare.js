// Adapted from herdr-files-plus by jjongkwann (https://github.com/jjongkwann/herdr-files-plus, MIT).
//
// Everything a preview needs before it is drawn: truncate, strip loading content, split out diagrams.
// Pure. The work is a generator of small steps (prepareSteps): the Herdr runtime is about six times slower than V8
// and runs on the thread that draws and handles input, so the mod sleeps between steps (prepareAsync) and shows the
// source meanwhile. prepare() runs all steps at once (tests, tools).
import { markdownSteps, htmlSteps } from "./strip.js";
import { group } from "../lib/numbers.js";
import { splitMermaidSteps, MAX_DIAGRAMS, MAX_DIAGRAM_CHARS } from "./mermaid.js";

export const PREVIEW_MAX_CHARS = 200000;
export const MAX_MD_IMAGES = 50;
export { MAX_DIAGRAMS, MAX_DIAGRAM_CHARS };

// The note under a shortened preview, with the limit the document was prepared with (setting preview_max_chars).
export const noteText = (limit) => `Preview is shortened (first ${group(limit)} characters, long lines cut) · open Source for the whole file`;

// Links in a document are written by whoever wrote the document: only web links go to the system opener.
// A local path, file:, javascript: or a custom scheme could start a program.
export function safeLink(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url) ? url : null;
}

const fence = (text) => "```mermaid\n" + text + "\n```";

function attrVal(attrs, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const m = re.exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}

function parseWidth(w) {
  if (!w) return {};
  const s = String(w).trim();
  const pct = /^(\d+(?:\.\d+)?)%$/.exec(s);
  if (pct) return { widthPct: Math.min(100, Math.max(5, Number(pct[1]))) };
  const px = /^(\d+(?:\.\d+)?)(?:px)?$/i.exec(s);
  if (px) return { widthPx: Math.max(16, Math.round(Number(px[1]))) };
  return {};
}

export function isLocalImageSrc(src) {
  if (!src || typeof src !== "string") return false;
  const s = src.trim();
  if (!s || s.startsWith("#") || s.startsWith("//")) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return false;
  return true;
}

/**
 * Resolves a relative or root-relative image `src` from a Markdown file in `dir` within workspace `root`.
 * Returns null if the path is invalid, external, or escapes `root`.
 */
export function resolveMarkdownImagePath(dir, root, src) {
  if (!isLocalImageSrc(src)) return null;
  let clean = src.split(/[?#]/)[0].trim();
  try { clean = decodeURIComponent(clean); } catch {}
  if (!clean) return null;
  const base = clean.startsWith("/") ? (root || dir) : (dir || root);
  if (!base) return null;
  const win = /^[A-Za-z]:[\\/]/.test(base);
  const sep = win && base.includes("\\") ? "\\" : "/";
  const normBase = base.replace(/[\\/]+$/, "");
  const normRoot = (root || normBase).replace(/[\\/]+$/, "");
  const stack = normBase.split(/[\\/]+/);
  const rootDepth = normRoot.split(/[\\/]+/).length;
  for (const seg of clean.replace(/^[\\/]+/, "").split(/[\\/]+/)) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (stack.length <= rootDepth) return null;
      stack.pop();
    } else {
      stack.push(seg);
    }
  }
  return stack.join(sep);
}

// Extracts local/relative images (`![alt](src)` and `<img src="...">`) outside code spans on a single line.
function extractLineImages(line, canTake) {
  const items = [];
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (line[i] === "\\") { out += line.slice(i, i + 2); i += 2; continue; }
    if (line[i] === "`") {
      let n = 1;
      while (line[i + n] === "`") n++;
      const close = line.indexOf("`".repeat(n), i + n);
      if (close >= 0) { out += line.slice(i, close + n); i = close + n; continue; }
      out += line.slice(i, i + n); i += n; continue;
    }
    const rest = line.slice(i);
    const imgMatch = /^(?:<a\b[^>]*>\s*)?<img\b([^>]*?)\/?>(?:\s*<\/a>)?/i.exec(rest);
    if (imgMatch) {
      const attrs = imgMatch[1] ?? "";
      const src = attrVal(attrs, "src");
      const alt = attrVal(attrs, "alt") ?? "";
      const width = attrVal(attrs, "width");
      if (isLocalImageSrc(src) && canTake()) {
        items.push({ src: src.trim(), alt: alt.trim(), ...parseWidth(width) });
        i += imgMatch[0].length;
        continue;
      }
      out += imgMatch[0];
      i += imgMatch[0].length;
      continue;
    }
    const mdMatch = /^!\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))(?:\s+["'][^"'\n]*["'])?\s*\)/.exec(rest);
    if (mdMatch) {
      const alt = mdMatch[1] ?? "";
      const src = mdMatch[2] ?? mdMatch[3] ?? "";
      if (isLocalImageSrc(src) && canTake()) {
        items.push({ src: src.trim(), alt: alt.trim() });
        i += mdMatch[0].length;
        continue;
      }
      out += mdMatch[0];
      i += mdMatch[0].length;
      continue;
    }
    out += line[i++];
  }
  return { line: out, items };
}

function hasVisibleContent(lines) {
  const text = lines.join("\n")
    .replace(/<\/?(?:p|div|span|center|table|thead|tbody|tr|td|th|br|hr|a)\b[^>]*>/gi, "")
    .trim();
  return text.length > 0;
}

function cleanTrailingBreaks(lines) {
  return lines.map((l) => l.replace(/(?:<br\s*\/?>\s*)+$/i, ""));
}

/**
 * Splits Markdown into `[{ kind: "markdown", text }, { kind: "md-image", items, align }]`.
 * Keeps `<p>` and `<table>` HTML blocks intact and places extracted local images right after their block.
 */
export function splitMarkdownImages(md, maxImages = MAX_MD_IMAGES) {
  const lines = md.split("\n"), chunks = [];
  let mdLines = [], blockLines = [], pendingImages = [];
  let fence = null, mode = null, blockAlign = null, totalImages = 0;

  const flushMd = () => {
    const joined = mdLines.join("\n");
    if (joined.trim()) chunks.push({ kind: "markdown", text: joined });
    mdLines = [];
  };

  for (const rawLine of lines) {
    if (fence) {
      mdLines.push(rawLine);
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/.exec(rawLine);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      continue;
    }
    if (!mode) {
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(rawLine);
      if (open && (open[1][0] === "~" || !rawLine.slice(open[0].length).includes("`"))) {
        fence = open[1];
        mdLines.push(rawLine);
        continue;
      }
      if (/<table\b/i.test(rawLine) && !/<\/table\s*>/i.test(rawLine)) {
        mode = "table";
        blockAlign = /align\s*=\s*["']?center/i.test(rawLine) ? "center" : null;
        blockLines = [];
        pendingImages = [];
      } else if (/^ {0,3}<p\b/i.test(rawLine) && !/<\/p\s*>/i.test(rawLine)) {
        mode = "para";
        blockAlign = /align\s*=\s*["']?center/i.test(rawLine) ? "center" : null;
        blockLines = [];
        pendingImages = [];
      }
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

/**
 * The steps of prepare: yields between pieces of work, returns
 * { kind, parts: [{ kind: "markdown" | "html" | "mermaid", text, diagram? }], truncated, diagrams, limit }.
 * Mermaid parts beyond maxDiagrams fold back into Markdown, so they show as code. maxChars and maxDiagrams come from the
 * settings (preview_max_chars, max_diagrams); `limit` is the maxChars used, for the note.
 */
export function* prepareSteps(text, { kind, mermaid, maxChars = PREVIEW_MAX_CHARS, maxDiagrams = MAX_DIAGRAMS }) {
  let source = text, truncated = false;
  if (source.length > maxChars) {
    let cut = maxChars;
    const last = source.charCodeAt(cut - 1);
    if (last >= 0xd800 && last <= 0xdbff) cut--;
    source = source.slice(0, cut);
    truncated = true;
  }
  if (kind === "html") return { kind, parts: [{ kind: "html", text: yield* htmlSteps(source) }], truncated, diagrams: 0, images: 0, limit: maxChars };
  const { chunks, images } = splitMarkdownImages(source);
  yield;
  const parts = [];
  let diagrams = 0;
  let cut = false;
  for (const chunk of chunks) {
    if (chunk.kind === "md-image") {
      parts.push({ ...chunk, items: chunk.items.map((it) => ({ ...it })) });
      continue;
    }
    const stripped = yield* markdownSteps(chunk.text);
    if (stripped.cut) cut = true;
    yield;
    const split = mermaid ? yield* splitMermaidSteps(stripped.text) : [{ kind: "markdown", text: stripped.text }];
    for (const p of split) {
      const keep = p.kind === "mermaid" && diagrams < maxDiagrams;
      if (keep) diagrams++;
      const next = p.kind === "mermaid" && !keep ? { kind: "markdown", text: fence(p.text) } : { ...p };
      if (!next.text?.trim()) continue;
      const prev = parts.at(-1);
      if (next.kind === "markdown" && prev?.kind === "markdown") prev.text += "\n\n" + next.text;
      else parts.push(next);
    }
  }
  if (!parts.length) parts.push({ kind: "markdown", text: "" });
  return { kind, parts, truncated: truncated || cut, diagrams, images, limit: maxChars };
}

export function prepare(text, options) {
  const gen = prepareSteps(text, options);
  let r;
  while (!(r = gen.next()).done);
  return r.value;
}

/**
 * prepare in steps with `await sleep()` between them, so input and drawing keep running. `alive()` is asked before
 * every step: false (another file was opened) stops at once and returns null. `onStep(ms)` gets each step's duration.
 */
export async function prepareAsync(text, options, { sleep, alive, now = Date.now, onStep }) {
  const gen = prepareSteps(text, options);
  for (;;) {
    if (!alive()) return null;
    const t0 = now(), r = gen.next();
    onStep?.(now() - t0);
    if (r.done) return r.value;
    await sleep();
  }
}
