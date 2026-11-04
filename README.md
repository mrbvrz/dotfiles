# 🚀 Universal Dotfiles (`mrbvrz`)

> **Cross-platform, blazing-fast developer terminal environment for macOS and Fedora Linux — powered by Alacritty, Zsh, Spaceship Prompt, Mise, GNU Stow, and Modern Rust/Go CLI tools.**

![macOS](https://img.shields.io/badge/macOS-000000?style=flat-square&logo=apple&logoColor=white)
![Fedora](https://img.shields.io/badge/Fedora-51A2DA?style=flat-square&logo=fedora&logoColor=white)
![Zsh](https://img.shields.io/badge/Shell-Zsh-4EAA25?style=flat-square&logo=gnu-bash&logoColor=white)
![Alacritty](https://img.shields.io/badge/Terminal-Alacritty-F46D01?style=flat-square&logo=alacritty&logoColor=white)
![Spaceship](https://img.shields.io/badge/Prompt-Spaceship-7C3AED?style=flat-square)
![GNU Stow](https://img.shields.io/badge/Manager-GNU_Stow-F59E0B?style=flat-square)

---

## 📖 About

This repository contains my personal, cross-platform dotfiles managed with **GNU Stow**. It provides an identical, zero-friction terminal and development experience across **macOS (Apple Silicon & Intel)** and **Fedora Linux**, featuring sub-150ms shell startup times, asynchronous prompt rendering, declarative runtime management via `mise`, fuzzy navigation, and interactive Terminal UIs.

---

## 🧰 Provided Stack & Included Tools

| Category | Provided Tools | Purpose |
| :--- | :--- | :--- |
| **Code Editor / IDE** | **Zed** (`zed`) | High-performance Rust-based multiplayer code editor (`EDITOR` & `VISUAL` default) |
| **Terminal Emulator** | **Alacritty** + **CommitMono Nerd Font** | Cross-platform OpenGL/Metal GPU-accelerated terminal with Min Dark (Blurred) theme, native macOS shadow & live reload |
| **Multiplexer** | **Zellij** (`zj` / `zja` / `lzj`) | Modern Rust workspace multiplexer (`MRBVRZ-SPACE01..N`) with custom bottom bar, live search overlay, **zellij-tabula**, **monocle**, and **lazy-zellij** |
| **Shell & Prompt** | **Zsh**, **Oh My Zsh**, **Spaceship Prompt** | Fast, async 2-line prompt with language runtime detection, Git status, and right-hand clock |
| **Runtime Manager** | **mise** (`mise-en-place`) | Polyglot runtime manager for Node.js, Bun, pnpm, Go, Python, and Ruby |
| **Zsh Plugins** | `zsh-autosuggestions`, `zsh-syntax-highlighting` | Real-time fish-like command autosuggestions and syntax validation |
| **Dotfiles Manager** | **GNU Stow** + **Homebrew Bundle (`Brewfile`)** | Declarative package management and clean symlink orchestration |
| **Navigation & Search** | **zoxide** (`z`), **fzf**, **fd**, **ripgrep** (`rg`) | Smart frecent directory jumping and instant fuzzy file/history search |
| **File Management** | **yazi** (`y`), **eza** (`ls`/`ll`/`lt`), **bat** (`cat`) | Terminal file manager with code/image previews and icon-rich directory trees |
| **Git & Docker TUI** | **lazygit** (`lg`), **git-delta**, **lazydocker** (`ld`) | Interactive Git/Docker dashboards and side-by-side syntax-highlighted Git diffs |
| **System Monitoring** | **btop** (`top`), **duf** (`df`), **dust** (`du`) | Visual resource monitor, disk usage table, and directory size tree analyzer |

---

## 📦 Repository Structure (GNU Stow)

```text
~/.dotfiles/
├── alacritty/
│   └── .config/alacritty/alacritty.toml # -> ~/.config/alacritty/alacritty.toml
├── zed/
│   └── .config/zed/settings.json        # -> ~/.config/zed/settings.json
├── zellij/
│   ├── .config/zellij/config.kdl        # -> ~/.config/zellij/config.kdl
│   ├── .config/zellij/layouts/compact.kdl # -> ~/.config/zellij/layouts/compact.kdl
│   └── .config/zellij/plugins/          # -> compact-bar.wasm, zellij-tabula.wasm, monocle.wasm
├── bin/
│   └── .local/bin/                      # -> lzj & lzj-snapshot (lazy-zellij fzf session picker)
├── lazygit/
│   └── .config/lazygit/config.yml       # -> ~/.config/lazygit/config.yml (Min Dark theme)
├── yazi/
│   ├── .config/yazi/yazi.toml           # -> ~/.config/yazi/yazi.toml
│   └── .config/yazi/theme.toml          # -> ~/.config/yazi/theme.toml (Min Dark theme)
├── btop/
│   ├── .config/btop/btop.conf           # -> ~/.config/btop/btop.conf
│   └── .config/btop/themes/min-dark.theme # -> ~/.config/btop/themes/min-dark.theme
├── bat/
│   └── .config/bat/config               # -> ~/.config/bat/config (TwoDark theme & syntax mappings)
├── mise/
│   └── .config/mise/config.toml         # -> ~/.config/mise/config.toml
├── spaceship/
│   └── .config/spaceship.zsh            # -> ~/.config/spaceship.zsh
├── zsh/
│   ├── .zshrc                           # -> ~/.zshrc
│   ├── .zshenv                          # -> ~/.zshenv
│   └── .zprofile                        # -> ~/.zprofile
├── git/
│   ├── .gitconfig                       # -> ~/.gitconfig
│   └── .gitignore_global                # -> ~/.gitignore_global
├── scripts/
│   ├── macos-alacritty-shadow.py        # Enables native Apple NSWindow drop shadow on blurred Alacritty
│   └── zellij-brand-prefix.py           # Installs custom compact-bar.wasm (MRBVRZ-SPACE01..N + search overlay)
├── Brewfile                             # Declarative macOS Homebrew bundle
├── install.sh                           # Universal bootstrap script (macOS & Fedora)
└── README.md
```

---

## ⚡ Quick Restore (macOS & Fedora Linux)

Run the exact same two commands on either **macOS** or **Fedora Linux**:

```bash
git clone https://github.com/mrbvrz/dotfiles.git ~/.dotfiles
~/.dotfiles/install.sh
```

### What `install.sh` Provides Automatically:
- **On macOS**: Installs Homebrew (if missing), runs `brew bundle` (installing CLI tools, `alacritty`, `zed`, `zellij`, `mise`, and `font-commit-mono-nerd-font`), installs Oh My Zsh, symlinks all configurations (`zsh`, `spaceship`, `git`, `alacritty`, `zellij`, `zed`, `mise`) using `stow`, and installs global runtimes via `mise`.
- **On Fedora Linux**: Installs CLI packages and **Alacritty** via `dnf`, installs **mise** via COPR, downloads & caches **CommitMono Nerd Font**, installs **Zed**, `lazygit`, `yazi`, `zellij`, and `lazydocker`, installs Oh My Zsh & Spaceship Prompt, sets `zsh` as the default shell, symlinks all configurations using `stow`, and installs global runtimes via `mise`.

To update the macOS `Brewfile` and push changes at any time, simply run:
```zsh
dotsync
```

---

## ⌨️ Keybindings & Power Commands

| Shortcut / Command | Tool | Description |
| :--- | :--- | :--- |
| `z <dir>` | **zoxide** | Jump instantaneously to frequently used directories (smart `cd` replacement) |
| `zi` | **zoxide + fzf** | Interactive directory selection |
| `Ctrl + R` | **fzf** | Interactive fuzzy search through command history |
| `Ctrl + T` | **fzf + fd + bat** | Fuzzy find files in the current directory with syntax-highlighted preview |
| `Alt + C` | **fzf + eza** | Fuzzy find subdirectories with tree preview |
| `y` | **yazi** | Terminal file manager (automatically changes working directory when exiting with `q`) |
| `Cmd + N` | **Alacritty** | Open a new independent Alacritty terminal window (auto `SPACE01..N`) |
| `Cmd + Enter` / `Cmd + Ctrl + F` | **Alacritty** | Toggle Fullscreen window (or `F11`) |
| `Cmd + Option + F` / `M` | **Alacritty** | Toggle Simple Fullscreen (borderless on screen) / Maximize window |
| `Cmd + T` / `Cmd + W` | **Zellij** | Open new tab / Close focused pane or tab (exits window when last tab closes) |
| `Cmd + D` / `Cmd + Shift + D` | **Zellij** | Split pane Right / Split pane Down |
| `Cmd + Option + ← / → / ↑ / ↓` | **Zellij** | Navigate focus between split panes (or `Alt + h / j / k / l`) |
| `Cmd + Ctrl + ← / → / ↑ / ↓` | **Zellij** | Resize split pane in direction (or `Cmd + Option + = / -`) |
| `Cmd + Shift + Enter` | **Zellij** | Toggle Zoom / Maximize focused pane to full-screen |
| `Cmd + Shift + F` | **Zellij** | Toggle Floating pane mode |
| `Cmd + Option + [` / `]` | **Zellij** | Swap / rotate split pane layout arrangement |
| `Cmd + 1..9` | **Zellij** | Switch directly to Tab 1..9 |
| `Cmd + Shift + R` | **Zellij** | Rename active tab manually (`zellij-tabula` auto-names tabs by CWD/Git repo) |
| `Cmd + F` / `Ctrl + F` | **Zellij** | Live bottom-bar search overlay (`↑`/`↓` jump matches, `Enter` confirm, `Esc` cancel) |
| `Cmd + P` / `Alt + m` | **Monocle** | Floating fuzzy finder for project filenames & file contents |
| `lzj` / `lz` | **lazy-zellij** | Interactive `fzf` Zellij session manager with live tab/pane/screen preview |
| `zj` / `zja` | **zellij** | Open Zellij multiplexer (`zja` attaches/creates persistent `SPACE01` workspace) |
| `lg` | **lazygit** | Full-featured Terminal UI for Git |
| `git st` / `git lg` | **Git Aliases** | Compact Git status (`-sb`) and colorful branching commit graph |
| `ld` | **lazydocker** | Full-featured Terminal UI for Docker & Docker Compose |
| `ls` / `ll` / `lt` | **eza** | Modern file listing with icons (`lt` for a 2-level tree view) |
| `cat <file>` | **bat** | Syntax-highlighted file viewer |
| `top` | **btop** | Visual system monitor (CPU, RAM, Disk, Network, Processes) |
| `df` / `du` | **duf** / **dust** | Visual disk space (`df`) and directory size (`du`) analyzers |
| `pbcopy` / `pbpaste` | **Clipboard** | Universal clipboard commands (works natively on macOS and via Wayland/X11 on Fedora) |
| `mkcd <dir>` | **Zsh Function** | Create a new directory and `cd` into it immediately |
| `ports` | **Zsh Function** | List active listening TCP ports (`lsof` on macOS, `ss -tulpn` on Fedora) |
| `reload` | **Zsh Alias** | Reload Zsh session (`exec zsh`) |
| `dotfiles` | **Zsh Alias** | Jump directly to `~/.dotfiles` |
| `dotcheck` / `doctor` | **Diagnostics** | Run universal dotfiles health check (validates tools, symlinks, plugins, and patches) |
| `dotsync [msg]` | **Zsh Function** | One-command sync: updates `Brewfile`, restows symlinks, commits, and pushes to GitHub |
