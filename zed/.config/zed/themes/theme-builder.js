#!/usr/bin/env node
/**
 * Zen Theme Builder for Zed IDE
 * -------------------------------------------------------------
 * Usage:
 *   node theme-builder.js build              # Rebuilds zen-min.json
 *   node theme-builder.js new <name>         # Generates a new theme family
 */

const fs = require('fs');
const path = require('path');

const THEMES_DIR = __dirname;

// Common Syntax Templates
const darkSyntax = {
  "attribute": { "color": "#B392F1" },
  "boolean": { "color": "#79B8FF" },
  "comment": { "color": "#768390", "font_style": "italic" },
  "comment.doc": { "color": "#768390", "font_style": "italic" },
  "constant": { "color": "#79B8FF" },
  "constructor": { "color": "#B392F1" },
  "embedded": { "color": "#C9D1D9" },
  "emphasis": { "color": "#F8F8F8", "font_style": "italic" },
  "emphasis.strong": { "color": "#F8F8F8", "font_weight": 700 },
  "enum": { "color": "#B392F1" },
  "function": { "color": "#B392F1" },
  "function.method": { "color": "#B392F1" },
  "function.special.definition": { "color": "#B392F1" },
  "hint": { "color": "#768390" },
  "keyword": { "color": "#FA7584" },
  "label": { "color": "#FA7584" },
  "link_text": { "color": "#79B8FF", "font_style": "italic" },
  "link_uri": { "color": "#79B8FF" },
  "number": { "color": "#F8F8F8" },
  "operator": { "color": "#FA7584" },
  "predictive": { "color": "#636e7b" },
  "preproc": { "color": "#FA7584" },
  "primary": { "color": "#C9D1D9" },
  "property": { "color": "#C9D1D9" },
  "punctuation": { "color": "#8B949E" },
  "punctuation.bracket": { "color": "#8B949E" },
  "punctuation.delimiter": { "color": "#8B949E" },
  "punctuation.list_marker": { "color": "#FA7584" },
  "punctuation.special": { "color": "#FA7584" },
  "string": { "color": "#FFAB70" },
  "string.escape": { "color": "#FA7584" },
  "string.regex": { "color": "#79B8FF" },
  "string.special": { "color": "#FFAB70" },
  "string.special.symbol": { "color": "#79B8FF" },
  "tag": { "color": "#7EE787" },
  "text.literal": { "color": "#E394DC" },
  "title": { "color": "#79B8FF", "font_weight": 700 },
  "type": { "color": "#79B8FF" },
  "type.builtin": { "color": "#79B8FF" },
  "variable": { "color": "#C9D1D9" },
  "variable.special": { "color": "#79B8FF" }
};

const lightSyntax = {
  "attribute": { "color": "#6F42C1" },
  "boolean": { "color": "#1976D2" },
  "comment": { "color": "#8C959F", "font_style": "italic" },
  "comment.doc": { "color": "#8C959F", "font_style": "italic" },
  "constant": { "color": "#1976D2" },
  "constructor": { "color": "#6F42C1" },
  "embedded": { "color": "#1F2328" },
  "emphasis": { "color": "#1F2328", "font_style": "italic" },
  "emphasis.strong": { "color": "#1F2328", "font_weight": 700 },
  "enum": { "color": "#6F42C1" },
  "function": { "color": "#6F42C1" },
  "function.method": { "color": "#6F42C1" },
  "function.special.definition": { "color": "#6F42C1" },
  "hint": { "color": "#6E7781" },
  "keyword": { "color": "#D32F2F" },
  "label": { "color": "#D32F2F" },
  "link_text": { "color": "#1976D2", "font_style": "italic" },
  "link_uri": { "color": "#1976D2" },
  "number": { "color": "#212121" },
  "operator": { "color": "#D32F2F" },
  "predictive": { "color": "#8C959F" },
  "preproc": { "color": "#D32F2F" },
  "primary": { "color": "#1F2328" },
  "property": { "color": "#212121" },
  "punctuation": { "color": "#57606A" },
  "punctuation.bracket": { "color": "#57606A" },
  "punctuation.delimiter": { "color": "#57606A" },
  "punctuation.list_marker": { "color": "#D32F2F" },
  "punctuation.special": { "color": "#D32F2F" },
  "string": { "color": "#22863A" },
  "string.escape": { "color": "#D32F2F" },
  "string.regex": { "color": "#0097A7" },
  "string.special": { "color": "#22863A" },
  "string.special.symbol": { "color": "#1976D2" },
  "tag": { "color": "#22863A" },
  "text.literal": { "color": "#C2185B" },
  "title": { "color": "#1976D2", "font_weight": 700 },
  "type": { "color": "#1976D2" },
  "type.builtin": { "color": "#1976D2" },
  "variable": { "color": "#212121" },
  "variable.special": { "color": "#1976D2" }
};

