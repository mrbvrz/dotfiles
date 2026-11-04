#!/usr/bin/env python3
"""
Patch Alacritty on macOS (Apple Silicon / Intel) to keep native Apple NSWindow drop shadow
enabled even when window.opacity < 1.0 (translucent/blurred windows).

By default, Alacritty calls `window.set_has_shadow(config.window_opacity() >= 1.0)`,
which disables macOS native drop shadows whenever opacity < 1.0.
This script patches `alacritty::display::window::Window::set_has_shadow` in the Mach-O
binary so `setHasShadow:` always receives `true` (1), then re-signs `/Applications/Alacritty.app`.
"""

import subprocess
import sys
from pathlib import Path

APP_PATH = Path("/Applications/Alacritty.app")
BIN_PATH = APP_PATH / "Contents/MacOS/alacritty"

# ARM64 prologue of Window::set_has_shadow:
# sub sp, sp, #0x30        (ff c3 00 d1)
# stp x20, x19, [sp, #16]  (f4 4f 01 a9)
# stp x29, x30, [sp, #32]  (fd 7b 02 a9)
# add x29, sp, #0x20       (fd 83 00 91)
# mov x19, x1              (f3 03 01 aa)  <-- patched to mov w19, #1 (33 00 80 52)
# mov x20, x0              (f4 03 00 aa)
# bl _pthread_main_np      (...         )
# cbz w0, ...              (20 0a 00 34)
UNPATCHED_ARM64 = bytes.fromhex(
    "ffc300d1f44f01a9fd7b02a9fd830091" "f30301aa" "f40300aa"
)
PATCHED_ARM64 = bytes.fromhex(
    "ffc300d1f44f01a9fd7b02a9fd830091" "33008052" "f40300aa"
)


def main() -> int:
    if not BIN_PATH.exists():
        print(f"Error: {BIN_PATH} not found.")
        return 1

    data = BIN_PATH.read_bytes()

    out = subprocess.check_output(
        ["otool", "-arch", "arm64", "-tv", str(BIN_PATH)], text=True
    )
    label = "__ZN9alacritty7display6window6Window14set_has_shadow"
    lines = out.splitlines()
    label_idx = next(
        (i for i, line in enumerate(lines) if line.startswith(label)), None
    )
    if label_idx is None:
        print("Error: Window::set_has_shadow symbol not found.")
        return 1

    lipo_out = subprocess.check_output(
        ["lipo", "-detailed_info", str(BIN_PATH)], text=True
    )
    arm64_offset = 0
    in_arm64 = False
    for line in lipo_out.splitlines():
        line = line.strip()
        if line.startswith("architecture arm64"):
            in_arm64 = True
        elif line.startswith("architecture "):
            in_arm64 = False
        elif in_arm64 and line.startswith("offset "):
            arm64_offset = int(line.split()[1])
            break

    first_inst_line = lines[label_idx + 1].strip()
    va_hex = first_inst_line.split()[0]
    va_offset = int(va_hex, 16) - 0x100000000
    file_offset = arm64_offset + va_offset

    chunk = data[file_offset : file_offset + len(UNPATCHED_ARM64)]
    if chunk == PATCHED_ARM64:
        print("Alacritty already patched.")
        return 0
    if chunk != UNPATCHED_ARM64:
        print(f"Unexpected bytes at {hex(file_offset)}: {chunk.hex()}")
        return 1

    mut_data = bytearray(data)
    mut_data[file_offset : file_offset + len(UNPATCHED_ARM64)] = PATCHED_ARM64
    BIN_PATH.write_bytes(mut_data)

    subprocess.run(["xattr", "-cr", str(APP_PATH)], check=True)
    subprocess.run(
        ["codesign", "--force", "--deep", "--sign", "-", str(APP_PATH)], check=True
    )
    print("Successfully patched Alacritty to always enable native Apple window shadow!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
