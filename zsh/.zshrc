# ==============================================================================
# Universal Zsh Configuration (~/.zshrc) — macOS & Linux (Fedora)
# Managed via GNU Stow in ~/.dotfiles/zsh/.zshrc
# ==============================================================================

# Ensure $PATH never contains duplicate entries
typeset -U path PATH

# OS Detection
IS_MACOS=false
IS_LINUX=false
case "$OSTYPE" in
  darwin*) IS_MACOS=true ;;
  linux*)  IS_LINUX=true ;;
esac

# Initialize Homebrew if available (macOS Apple Silicon, Intel, or Linuxbrew)
if [[ -z "$HOMEBREW_PREFIX" ]]; then
  for brew_bin in /opt/homebrew/bin/brew /usr/local/bin/brew /home/linuxbrew/.linuxbrew/bin/brew; do
    if [[ -x "$brew_bin" ]]; then
      eval "$("$brew_bin" shellenv)"
      break
    fi
  done
fi

# ------------------------------------------------------------------------------
# 1. Environment Variables & PATH (Cross-Platform)
# ------------------------------------------------------------------------------
export XDG_CONFIG_HOME="$HOME/.config"
export HOMEBREW_NO_INSTALL_CLEANUP=TRUE
export EDITOR="zed --wait"
export VISUAL="zed --wait"

# Local binaries (cua-driver, pipx, cargo/local installs)
export PATH="$HOME/.local/bin:$PATH"

# OS-specific environment (macOS vs Linux/Fedora)
if $IS_MACOS; then
  export CHROME_EXECUTABLE="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
  export PNPM_HOME="$HOME/Library/pnpm"
else
  export PNPM_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/pnpm"
fi
[[ -d "$PNPM_HOME" ]] && export PATH="$PNPM_HOME:$PATH"

# Bun global packages
export BUN_INSTALL="$HOME/.bun"
[[ -d "$BUN_INSTALL/bin" ]] && export PATH="$BUN_INSTALL/bin:$PATH"

# Go
export GOPATH="$HOME/.go"
[[ -d "$GOPATH/bin" ]] && export PATH="$GOPATH/bin:$PATH"

# Composer (PHP: macOS ~/.composer or Linux ~/.config/composer)
if [[ -d "$HOME/.composer/vendor/bin" ]]; then
  export COMPOSER_HOME="$HOME/.composer"
  export PATH="$COMPOSER_HOME/vendor/bin:$PATH"
elif [[ -d "$HOME/.config/composer/vendor/bin" ]]; then
  export COMPOSER_HOME="$HOME/.config/composer"
  export PATH="$COMPOSER_HOME/vendor/bin:$PATH"
fi

# Flutter & Dart
export FLUTTER_HOME="$HOME/.development/flutter"
[[ -d "$FLUTTER_HOME/bin" ]] && export PATH="$FLUTTER_HOME/bin:$PATH"

# Android SDK (macOS / Linux)
if [[ -d "$HOME/.development/android-sdk" ]]; then
  export ANDROID_HOME="$HOME/.development/android-sdk"
elif [[ -d "$HOME/Android/Sdk" ]]; then
  export ANDROID_HOME="$HOME/Android/Sdk"
fi
if [[ -n "$ANDROID_HOME" ]]; then
  export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
fi

# Antigravity CLI
[[ -d "$HOME/.antigravity/antigravity/bin" ]] && export PATH="$HOME/.antigravity/antigravity/bin:$PATH"

# Load local/secret environment variables (not committed to Git)
[[ -f "$HOME/.zshenv.local" ]] && source "$HOME/.zshenv.local"

# ------------------------------------------------------------------------------
# 2. Smart History & Shell Options (Power-User Tuning)
# ------------------------------------------------------------------------------
HISTFILE="$HOME/.zsh_history"
HISTSIZE=50000
SAVEHIST=50000

setopt EXTENDED_HISTORY          # Record timestamp in history
setopt HIST_EXPIRE_DUPS_FIRST    # Expire duplicate entries first when trimming history
setopt HIST_IGNORE_DUPS          # Do not record an entry that was just recorded again
setopt HIST_IGNORE_ALL_DUPS      # Delete old recorded entry if new entry is a duplicate
setopt HIST_FIND_NO_DUPS         # Do not display a line previously found
setopt HIST_IGNORE_SPACE         # Do not record an entry starting with a space
setopt HIST_VERIFY               # Show command with history expansion before running it
setopt SHARE_HISTORY             # Share history across all active terminal sessions
setopt AUTO_CD                   # Change directory by typing folder name without 'cd'
setopt INTERACTIVE_COMMENTS      # Allow '#' comments in interactive shell