// Dark Min Palette
const darkPalette = {
  bg: "#1A1A1A",
  bgBlurred: "#1A1A1Ac4",
  editorBg: "#1A1A1A",
  panelBg: "#141414",
  tabBarBg: "#121212",
  tabInactiveBg: "#141414",
  tabActiveBg: "#1A1A1A",
  toolbarBg: "#161616",
  border: "#282828",
  borderVariant: "#202020",
  text: "#C9D1D9",
  textMuted: "#768390",
  accent: "#79B8FF",
  elementHover: "#282828",
  elementActive: "#323232",
  elementSelected: "#2e2e2e",
  activeLineBg: "#222222aa",
  lineNumber: "#555555",
  activeLineNumber: "#B0B0B0",
  indentGuide: "#262626",
  indentGuideActive: "#444444",
  searchMatch: "#FFAB7055",
  scrollbarThumb: "#44444466",
  scrollbarThumbHover: "#66666699",
  paneFocusedBorder: "#79B8FF77",
  bracketHighlight: "#79B8FF33",
  docHighlightRead: "#79B8FF22",
  docHighlightWrite: "#79B8FF33",
  created: "#7EE787",
  modified: "#E3B341",
  deleted: "#FA7584",
  error: "#FA7584",
  warning: "#E3B341",
  ansi: {
    black: "#1A1A1A",
    bright_black: "#5C5C5C",
    dim_black: "#111111",
    red: "#FA7584",
    bright_red: "#FF9CAA",
    dim_red: "#D15A68",
    green: "#7EE787",
    bright_green: "#A3F5AC",
    dim_green: "#5A9A68",
    yellow: "#FFAB70",
    bright_yellow: "#FFC9A3",
    dim_yellow: "#D18F5A",
    blue: "#79B8FF",
    bright_blue: "#A3D0FF",
    dim_blue: "#5A8AC0",
    magenta: "#B392F1",
    bright_magenta: "#CFB8FF",
    dim_magenta: "#8A6EC0",
    cyan: "#79B8FF",
    bright_cyan: "#A3D0FF",
    dim_cyan: "#5A8AC0",
    white: "#C9D1D9",
    bright_white: "#F8F8F8",
    dim_white: "#898989"
  },
  syntax: darkSyntax
};

// OLED Pure Black Palette
const oledPalette = {
  ...darkPalette,
  bg: "#000000",
  bgBlurred: "#000000e0",
  editorBg: "#000000",
  panelBg: "#080808",
  tabBarBg: "#050505",
  tabInactiveBg: "#080808",
  tabActiveBg: "#000000",
  toolbarBg: "#080808",
  border: "#1C1C1C",
  borderVariant: "#141414",
  activeLineBg: "#111111",
  lineNumber: "#404040",
  activeLineNumber: "#FFFFFF",
  indentGuide: "#181818",
  indentGuideActive: "#303030",
  scrollbarThumb: "#282828",
  scrollbarThumbHover: "#3e3e3e"
};

