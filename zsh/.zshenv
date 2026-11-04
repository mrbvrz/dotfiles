# ==============================================================================
# Universal Zsh Environment (~/.zshenv) — macOS & Linux (Fedora)
# Managed via GNU Stow in ~/.dotfiles/zsh/.zshenv
# ==============================================================================

# Expose mise shims to non-interactive shells (IDEs, GUI apps, Git hooks)
[[ -d "$HOME/.local/share/mise/shims" ]] && export PATH="$HOME/.local/share/mise/shims:$PATH"

# Load Rust / Cargo environment if installed
[[ -f "$HOME/.cargo/env" ]] && . "$HOME/.cargo/env"
