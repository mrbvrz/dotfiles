// Copying and deleting avatar images, on this computer. Binary files go through the
// system's copy (fs.writeFile of a Uint8Array has written 0-byte files).

import { exec, appHome, window, shared, setShared } from "herdr";
import { SHARED_KEY, DATA_DIR, avatarFile, iconType, ownsFile, withIcon, withoutIcon } from "./avatars.js";

// This mod's folder name: its overlays and its own icon. Rename together with the folder.
export const MOD = "space-avatars";

const windows = () => window().platform === "windows";
const native = (p) => (windows() ? p.replace(/\//g, "\\") : p);

async function isFile(path) {
  if (windows()) return true; // `copy` below fails on a missing file
  const r = await exec("test", ["-f", path]);
  return r.code === 0;
}

// Copies `source` (an absolute path) in as the space's icon. Resolves with an error
// message for the person, or null when it's set.
export async function setIcon(spaceId, source) {
  if (!source) return "Type or paste the image's path.";
  if (!iconType(source)) return "Use a PNG, JPG, JPEG, GIF, WebP or SVG image.";
  if (!/^(\/|[A-Za-z]:[\\/])/.test(source)) return "Use the full path (starting with / or ~).";
  if (!(await isFile(source))) return "No file there.";
  const rel = avatarFile(spaceId, source, Date.now());
  const dir = `${appHome()}/${DATA_DIR}`;
  const dest = `${appHome()}/${rel}`;
  if (windows()) {
    await exec("cmd", ["/c", "mkdir", native(dir)]).catch(() => {}); // fails when it exists
    const r = await exec("cmd", ["/c", "copy", "/Y", native(source), native(dest)]);
    if (r.code !== 0) return `Couldn't copy it: ${(r.stderr || r.stdout).trim()}`;
  } else {
    const m = await exec("mkdir", ["-p", dir]);
    if (m.code !== 0) return `Couldn't make ${DATA_DIR}: ${m.stderr.trim()}`;
    const r = await exec("cp", ["--", source, dest]);
    if (r.code !== 0) return `Couldn't copy it: ${r.stderr.trim()}`;
  }
  const icons = shared(SHARED_KEY) ?? {};
  const old = icons[spaceId];
  setShared(SHARED_KEY, withIcon(icons, spaceId, rel));
  if (old && old !== rel) await deleteCopy(old, spaceId);
  return null;
}

export async function removeIcon(spaceId) {
  const icons = shared(SHARED_KEY) ?? {};
  const old = icons[spaceId];
  if (!old) return;
  setShared(SHARED_KEY, withoutIcon(icons, spaceId));
  await deleteCopy(old, spaceId);
}

// Deletes one of this mod's copies unless another space still shows it.
async function deleteCopy(rel, spaceId) {
  if (!ownsFile(rel)) return;
  const icons = shared(SHARED_KEY) ?? {};
  if (Object.entries(icons).some(([id, p]) => id !== spaceId && p === rel)) return;
  const path = `${appHome()}/${rel}`;
  await (windows() ? exec("cmd", ["/c", "del", "/q", native(path)]) : exec("rm", ["-f", "--", path])).catch(() => {});
}