// Light Min Palette
const lightPalette = {
  bg: "#FFFFFF",
  bgBlurred: "#FFFFFFAA",
  editorBg: "#FFFFFF",
  panelBg: "#F8F9FA",
  tabBarBg: "#F0F2F5",
  tabInactiveBg: "#F0F2F5",
  tabActiveBg: "#FFFFFF",
  toolbarBg: "#F6F8FA",
  border: "#E5E7EB",
  borderVariant: "#ECEEF1",
  text: "#1F2937",
  textMuted: "#6B7280",
  accent: "#1976D2",
  elementHover: "#F0F2F5",
  elementActive: "#E5E7EB",
  elementSelected: "#E5E7EB",
  activeLineBg: "#F3F4F6",
  lineNumber: "#B5B8BD",
  activeLineNumber: "#374151",
  indentGuide: "#E5E7EB",
  indentGuideActive: "#9CA3AF",
  searchMatch: "#FED7AA99",
  scrollbarThumb: "#CBD5E188",
  scrollbarThumbHover: "#94A3B8AA",
  paneFocusedBorder: "#1976D266",
  bracketHighlight: "#1976D226",
  docHighlightRead: "#1976D218",
  docHighlightWrite: "#1976D226",
  created: "#22863A",
  modified: "#F57C00",
  deleted: "#D32F2F",
  error: "#D32F2F",
  warning: "#F57C00",
  ansi: {
    black: "#333333",
    bright_black: "#A1A1A1",
    dim_black: "#757575",
    red: "#D32F2F",
    bright_red: "#E57373",
    dim_red: "#B71C1C",
    green: "#22863A",
    bright_green: "#81C784",
    dim_green: "#1B5E20",
    yellow: "#F57C00",
    bright_yellow: "#FFB74D",
    dim_yellow: "#E65100",
    blue: "#1976D2",
    bright_blue: "#64B5F6",
    dim_blue: "#0D47A1",
    magenta: "#6F42C1",
    bright_magenta: "#B392F1",
    dim_magenta: "#482688",
    cyan: "#0097A7",
    bright_cyan: "#4DD0E1",
    dim_cyan: "#006064",
    white: "#B1B1B1",
    bright_white: "#E0E0E0",
    dim_white: "#F5F5F5"
  },
  syntax: lightSyntax
};