# ------------------------------------------------------------------------------
# 3. Completions & Oh My Zsh (Optimized with 24-hour compinit cache)
# ------------------------------------------------------------------------------
export ZSH="$HOME/.oh-my-zsh"
export ZSH_DISABLE_COMPFIX="true"
export DISABLE_AUTO_UPDATE="true"
ZSH_THEME=""
ZSH_COLORIZE_STYLE="colorful"

# Add Docker CLI completions to fpath before compinit is executed by Oh My Zsh
[[ -d "$HOME/.docker/completions" ]] && fpath=("$HOME/.docker/completions" $fpath)

plugins=(git aliases npm colorize)

# 24-hour smart cache for compinit (reduces shell startup time by ~100ms)
ZSH_COMPDUMP="${ZDOTDIR:-$HOME}/.zcompdump-${HOST%%.*}-$ZSH_VERSION"
if [[ -f "$ZSH_COMPDUMP" && -n "$ZSH_COMPDUMP"(#qN.mh+24) || ! -f "$ZSH_COMPDUMP" ]]; then
  autoload -Uz compinit && compinit -d "$ZSH_COMPDUMP"
  zcompile "$ZSH_COMPDUMP" 2>/dev/null
else
  autoload -Uz compinit && compinit -C -d "$ZSH_COMPDUMP"
fi
compinit() { : } # prevent OMZ from running redundant uncached compinit

[[ -f "$ZSH/oh-my-zsh.sh" ]] && source "$ZSH/oh-my-zsh.sh"
unfunction compinit # restore normal compinit after OMZ is loaded

# Bun completions
[[ -s "$HOME/.bun/_bun" ]] && source "$HOME/.bun/_bun"

# Keybindings: Up/Down arrows search history matching current line prefix
autoload -U up-line-or-beginning-search down-line-or-beginning-search
zle -N up-line-or-beginning-search
zle -N down-line-or-beginning-search
bindkey "^[[A" up-line-or-beginning-search
bindkey "^[[B" down-line-or-beginning-search
bindkey "${terminfo[kcuu1]:-^[[A}" up-line-or-beginning-search
bindkey "${terminfo[kcud1]:-^[[B}" down-line-or-beginning-search

# ------------------------------------------------------------------------------
# 4. Modern CLI Integrations (mise, fzf, fd, zoxide, yazi)
# ------------------------------------------------------------------------------
# mise (Polyglot runtime manager: Node, Bun, pnpm, Go, Python, Ruby)
if command -v mise >/dev/null 2>&1; then
  eval "$(mise activate zsh)"
fi

# Normalize fd & bat binary names across Linux distributions
FD_BIN="fd"
command -v fd >/dev/null 2>&1 || { command -v fdfind >/dev/null 2>&1 && FD_BIN="fdfind"; }
BAT_BIN="bat"
command -v bat >/dev/null 2>&1 || { command -v batcat >/dev/null 2>&1 && BAT_BIN="batcat"; }

# fzf + fd + bat + eza integration (cached init script for speed)
if command -v fzf >/dev/null 2>&1; then
  _fzf_cache="${XDG_CACHE_HOME:-$HOME/.cache}/zsh/fzf.zsh"
  if [[ ! -f "$_fzf_cache" || "$(command -v fzf)" -nt "$_fzf_cache" ]]; then
    mkdir -p "${_fzf_cache:h}"
    if fzf --zsh >/dev/null 2>&1; then
      fzf --zsh > "$_fzf_cache" 2>/dev/null
    elif [[ -f /usr/share/fzf/shell/key-bindings.zsh ]]; then
      cat /usr/share/fzf/shell/key-bindings.zsh > "$_fzf_cache"
    fi
  fi
  [[ -f "$_fzf_cache" ]] && source "$_fzf_cache"

  if command -v "$FD_BIN" >/dev/null 2>&1; then
    export FZF_DEFAULT_COMMAND="$FD_BIN --type f --hidden --follow --exclude .git"
    export FZF_CTRL_T_COMMAND="$FZF_DEFAULT_COMMAND"
    export FZF_ALT_C_COMMAND="$FD_BIN --type d --hidden --follow --exclude .git"
  fi

  # Min Dark color scheme for fzf
  export FZF_DEFAULT_OPTS="--height 45% --layout=reverse --border=rounded --info=inline \
    --color=bg+:#2A2A2A,bg:#1A1A1A,spinner:#79B8FF,hl:#B392F1 \
    --color=fg:#BBBBBB,header:#79B8FF,info:#FFAB70,pointer:#FA7584 \
    --color=marker:#79B8FF,fg+:#F8F8F8,prompt:#B392F1,hl+:#79B8FF"
  export FZF_CTRL_T_OPTS="--preview '$BAT_BIN --color=always --theme=TwoDark --style=numbers --line-range=:200 {} 2>/dev/null || eza --tree --level=2 --color=always {}'"
  export FZF_ALT_C_OPTS="--preview 'eza --tree --level=2 --icons --color=always {}'"
fi

# zoxide (Smart cd replacement: use 'z <dir>' and 'zi' for interactive selection - cached)
if command -v zoxide >/dev/null 2>&1; then
  _zoxide_cache="${XDG_CACHE_HOME:-$HOME/.cache}/zsh/zoxide.zsh"
  if [[ ! -f "$_zoxide_cache" || "$(command -v zoxide)" -nt "$_zoxide_cache" ]]; then
    mkdir -p "${_zoxide_cache:h}"
    zoxide init zsh > "$_zoxide_cache" 2>/dev/null
  fi
  [[ -f "$_zoxide_cache" ]] && source "$_zoxide_cache"
fi

# yazi wrapper ('y'): automatically change working directory when exiting yazi with 'q'
if command -v yazi >/dev/null 2>&1; then
  function y() {
    local tmp="$(mktemp -t "yazi-cwd.XXXXXX")" cwd
    yazi "$@" --cwd-file="$tmp"
    if cwd="$(command cat -- "$tmp")" && [ -n "$cwd" ] && [ "$cwd" != "$PWD" ]; then
      builtin cd -- "$cwd"
    fi
    rm -f -- "$tmp"
  }
fi

# ------------------------------------------------------------------------------
# 5. Aliases & Power Helper Functions
# ------------------------------------------------------------------------------
# File & Directory
if command -v eza >/dev/null 2>&1; then
  alias ls="eza --icons --group-directories-first"
  alias ll="eza --icons --group-directories-first -lah"
  alias lt="eza --icons --group-directories-first --tree --level=2"
else
  alias ll="ls -lah --color=auto"
fi

command -v "$BAT_BIN" >/dev/null 2>&1 && alias cat="$BAT_BIN --paging=never"
[[ "$FD_BIN" == "fdfind" ]] && alias fd="fdfind"

# Git, Docker & Workspace TUI
command -v lazygit >/dev/null 2>&1 && alias lg="lazygit"
command -v lazydocker >/dev/null 2>&1 && alias ld="lazydocker"
command -v zellij >/dev/null 2>&1 && alias zj="zellij"
command -v zellij >/dev/null 2>&1 && alias zja="zellij attach -c SPACE01"

# System & Disk Monitoring
command -v btop >/dev/null 2>&1 && alias top="btop"
command -v duf >/dev/null 2>&1 && alias df="duf"
command -v dust >/dev/null 2>&1 && alias du="dust"

# Universal clipboard & file opener aliases on Linux/Fedora
if $IS_LINUX; then
  if command -v wl-copy >/dev/null 2>&1; then
    alias pbcopy="wl-copy"
    alias pbpaste="wl-paste"
  elif command -v xclip >/dev/null 2>&1; then
    alias pbcopy="xclip -selection clipboard"
    alias pbpaste="xclip -selection clipboard -o"
  fi
  alias open="xdg-open"
fi

# Quick Config Reload, IDE & Dotfiles
alias code="zed"
alias reload="exec zsh"
alias dotfiles="cd ~/.dotfiles"
alias dotcheck="dotcheck"
alias doctor="dotcheck"

# Sync dotfiles (update Brewfile on macOS, restow symlinks, re-apply patches, commit & push)
function dotsync() {
  local msg="${1:-chore: sync dotfiles and package list}"
  echo "==> Syncing ~/.dotfiles..."
  if $IS_MACOS && command -v brew >/dev/null 2>&1; then
    echo "==> Updating Brewfile..."
    brew bundle dump --file="$HOME/.dotfiles/Brewfile" --force
  fi
  stow --restow --dir="$HOME/.dotfiles" --target="$HOME" \
    zsh spaceship git alacritty zellij zed mise bin lazygit yazi btop bat
  if $IS_MACOS && [[ -f "$HOME/.dotfiles/scripts/macos-alacritty-shadow.py" ]]; then
    python3 "$HOME/.dotfiles/scripts/macos-alacritty-shadow.py" >/dev/null 2>&1 || true
  fi
  if [[ -f "$HOME/.dotfiles/scripts/zellij-brand-prefix.py" ]]; then
    python3 "$HOME/.dotfiles/scripts/zellij-brand-prefix.py" >/dev/null 2>&1 || true
  fi
  git -C "$HOME/.dotfiles" add -A
  if git -C "$HOME/.dotfiles" diff --cached --quiet; then
    echo "==> No changes to commit. Everything is up to date!"
  else
    git -C "$HOME/.dotfiles" commit -m "$msg" && git -C "$HOME/.dotfiles" push
    echo "==> Dotfiles successfully pushed to GitHub!"
  fi
}

# Create a new directory and enter it immediately
function mkcd() {
  mkdir -p "$@" && cd "$_"
}

# List active/listening TCP ports (macOS lsof & Linux ss/lsof)
function ports() {
  if $IS_LINUX && command -v ss >/dev/null 2>&1; then
    sudo ss -tulpn
  else
    lsof -iTCP -sTCP:LISTEN -P -n
  fi
}

# ------------------------------------------------------------------------------
# 6. Prompt (Spaceship — macOS & Linux)
# ------------------------------------------------------------------------------
# Locate and load Spaceship Prompt (Homebrew, Oh My Zsh Custom, or System paths)
for spaceship_path in \
  "$HOMEBREW_PREFIX/opt/spaceship/spaceship.zsh" \
  "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/spaceship-prompt/spaceship.zsh" \
  "$HOME/.local/share/spaceship-prompt/spaceship.zsh" \
  "/usr/local/share/spaceship/spaceship.zsh" \
  "/usr/share/spaceship/spaceship.zsh"; do
  if [[ -f "$spaceship_path" ]]; then
    source "$spaceship_path"
    break
  fi
done

# ------------------------------------------------------------------------------
# 7. Zsh Plugins (Must be loaded at the very end — macOS & Linux/Fedora)
# ------------------------------------------------------------------------------
for autosug_path in \
  "$HOMEBREW_PREFIX/share/zsh-autosuggestions/zsh-autosuggestions.zsh" \
  "/usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh" \
  "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh"; do
  if [[ -f "$autosug_path" ]]; then
    source "$autosug_path"
    break
  fi
done

for syntax_path in \
  "$HOMEBREW_PREFIX/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh" \
  "/usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh" \
  "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh"; do
  if [[ -f "$syntax_path" ]]; then
    source "$syntax_path"
    break
  fi
done

# ------------------------------------------------------------------------------
# 8. Auto-Start Zellij Workspace in Alacritty (Minimal Bottom Tab Bar)
# ------------------------------------------------------------------------------
if [[ -o interactive && -t 0 ]] && [[ -z "$ZELLIJ" ]] && [[ "$TERM_PROGRAM" == "Alacritty" || -n "$ALACRITTY_WINDOW_ID" ]]; then
  if command -v zellij >/dev/null 2>&1; then
    _zj_sessions="$(zellij list-sessions -n -s 2>/dev/null)"
    typeset -i _zj_idx=1
    while print -r -- "$_zj_sessions" | grep -qx "$(printf 'SPACE%02d' $_zj_idx)"; do
      ((_zj_idx++))
    done
    _zj_name="$(printf 'SPACE%02d' $_zj_idx)"
    unset _zj_idx _zj_sessions
    # Keep the Alacritty window title in sync with the Zellij badge (MRBVRZ-SPACE01, ...)
    print -Pn "\e]0;MRBVRZ-${_zj_name}\a"
    exec zellij -s "$_zj_name"
  fi
fi
