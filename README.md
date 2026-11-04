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
| **Terminal Emulator** | **Alacritty** + **CommitMono Nerd Font** | Cross-platform OpenGL/Metal GPU-accelerated terminal with Min Dark (Blurred) theme & live reload |
| **Multiplexer** | **Zellij** (`zj` / `zja`) | Modern Rust workspace multiplexer for tabs, split panes, and persistent sessions |
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
│   └── .config/zellij/layouts/compact.kdl # -> ~/.config/zellij/layouts/compact.kdl
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
│   └── zellij-brand-prefix.py           # Replaces Zellij bottom-bar prefix with mrbvrz-space01..N
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
| `zj` / `zja` | **zellij** | Open Zellij multiplexer (`zja` attaches/creates persistent `main` workspace) |
| `lg` | **lazygit** | Full-featured Terminal UI for Git |
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
| `dotsync [msg]` | **Zsh Function** | One-command sync: updates `Brewfile`, restows symlinks, commits, and pushes to GitHub |
