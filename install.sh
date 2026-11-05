#!/usr/bin/env bash
# ==============================================================================
# Universal Dotfiles Bootstrap Script (macOS & Fedora / Linux)
# Usage: ~/.dotfiles/install.sh
# ==============================================================================
set -e

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OS_TYPE="$(uname -s)"

echo "==> Starting Universal Dotfiles setup from $DOTFILES_DIR ($OS_TYPE)..."

# ------------------------------------------------------------------------------
# 1. OS-Specific Package & Alacritty Installation
# ------------------------------------------------------------------------------
if [[ "$OS_TYPE" == "Darwin" ]]; then
  echo "==> Detected macOS"

  if ! command -v brew >/dev/null 2>&1; then
    echo "==> Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    [[ -x /opt/homebrew/bin/brew ]] && eval "$(/opt/homebrew/bin/brew shellenv)"
    [[ -x /usr/local/bin/brew ]] && eval "$(/usr/local/bin/brew shellenv)"
  fi

  if [[ -f "$DOTFILES_DIR/Brewfile" ]]; then
    echo "==> Installing Homebrew packages & Alacritty from Brewfile..."
    brew bundle --file="$DOTFILES_DIR/Brewfile" || true
  fi

elif [[ "$OS_TYPE" == "Linux" ]]; then
  if [[ -f /etc/fedora-release ]] || command -v dnf >/dev/null 2>&1; then
    echo "==> Detected Fedora / RHEL-based Linux (dnf)"

    sudo dnf install -y \
      zsh git stow curl wget unzip tar util-linux-user fontconfig \
      alacritty fzf fd-find ripgrep bat zoxide git-delta btop duf gh jq \
      zsh-autosuggestions zsh-syntax-highlighting wl-clipboard xclip

    # Install mise (polyglot runtime manager) on Fedora
    if ! command -v mise >/dev/null 2>&1; then
      echo "==> Installing mise via COPR (jdxcode/mise)..."
      sudo dnf copr enable -y jdxcode/mise || true
      sudo dnf install -y mise || curl -fsSL https://mise.run | sh
    fi

    # Enable COPR repos for CLI tools not in standard Fedora repo
    if ! command -v lazygit >/dev/null 2>&1; then
      sudo dnf copr enable -y atim/lazygit || true
      sudo dnf install -y lazygit || true
    fi

    if ! command -v eza >/dev/null 2>&1; then
      sudo dnf install -y eza || true
    fi

    if ! command -v dust >/dev/null 2>&1; then
      sudo dnf install -y du-dust || true
    fi

    if ! command -v yazi >/dev/null 2>&1; then
      sudo dnf copr enable -y lihaohong/yazi || true
      sudo dnf install -y yazi || true
    fi

    if ! command -v zellij >/dev/null 2>&1; then
      sudo dnf copr enable -y varlad/zellij || true
      sudo dnf install -y zellij || true
    fi

    if ! command -v zed >/dev/null 2>&1; then
      echo "==> Installing Zed IDE on Linux..."
      curl -f https://zed.dev/install.sh | sh || true
    fi

    if ! command -v lazydocker >/dev/null 2>&1; then
      curl -fsSL https://raw.githubusercontent.com/jesseduffield/lazydocker/master/scripts/install_update_linux.sh | bash || true
    fi

  elif command -v apt-get >/dev/null 2>&1; then
    echo "==> Detected Debian/Ubuntu Linux (apt)"
    sudo apt-get update
    sudo apt-get install -y \
      zsh git stow curl wget unzip fontconfig alacritty fzf fd-find ripgrep bat zoxide btop duf jq \
      zsh-autosuggestions zsh-syntax-highlighting xclip wl-clipboard || true
  fi

  # Install CommitMono Nerd Font on Linux if not already present
  FONT_DIR="$HOME/.local/share/fonts/CommitMonoNerdFont"
  if [[ ! -d "$FONT_DIR" ]]; then
    echo "==> Installing CommitMono Nerd Font to $FONT_DIR..."
    mkdir -p "$FONT_DIR"
    curl -fsSL -o /tmp/CommitMono.tar.xz "https://github.com/ryanoasis/nerd-fonts/releases/latest/download/CommitMono.tar.xz" && \
      tar -xf /tmp/CommitMono.tar.xz -C "$FONT_DIR" && \
      rm -f /tmp/CommitMono.tar.xz && \
      fc-cache -fv "$FONT_DIR" || true
  fi
fi

# ------------------------------------------------------------------------------
# 2. Oh My Zsh & Spaceship Prompt Installation
# ------------------------------------------------------------------------------
if [[ ! -d "$HOME/.oh-my-zsh" ]]; then
  echo "==> Installing Oh My Zsh..."
  RUNZSH=no CHSH=no sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
fi

# Install Spaceship Prompt via git clone on Linux (if not installed via Homebrew)
if [[ "$OS_TYPE" == "Linux" ]]; then
  SPACESHIP_DIR="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/spaceship-prompt"
  if [[ ! -d "$SPACESHIP_DIR" ]]; then
    echo "==> Installing Spaceship Prompt to $SPACESHIP_DIR..."
    git clone --depth=1 https://github.com/spaceship-prompt/spaceship-prompt.git "$SPACESHIP_DIR"
  else
    echo "==> Updating Spaceship Prompt..."
    git -C "$SPACESHIP_DIR" pull --ff-only || true
  fi
fi

