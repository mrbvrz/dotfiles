# ==============================================================================
# Universal Zsh Login Profile (~/.zprofile) — macOS & Linux (Fedora)
# Managed via GNU Stow in ~/.dotfiles/zsh/.zprofile
# ==============================================================================

# Initialize Homebrew environment if available
for brew_bin in /opt/homebrew/bin/brew /usr/local/bin/brew /home/linuxbrew/.linuxbrew/bin/brew; do
  if [[ -x "$brew_bin" ]]; then
    eval "$("$brew_bin" shellenv)"
    break
  fi
done

# Ensure ~/.local/bin is in PATH for login shells
export PATH="$HOME/.local/bin:$PATH"
