#!/usr/bin/env python3
"""
Replace Zellij's built-in compact-bar Wasm module in the Zellij binary with our
custom-compiled `compact-bar.wasm` (~/.config/zellij/plugins/compact-bar.wasm),
featuring:
  - 1 empty transparent top-padding row above the bottom bar
  - `mrbvrz-space01` badge on the left with secondary orange (#FFAB70) background
  - 100% transparent bar & inactive tab background (ANSI 49m)
  - Mode indicator (`NORMAL`, `RENAME TAB`, `SCROLL`, `SEARCH`, etc.) aligned to the far right
"""

import glob
import os
import shutil
import subprocess
import sys
from pathlib import Path

WASM_MAGIC = b"\x00asm\x01\x00\x00\x00"
CUSTOM_WASM = Path.home() / ".dotfiles/zellij/.config/zellij/plugins/compact-bar.wasm"


def find_zellij_binary() -> Path | None:
    candidates = glob.glob("/opt/homebrew/Cellar/zellij/*/bin/zellij") + glob.glob(
        "/usr/local/Cellar/zellij/*/bin/zellij"
    )
    if candidates:
        return Path(sorted(candidates)[-1])
    which = shutil.which("zellij")
    return Path(which).resolve() if which else None


def encode_uleb128(val: int) -> bytes:
    out = bytearray()
    while True:
        b = val & 0x7F
        val >>= 7
        if val != 0:
            b |= 0x80
        out.append(b)
        if val == 0:
            break
    return bytes(out)


def read_uleb128(buf: bytes, pos: int) -> tuple[int, int]:
    result = shift = 0
    while True:
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        shift += 7
        if not b & 0x80:
            return result, pos


def true_wasm_end(data: bytes, start: int, limit: int) -> int:
    """Walk Wasm sections from `start` and return the file offset where the module truly ends."""
    pos = start + 8
    last_id = 0
    while pos < limit:
        sec_id = data[pos]
        length, body = read_uleb128(data, pos + 1)
        if length == 0 or body + length > limit or (sec_id and sec_id < last_id):
            break
        if sec_id:
            last_id = sec_id
        pos = body + length
    return pos


def pad_wasm_to_size(wasm_bytes: bytes, target_size: int) -> bytes:
    """Append a valid Wasm Custom Section (id = 0) so the module matches target_size."""
    diff = target_size - len(wasm_bytes)
    if diff == 0:
        return wasm_bytes
    if diff < 8:
        raise ValueError(f"Cannot pad Wasm module by {diff} bytes (too small)")

    # Custom section format: 0x00 | uleb128(section_len) | uleb128(name_len=1) | b"p" | payload
    # Let us solve for payload_len such that 1 + len(uleb128(2 + payload_len)) + 2 + payload_len == diff
    for len_bytes in range(1, 6):
        sec_len = diff - 1 - len_bytes
        encoded_len = encode_uleb128(sec_len)
        if len(encoded_len) == len_bytes:
            payload_len = sec_len - 2
            custom_sec = b"\x00" + encoded_len + b"\x01p" + (b"\x00" * payload_len)
            assert len(wasm_bytes) + len(custom_sec) == target_size
            return wasm_bytes + custom_sec

    raise RuntimeError("Failed to compute exact Wasm custom section padding")


def main() -> int:
    bin_path = find_zellij_binary()
    if not bin_path or not bin_path.exists():
        print("Error: zellij binary not found.")
        return 1
    if not CUSTOM_WASM.exists():
        print(f"Error: custom Wasm plugin not found at {CUSTOM_WASM}")
        return 1

    data = bin_path.read_bytes()
    custom_wasm = CUSTOM_WASM.read_bytes()

    # Locate all embedded Wasm modules inside the Zellij binary
    offsets = []
    idx = 0
    while True:
        idx = data.find(WASM_MAGIC, idx)
        if idx == -1:
            break
        offsets.append(idx)
        idx += 1

    if len(offsets) < 2:
        print("Warning: embedded Wasm modules not found in zellij binary.")
        return 0

    # The first embedded Wasm module is compact-bar (verified via "+many" & "Tooltip" strings).
    # The gap up to the next module may contain unrelated bytes, so compute the true module
    # length by walking the Wasm sections, and only replace exactly that many bytes.
    start = offsets[0]
    end = true_wasm_end(data, start, offsets[1])
    slot_size = end - start

    # Find target zellij binary (handling Linux non-root permission fallback)
    target_bin = bin_path
    if not os.access(target_bin, os.W_OK):
        local_bin = Path.home() / ".local/bin/zellij"
        local_bin.parent.mkdir(parents=True, exist_ok=True)
        if not local_bin.exists() or local_bin.stat().st_mtime < bin_path.stat().st_mtime:
            shutil.copy2(bin_path, local_bin)
        target_bin = local_bin

    padded_wasm = pad_wasm_to_size(custom_wasm, slot_size)
    if data[start:end] == padded_wasm:
        print(f"Zellij ({target_bin}) already has the custom compact-bar Wasm module installed.")
    else:
        os.chmod(target_bin, 0o755)
        new_data = bytearray(data)
        new_data[start:end] = padded_wasm
        target_bin.write_bytes(new_data)
        if sys.platform == "darwin":
            subprocess.run(
                ["codesign", "--force", "--sign", "-", str(target_bin)], check=True
            )
        print(f"Successfully installed custom compact-bar Wasm module into {target_bin}!")

    # Clear cached compiled Wasm bars so Zellij reloads the custom embedded plugin
    cache_dirs = [
        Path.home() / "Library/Caches/org.Zellij-Contributors.Zellij",
        Path.home() / ".cache/zellij",
    ]
    for cdir in cache_dirs:
        if cdir.exists():
            for item in cdir.rglob("*compact-bar*"):
                if item.is_dir():
                    shutil.rmtree(item, ignore_errors=True)
                else:
                    item.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