# ------------------------------------------------------------------------------
# 3. Symlink Configurations Using GNU Stow
# ------------------------------------------------------------------------------
mkdir -p \
  "$HOME/.local/bin" \
  "$HOME/.config/alacritty" \
  "$HOME/.config/zellij/layouts" \
  "$HOME/.config/zellij/plugins" \
  "$HOME/.config/zed" \
  "$HOME/.config/mise" \
  "$HOME/.config/lazygit" \
  "$HOME/.config/lazydocker" \
  "$HOME/.config/yazi" \
  "$HOME/.config/btop/themes"

# Backup existing non-symlink files before stowing
for target_file in \
  "$HOME/.zshrc" \
  "$HOME/.zshenv" \
  "$HOME/.zprofile" \
  "$HOME/.gitconfig" \
  "$HOME/.gitignore_global" \
  "$HOME/.config/spaceship.zsh" \
  "$HOME/.config/alacritty/alacritty.toml" \
  "$HOME/.config/zellij/config.kdl" \
  "$HOME/.config/zellij/layouts/compact.kdl" \
  "$HOME/.config/zed/settings.json" \
  "$HOME/.config/mise/config.toml" \
  "$HOME/.config/lazygit/config.yml" \
  "$HOME/.config/lazydocker/config.yml" \
  "$HOME/.config/yazi/yazi.toml" \
  "$HOME/.config/yazi/theme.toml" \
  "$HOME/.config/btop/btop.conf" \
  "$HOME/.config/btop/themes/min-dark.theme"; do
  if [[ -f "$target_file" && ! -L "$target_file" ]]; then
    mv "$target_file" "${target_file}.bak"
  fi
done

echo "==> Linking dotfiles with GNU Stow..."
stow --restow --dir="$DOTFILES_DIR" --target="$HOME" \
  zsh spaceship git alacritty zellij zed mise bin lazygit lazydocker yazi btop bat herdr

# macOS Lazydocker support: ensure Application Support points to XDG config
if [[ "$OS_TYPE" == "Darwin" ]]; then
  LAZYDOCKER_APP_DIR="$HOME/Library/Application Support/lazydocker"
  mkdir -p "$LAZYDOCKER_APP_DIR"
  if [[ ! -L "$LAZYDOCKER_APP_DIR/config.yml" ]]; then
    rm -f "$LAZYDOCKER_APP_DIR/config.yml"
    ln -s "$HOME/.config/lazydocker/config.yml" "$LAZYDOCKER_APP_DIR/config.yml"
  fi
fi

# Pre-grant Zellij permissions for bundled local plugins (zellij-tabula & monocle)
if [[ "$OS_TYPE" == "Darwin" ]]; then
  ZJ_CACHE_DIR="$HOME/Library/Caches/org.Zellij-Contributors.Zellij"
else
  ZJ_CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/zellij"
fi
mkdir -p "$ZJ_CACHE_DIR"
cat > "$ZJ_CACHE_DIR/permissions.kdl" <<EOF
"$HOME/.config/zellij/plugins/zellij-tabula.wasm" {
    ChangeApplicationState
    ReadApplicationState
    RunCommands
    ReadCliPipes
}
"$HOME/.config/zellij/plugins/monocle.wasm" {
    ChangeApplicationState
    ReadApplicationState
    OpenFiles
    OpenTerminalsOrPlugins
    RunCommands
}
"$HOME/.config/zellij/plugins/grab.wasm" {
    ChangeApplicationState
    ReadApplicationState
    OpenFiles
    OpenTerminalsOrPlugins
    RunCommands
}
EOF

# Apply macOS Alacritty native shadow patch & Zellij custom compact-bar patch
if [[ "$OS_TYPE" == "Darwin" ]] && [[ -f "$DOTFILES_DIR/scripts/macos-alacritty-shadow.py" ]]; then
  python3 "$DOTFILES_DIR/scripts/macos-alacritty-shadow.py" || true
fi
if [[ -f "$DOTFILES_DIR/scripts/zellij-brand-prefix.py" ]]; then
  python3 "$DOTFILES_DIR/scripts/zellij-brand-prefix.py" || true
fi

# Install global runtimes configured in ~/.config/mise/config.toml
if command -v mise >/dev/null 2>&1; then
  echo "==> Installing global runtimes via mise..."
  mise install --yes || true
fi

# ------------------------------------------------------------------------------
# 4. Secrets File & Default Shell
# ------------------------------------------------------------------------------
if [[ ! -f "$HOME/.zshenv.local" ]]; then
  echo "==> Creating ~/.zshenv.local for local secrets..."
  touch "$HOME/.zshenv.local"
  chmod 600 "$HOME/.zshenv.local"
fi

if [[ ! -f "$HOME/.gitconfig.local" ]]; then
  echo "==> Creating ~/.gitconfig.local for local Git identity overrides..."
  touch "$HOME/.gitconfig.local"
  chmod 600 "$HOME/.gitconfig.local"
fi

if [[ "$SHELL" != *"zsh"* ]] && command -v zsh >/dev/null 2>&1; then
  echo "==> Changing default shell to zsh..."
  chsh -s "$(command -v zsh)" || true
fi

# ------------------------------------------------------------------------------
# 5. Health & Diagnostics Check
# ------------------------------------------------------------------------------
if [[ -x "$DOTFILES_DIR/bin/.local/bin/dotcheck" ]]; then
  "$DOTFILES_DIR/bin/.local/bin/dotcheck" || true
fi

echo "==> Universal Dotfiles setup complete! Run 'exec zsh' to start."
