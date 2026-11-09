#!/bin/sh
# usage: fetch-avatar.sh <host> <owner>
# Saves the owner's picture to <herdr home>/avatars/. Silent on failure (the mod falls back to a letter).
host="$1"; owner="$2"
case "$owner" in *[!A-Za-z0-9._-]*|"") exit 0 ;; esac
dir="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/crest-cache"
name="$owner"; [ "$host" = "github.com" ] || name="${host}__${owner}"
f="$dir/$name.png"
mkdir -p "$dir"
# fresh for a week
if [ -s "$f" ] && [ -z "$(find "$f" -mtime +7 2>/dev/null)" ]; then exit 0; fi
case "$host" in
  github.com)   url="https://github.com/$owner.png?size=96" ;;
  codeberg.org) url="https://codeberg.org/$owner.png" ;;
  bitbucket.org) url="https://bitbucket.org/account/$owner/avatar/96/" ;;
  gitlab.com)
    api() { curl -fsSL -m 10 "https://gitlab.com/api/v4/$1" 2>/dev/null | sed -n 's/.*"avatar_url":"\([^"]*\)".*/\1/p' | sed 's/\\u0026/\&/g' | head -n1; }
    url="$(api "groups/$owner")"; [ -n "$url" ] || url="$(api "users?username=$owner")"
    ;;
  *) exit 0 ;;
esac
[ -n "$url" ] || exit 0
curl -fsSL -m 15 -o "$f.tmp" "$url" && [ -s "$f.tmp" ] && mv "$f.tmp" "$f" || rm -f "$f.tmp"
