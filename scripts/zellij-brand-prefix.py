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

    # The first embedded Wasm module is compact-bar (verified via "+many" & "Tooltip" strings)
    start = offsets[0]
    end = offsets[1]
    slot_size = end - start

    padded_wasm = pad_wasm_to_size(custom_wasm, slot_size)
    if data[start:end] == padded_wasm:
        print(f"Zellij ({bin_path}) already has the custom compact-bar Wasm module installed.")
    else:
        os.chmod(bin_path, 0o755)
        new_data = bytearray(data)
        new_data[start:end] = padded_wasm
        bin_path.write_bytes(new_data)
        if sys.platform == "darwin":
            subprocess.run(
                ["codesign", "--force", "--sign", "-", str(bin_path)], check=True
            )
        print(f"Successfully installed custom compact-bar Wasm module into {bin_path}!")

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