function buildStyle(p, blurred = false) {
  const bg = blurred ? p.bgBlurred : p.bg;
  const style = {
    "border": p.border,
    "border.variant": p.borderVariant || p.border,
    "border.focused": p.accent,
    "border.selected": p.accent,
    "border.transparent": "#00000000",
    "border.disabled": p.border,
    "background": bg,
    "elevated_surface.background": p.panelBg,
    "surface.background": p.bg,
    "element.background": p.tabInactiveBg,
    "element.hover": p.elementHover,
    "element.active": p.elementActive || p.elementHover,
    "element.selected": p.elementSelected || p.elementHover,
    "element.disabled": p.tabInactiveBg,
    "ghost_element.background": "#00000000",
    "ghost_element.hover": p.elementHover,
    "ghost_element.active": p.elementActive || p.elementHover,
    "ghost_element.selected": p.elementSelected || p.elementHover,
    "ghost_element.disabled": "#00000000",
    "drop_target.background": p.accent + "33",
    "text": p.text,
    "text.muted": p.textMuted,
    "text.accent": p.accent,
    "text.placeholder": p.textMuted + "aa",
    "text.disabled": p.textMuted + "66",
    "icon": p.text,
    "icon.muted": p.textMuted,
    "icon.disabled": p.textMuted + "66",
    "icon.placeholder": p.textMuted + "aa",
    "icon.accent": p.accent,
    "status_bar.background": bg,
    "title_bar.background": bg,
    "title_bar.inactive_background": bg,
    "toolbar.background": p.toolbarBg,
    "tab_bar.background": p.tabBarBg,
    "tab.inactive_background": p.tabInactiveBg,
    "tab.active_background": p.tabActiveBg,
    "search.match_background": p.searchMatch,
    "panel.background": p.panelBg,
    "panel.focused_border": p.paneFocusedBorder || p.accent,
    "panel.indent_guide": p.indentGuide,
    "panel.indent_guide_hover": p.indentGuideActive,
    "panel.indent_guide_active": p.indentGuideActive,
    "pane.focused_border": p.paneFocusedBorder || p.accent,
    "pane_group.border": p.border,
    "scrollbar.thumb.background": p.scrollbarThumb,
    "scrollbar.thumb.hover_background": p.scrollbarThumbHover,
    "scrollbar.thumb.border": "#00000000",
    "scrollbar.track.background": "#00000000",
    "scrollbar.track.border": "#00000000",
    "editor.foreground": p.text,
    "editor.background": p.editorBg,
    "editor.gutter.background": p.editorBg,
    "editor.subheader.background": p.toolbarBg,
    "editor.active_line.background": p.activeLineBg,
    "editor.highlighted_line.background": p.activeLineBg,
    "editor.line_number": p.lineNumber,
    "editor.active_line_number": p.activeLineNumber,
    "editor.invisible": p.indentGuide,
    "editor.wrap_guide": p.indentGuide,
    "editor.active_wrap_guide": p.indentGuideActive,
    "editor.indent_guide": p.indentGuide,
    "editor.indent_guide_active": p.indentGuideActive,
    "editor.document_highlight.read_background": p.docHighlightRead || p.accent + "26",
    "editor.document_highlight.write_background": p.docHighlightWrite || p.accent + "33",
    "editor.document_highlight.bracket_background": p.bracketHighlight || p.accent + "26",
    "terminal.background": p.editorBg,
    "terminal.foreground": p.text,
    "terminal.bright_foreground": p.ansi.bright_white,
    "terminal.dim_foreground": p.textMuted,
    "terminal.ansi.background": p.editorBg,
    "terminal.ansi.black": p.ansi.black,
    "terminal.ansi.bright_black": p.ansi.bright_black,
    "terminal.ansi.dim_black": p.ansi.dim_black,
    "terminal.ansi.red": p.ansi.red,
    "terminal.ansi.bright_red": p.ansi.bright_red,
    "terminal.ansi.dim_red": p.ansi.dim_red,
    "terminal.ansi.green": p.ansi.green,
    "terminal.ansi.bright_green": p.ansi.bright_green,
    "terminal.ansi.dim_green": p.ansi.dim_green,
    "terminal.ansi.yellow": p.ansi.yellow,
    "terminal.ansi.bright_yellow": p.ansi.bright_yellow,
    "terminal.ansi.dim_yellow": p.ansi.dim_yellow,
    "terminal.ansi.blue": p.ansi.blue,
    "terminal.ansi.bright_blue": p.ansi.bright_blue,
    "terminal.ansi.dim_blue": p.ansi.dim_blue,
    "terminal.ansi.magenta": p.ansi.magenta,
    "terminal.ansi.bright_magenta": p.ansi.bright_magenta,
    "terminal.ansi.dim_magenta": p.ansi.dim_magenta,
    "terminal.ansi.cyan": p.ansi.cyan,
    "terminal.ansi.bright_cyan": p.ansi.bright_cyan,
    "terminal.ansi.dim_cyan": p.ansi.dim_cyan,
    "terminal.ansi.white": p.ansi.white,
    "terminal.ansi.bright_white": p.ansi.bright_white,
    "terminal.ansi.dim_white": p.ansi.dim_white,
    "link_text.hover": p.accent,
    "created": p.created,
    "created.background": p.created + "22",
    "created.border": p.created,
    "modified": p.modified,
    "modified.background": p.modified + "22",
    "modified.border": p.modified,
    "deleted": p.deleted,
    "deleted.background": p.deleted + "22",
    "deleted.border": p.deleted,
    "conflict": p.deleted,
    "conflict.background": p.deleted + "22",
    "conflict.border": p.deleted,
    "renamed": p.accent,
    "renamed.background": p.accent + "22",
    "renamed.border": p.accent,
    "ignored": p.textMuted + "88",
    "ignored.background": "#00000000",
    "ignored.border": "#00000000",
    "hidden": p.textMuted + "aa",
    "hidden.background": "#00000000",
    "hidden.border": "#00000000",
    "hint": p.textMuted,
    "hint.background": p.textMuted + "22",
    "hint.border": p.textMuted,
    "info": p.accent,
    "info.background": p.accent + "22",
    "info.border": p.accent,
    "warning": p.warning,
    "warning.background": p.warning + "22",
    "warning.border": p.warning,
    "error": p.error,
    "error.background": p.error + "22",
    "error.border": p.error,
    "success": p.created,
    "success.background": p.created + "22",
    "success.border": p.created,
    "unreachable": p.textMuted + "66",
    "unreachable.background": "#00000000",
    "unreachable.border": "#00000000",
    "predictive": p.textMuted + "99",
    "predictive.background": "#00000000",
    "predictive.border": "#00000000",
    "players": [
      { "cursor": p.accent, "selection": p.accent + "33", "background": p.accent },
      { "cursor": p.syntax.function.color, "selection": p.syntax.function.color + "33", "background": p.syntax.function.color },
      { "cursor": p.syntax.string.color, "selection": p.syntax.string.color + "33", "background": p.syntax.string.color },
      { "cursor": p.warning, "selection": p.warning + "33", "background": p.warning }
    ],
    "syntax": p.syntax
  };

  if (blurred) {
    style["background.appearance"] = "blurred";
  } else {
    style["background.appearance"] = "opaque";
  }

  return style;
}

