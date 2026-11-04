#!/usr/bin/env python3
"""
Patch Zellij's built-in compact-bar / tab-bar Wasm plugin so the left prefix
reads ` mrbvrz ` instead of ` Zellij `.
Combined with `zellij attach -c space` (or `hide_session_name true`), this
displays `mrbvrz (space)` cleanly in the bottom bar.
"""

import glob
import os
import shutil
import subprocess
import sys
from pathlib import Path

UNPATCHED = b"+many \xe2\x86\x92  Zellij "
OLD_PATCH = b"+many \xe2\x86\x92  mrbvrz "
PATCHED   = b"+many \xe2\x86\x92  mrbvrz-"
PAREN_OLD = b"ch either.\x00\x01(\xc0\x01)\x00"
PAREN_BAD = b"ch either.\x00\x00\xc0\x01 \x00\x00"
PAREN_NEW = b"ch either.\x00\x01 \xc0\x01 \x00"

# Make 8-bit background colors (`background 0` in config.kdl) emit ANSI 49m (default transparent terminal background)
# instead of 48;5;0m so the bottom bar blends 100% transparently with Alacritty's blurred background:
BG_LINE_OLD = b"\x1b[48;5;\xc0\x05m\x1b[0K\x00"
BG_LINE_NEW = b"\x1b[49m\x1b[0K\x00\x00\x00\x00\x00\x00"
BG_SPAN_OLD = b"\x01F\xc0\x00\x0548;5;\xc0\x00\x0538;5;"
BG_SPAN_NEW = b"\x01F\xc0\x00\x0249\x00\x00\x00\x00\x00\x0538;5;"


def find_zellij_binary() -> Path | None:
    candidates = glob.glob("/opt/homebrew/Cellar/zellij/*/bin/zellij") + glob.glob(
        "/usr/local/Cellar/zellij/*/bin/zellij"
    )
    if candidates:
        return Path(sorted(candidates)[-1])
    which = shutil.which("zellij")
    return Path(which).resolve() if which else None


def main() -> int:
    bin_path = find_zellij_binary()
    if not bin_path or not bin_path.exists():
        print("Error: zellij binary not found.")
        return 1

    data = bin_path.read_bytes()
    if (
        PATCHED in data
        and PAREN_NEW in data
        and BG_LINE_NEW in data
        and BG_SPAN_NEW in data
    ):
        print(f"Zellij ({bin_path}) is already patched with 'mrbvrz-space' and 100% transparent bar.")
    else:
        os.chmod(bin_path, 0o755)
        new_data = data
        if UNPATCHED in new_data:
            new_data = new_data.replace(UNPATCHED, PATCHED, 1)
        elif OLD_PATCH in new_data:
            new_data = new_data.replace(OLD_PATCH, PATCHED, 1)
        if PAREN_OLD in new_data:
            new_data = new_data.replace(PAREN_OLD, PAREN_NEW, 1)
        elif PAREN_BAD in new_data:
            new_data = new_data.replace(PAREN_BAD, PAREN_NEW, 1)
        if BG_LINE_OLD in new_data:
            new_data = new_data.replace(BG_LINE_OLD, BG_LINE_NEW, 1)
        if BG_SPAN_OLD in new_data:
            new_data = new_data.replace(BG_SPAN_OLD, BG_SPAN_NEW, 1)
        bin_path.write_bytes(new_data)
        if sys.platform == "darwin":
            subprocess.run(
                ["codesign", "--force", "--sign", "-", str(bin_path)], check=True
            )
        print(f"Successfully patched {bin_path} ('mrbvrz-<session>' + 100% transparent bottom bar)!")

    # Clear cached compiled Wasm bars so Zellij reloads the patched embedded plugin
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
