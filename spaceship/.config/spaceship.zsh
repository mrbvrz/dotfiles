# ==============================================================================
# Spaceship Prompt Configuration (~/.config/spaceship.zsh)
# Style: Modern & Clean (2-line, Arrow symbol, Developer Stack + RPROMPT Time)
# Docs: https://spaceship-prompt.sh/config/prompt/
# ==============================================================================

# ------------------------------------------------------------------------------
# Left Prompt Order
# Only load relevant sections for faster async rendering and a clean look
# ------------------------------------------------------------------------------
SPACESHIP_PROMPT_ORDER=(
  user           # Username
  dir            # Current directory
  git            # Git branch & status
  package        # Package version (package.json, composer.json, pubspec.yaml, etc.)
  node           # Node.js version
  bun            # Bun version
  golang         # Go version
  php            # PHP version
  dart           # Dart / Flutter version
  docker         # Docker version & context
  exec_time      # Execution time
  async          # Async jobs indicator
  line_sep       # Line break (2-line prompt)
  battery        # Battery level indicator
  jobs           # Background jobs indicator
  exit_code      # Exit code for failed commands
  sudo           # Active sudo indicator
  char           # Prompt character (➜)
)

# ------------------------------------------------------------------------------
# Right Prompt Order (RPROMPT)
# ------------------------------------------------------------------------------
SPACESHIP_RPROMPT_ORDER=(
  time           # Timestamp on the right side
)

# ------------------------------------------------------------------------------
# Layout & Performance Settings
# ------------------------------------------------------------------------------
SPACESHIP_PROMPT_ASYNC=true
SPACESHIP_PROMPT_ADD_NEWLINE=true
SPACESHIP_PROMPT_SEPARATE_LINE=true
SPACESHIP_PROMPT_FIRST_PREFIX_SHOW=false
SPACESHIP_RPROMPT_FIRST_PREFIX_SHOW=true
SPACESHIP_PROMPT_PREFIXES_SHOW=true
SPACESHIP_PROMPT_SUFFIXES_SHOW=true
SPACESHIP_PROMPT_DEFAULT_PREFIX="via "
SPACESHIP_PROMPT_DEFAULT_SUFFIX=" "

# ------------------------------------------------------------------------------
# Prompt Character (Arrow)
# ------------------------------------------------------------------------------
SPACESHIP_CHAR_SYMBOL="➜ "
SPACESHIP_CHAR_SYMBOL_SUCCESS="➜ "
SPACESHIP_CHAR_SYMBOL_FAILURE="➜ "
SPACESHIP_CHAR_SYMBOL_SECONDARY="➜ "
SPACESHIP_CHAR_SYMBOL_ROOT="# "
SPACESHIP_CHAR_COLOR_SUCCESS="green"
SPACESHIP_CHAR_COLOR_FAILURE="red"
SPACESHIP_CHAR_COLOR_SECONDARY="yellow"

# ------------------------------------------------------------------------------
# User & Hostname (Display username only)
# ------------------------------------------------------------------------------
SPACESHIP_USER_SHOW="always"
SPACESHIP_USER_PREFIX=""
SPACESHIP_USER_SUFFIX=" "
SPACESHIP_USER_COLOR="yellow"

SPACESHIP_HOST_SHOW=false

# ------------------------------------------------------------------------------
# Directory (Display current folder name only)
# ------------------------------------------------------------------------------
SPACESHIP_DIR_SHOW=true
SPACESHIP_DIR_PREFIX="in "
SPACESHIP_DIR_TRUNC=1
SPACESHIP_DIR_TRUNC_PREFIX=""
SPACESHIP_DIR_TRUNC_REPO=false
SPACESHIP_DIR_COLOR="cyan"

# ------------------------------------------------------------------------------
# Git (Branch & Status)
# ------------------------------------------------------------------------------
SPACESHIP_GIT_SHOW=true
SPACESHIP_GIT_PREFIX="on "
SPACESHIP_GIT_BRANCH_COLOR="magenta"
SPACESHIP_GIT_STATUS_COLOR="red"

# ------------------------------------------------------------------------------
# Execution Time
# ------------------------------------------------------------------------------
SPACESHIP_EXEC_TIME_SHOW=true
SPACESHIP_EXEC_TIME_PREFIX="took "
SPACESHIP_EXEC_TIME_ELAPSED=2
SPACESHIP_EXEC_TIME_COLOR="yellow"

# ------------------------------------------------------------------------------
# Battery (Display only when low battery <= 20%)
# ------------------------------------------------------------------------------
SPACESHIP_BATTERY_SHOW=true
SPACESHIP_BATTERY_PREFIX=""
SPACESHIP_BATTERY_SUFFIX=" "
SPACESHIP_BATTERY_THRESHOLD=20

# ------------------------------------------------------------------------------
# Time / Timestamp (Right Prompt)
# ------------------------------------------------------------------------------
SPACESHIP_TIME_SHOW=true
SPACESHIP_TIME_PREFIX=""
SPACESHIP_TIME_SUFFIX=""
SPACESHIP_TIME_FORMAT="%D{%H:%M:%S}"
SPACESHIP_TIME_COLOR="244"