function buildCukup() {
  const themeData = {
    "$schema": "https://zed.dev/schema/themes/v0.2.0.json",
    "name": "Cukup",
    "author": "Hasan Suryaman",
    "themes": [
      {
        "name": "Cukup Dark (Blurred)",
        "appearance": "dark",
        "style": buildStyle(darkPalette, true)
      },
      {
        "name": "Cukup Dark (Solid)",
        "appearance": "dark",
        "style": buildStyle(darkPalette, false)
      },
      {
        "name": "Cukup Light (Blurred)",
        "appearance": "light",
        "style": buildStyle(lightPalette, true)
      },
      {
        "name": "Cukup Light (Solid)",
        "appearance": "light",
        "style": buildStyle(lightPalette, false)
      },
      {
        "name": "Cukup OLED (Pure Black)",
        "appearance": "dark",
        "style": buildStyle(oledPalette, false)
      }
    ]
  };

  const outFile = path.join(THEMES_DIR, "cukup.json");
  fs.writeFileSync(outFile, JSON.stringify(themeData, null, 2), "utf8");
  console.log(`[OK] Generated: ${outFile}`);
}

function createNewTheme(name) {
  if (!name) {
    console.error("Usage: node theme-builder.js new <ThemeName>");
    process.exit(1);
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const themeData = {
    "$schema": "https://zed.dev/schema/themes/v0.2.0.json",
    "name": name,
    "author": "Hasan Suryaman",
    "themes": [
      {
        "name": `${name} Dark`,
        "appearance": "dark",
        "style": buildStyle(darkPalette, false)
      },
      {
        "name": `${name} Light`,
        "appearance": "light",
        "style": buildStyle(lightPalette, false)
      }
    ]
  };

  const outFile = path.join(THEMES_DIR, `${slug}.json`);
  fs.writeFileSync(outFile, JSON.stringify(themeData, null, 2), "utf8");
  console.log(`[OK] Created new custom theme family: ${outFile}`);
}

const cmd = process.argv[2] || "build";
if (cmd === "build") {
  buildCukup();
} else if (cmd === "new") {
  createNewTheme(process.argv.slice(3).join(" "));
} else {
  console.log("Commands: build, new <ThemeName>");
}
