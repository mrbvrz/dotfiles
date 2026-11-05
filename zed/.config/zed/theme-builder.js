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

const THEMES_DIR = path.join(__dirname, "themes");

// Common Syntax Templates
const darkSyntax = {
  "attribute": { "color": "#E89058" },
  "boolean": { "color": "#DDA861" },
  "comment": { "color": "#78776F", "font_style": "italic" },
  "comment.doc": { "color": "#78776F", "font_style": "italic" },
  "constant": { "color": "#DDA861" },
  "constructor": { "color": "#E89058" },
  "embedded": { "color": "#E89058" },
  "emphasis": { "color": "#F4F2EC", "font_style": "italic" },
  "emphasis.strong": { "color": "#F4F2EC", "font_weight": 700 },
  "enum": { "color": "#E89058" },
  "function": { "color": "#E89058" },
  "function.method": { "color": "#E89058" },
  "function.special.definition": { "color": "#E89058" },
  "hint": { "color": "#78776F" },
  "keyword": { "color": "#DE6E75" },
  "label": { "color": "#DE6E75" },
  "link_text": { "color": "#6BAFAD", "font_style": "italic" },
  "link_uri": { "color": "#6BAFAD" },
  "number": { "color": "#E0DDD5" },
  "operator": { "color": "#DE6E75" },
  "predictive": { "color": "#5E5D56" },
  "preproc": { "color": "#DE6E75" },
  "primary": { "color": "#E89058" },
  "property": { "color": "#E89058" },
  "punctuation": { "color": "#949187" },
  "punctuation.bracket": { "color": "#949187" },
  "punctuation.delimiter": { "color": "#949187" },
  "punctuation.list_marker": { "color": "#DE6E75" },
  "punctuation.special": { "color": "#DE6E75" },
  "string": { "color": "#B294C7" },
  "string.escape": { "color": "#DE6E75" },
  "string.regex": { "color": "#B294C7" },
  "string.special": { "color": "#B294C7" },
  "string.special.symbol": { "color": "#6BAFAD" },
  "tag": { "color": "#89BA81" },
  "text.literal": { "color": "#B294C7" },
  "title": { "color": "#6BAFAD", "font_weight": 700 },
  "type": { "color": "#6BAFAD" },
  "type.builtin": { "color": "#6BAFAD" },
  "variable": { "color": "#E89058" },
  "variable.special": { "color": "#6BAFAD" }
};

const lightSyntax = {
  "attribute": { "color": "#D96B27" },
  "boolean": { "color": "#1976D2" },
  "comment": { "color": "#8C959F", "font_style": "italic" },
  "comment.doc": { "color": "#8C959F", "font_style": "italic" },
  "constant": { "color": "#1976D2" },
  "constructor": { "color": "#D96B27" },
  "embedded": { "color": "#D96B27" },
  "emphasis": { "color": "#1F2328", "font_style": "italic" },
  "emphasis.strong": { "color": "#1F2328", "font_weight": 700 },
  "enum": { "color": "#D96B27" },
  "function": { "color": "#D96B27" },
  "function.method": { "color": "#D96B27" },
  "function.special.definition": { "color": "#D96B27" },
  "hint": { "color": "#6E7781" },
  "keyword": { "color": "#D32F2F" },
  "label": { "color": "#D32F2F" },
  "link_text": { "color": "#1976D2", "font_style": "italic" },
  "link_uri": { "color": "#1976D2" },
  "number": { "color": "#212121" },
  "operator": { "color": "#D32F2F" },
  "predictive": { "color": "#8C959F" },
  "preproc": { "color": "#D32F2F" },
  "primary": { "color": "#D96B27" },
  "property": { "color": "#D96B27" },
  "punctuation": { "color": "#57606A" },
  "punctuation.bracket": { "color": "#57606A" },
  "punctuation.delimiter": { "color": "#57606A" },
  "punctuation.list_marker": { "color": "#D32F2F" },
  "punctuation.special": { "color": "#D32F2F" },
  "string": { "color": "#6F42C1" },
  "string.escape": { "color": "#D32F2F" },
  "string.regex": { "color": "#6F42C1" },
  "string.special": { "color": "#6F42C1" },
  "string.special.symbol": { "color": "#1976D2" },
  "tag": { "color": "#22863A" },
  "text.literal": { "color": "#6F42C1" },
  "title": { "color": "#1976D2", "font_weight": 700 },
  "type": { "color": "#1976D2" },
  "type.builtin": { "color": "#1976D2" },
  "variable": { "color": "#D96B27" },
  "variable.special": { "color": "#1976D2" }
};

// Dark Min Palette -> Cukup Senja
const darkPalette = {
  bg: "#181816",
  bgBlurred: "#181816c4",
  editorBg: "#181816",
  panelBg: "#131311",
  panelOverlayBg: "#131311",
  panelOverlayBgBlurred: "#181816e6",
  panelOverlayHover: "#262622",
  tabBarBg: "#11110F",
  tabInactiveBg: "#131311",
  tabActiveBg: "#181816",
  toolbarBg: "#151513",
  border: "#2B2B27",
  borderVariant: "#242420",
  elevatedBg: "#1F1F1C",
  surfaceBg: "#161614",
  elementBg: "#242421",
  text: "#D8D5CD",
  textMuted: "#78776F",
  accent: "#E89058",
  elementHover: "#2C2C28",
  elementActive: "#34342F",
  elementSelected: "#34342F",
  activeLineBg: "#20201Daa",
  lineNumber: "#585750",
  activeLineNumber: "#C4C1B9",
  indentGuide: "#262622",
  indentGuideActive: "#42413A",
  searchMatch: "#E8905855",
  scrollbarThumb: "#ffffff1c",
  scrollbarThumbHover: "#ffffff35",
  scrollbarThumbActive: "#ffffff50",
  paneFocusedBorder: "#E8905877",
  bracketHighlight: "#E8905833",
  docHighlightRead: "#E8905822",
  docHighlightWrite: "#E8905833",
  created: "#89BA81",
  modified: "#DDA861",
  deleted: "#DE6E75",
  error: "#DE6E75",
  warning: "#DDA861",
  ansi: {
    black: "#181816",
    bright_black: "#5E5D56",
    dim_black: "#11110F",
    red: "#DE6E75",
    bright_red: "#EA8A90",
    dim_red: "#B84E55",
    green: "#89BA81",
    bright_green: "#A2D19A",
    dim_green: "#6B9664",
    yellow: "#E89058",
    bright_yellow: "#F2A979",
    dim_yellow: "#C4723E",
    blue: "#6BAFAD",
    bright_blue: "#87C7C5",
    dim_blue: "#4F8F8D",
    magenta: "#B294C7",
    bright_magenta: "#CCAEE1",
    dim_magenta: "#9275A6",
    cyan: "#6BAFAD",
    bright_cyan: "#87C7C5",
    dim_cyan: "#4F8F8D",
    white: "#D8D5CD",
    bright_white: "#F4F2EC",
    dim_white: "#9A978E"
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
  panelOverlayBg: "#080808",
  panelOverlayBgBlurred: "#000000e0",
  panelOverlayHover: "#181818",
  tabBarBg: "#050505",
  tabInactiveBg: "#080808",
  tabActiveBg: "#000000",
  toolbarBg: "#080808",
  border: "#1C1C1C",
  borderVariant: "#141414",
  elevatedBg: "#111111",
  surfaceBg: "#080808",
  elementBg: "#161616",
  elementHover: "#202020",
  elementSelected: "#282828",
  activeLineBg: "#111111",
  lineNumber: "#404040",
  activeLineNumber: "#FFFFFF",
  indentGuide: "#181818",
  indentGuideActive: "#303030",
  scrollbarThumb: "#282828",
  scrollbarThumbHover: "#3e3e3e",
  scrollbarThumbActive: "#555555"
};

// Light Min Palette
const lightPalette = {
  bg: "#FFFFFF",
  bgBlurred: "#FFFFFFAA",
  editorBg: "#FFFFFF",
  panelBg: "#F8F9FA",
  panelOverlayBg: "#F8F9FA",
  panelOverlayBgBlurred: "#F6F8FAf0",
  panelOverlayHover: "#E8EAEF",
  tabBarBg: "#F0F2F5",
  tabInactiveBg: "#F0F2F5",
  tabActiveBg: "#FFFFFF",
  toolbarBg: "#F6F8FA",
  border: "#E5E7EB",
  borderVariant: "#ECEEF1",
  elevatedBg: "#FFFFFF",
  surfaceBg: "#F6F8FA",
  elementBg: "#F0F2F5",
  text: "#1F2937",
  textMuted: "#6B7280",
  accent: "#1976D2",
  elementHover: "#E8EAEF",
  elementActive: "#E0E4EA",
  elementSelected: "#E0E4EA",
  activeLineBg: "#F3F4F6",
  lineNumber: "#B5B8BD",
  activeLineNumber: "#374151",
  indentGuide: "#E5E7EB",
  indentGuideActive: "#9CA3AF",
  searchMatch: "#FED7AA99",
  scrollbarThumb: "#0000001c",
  scrollbarThumbHover: "#00000035",
  scrollbarThumbActive: "#00000050",
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
  const editorBg = blurred ? "#00000000" : p.editorBg;
  const panelBg = blurred ? "#00000000" : p.panelBg;
  const panelOverlayBg = blurred ? (p.panelOverlayBgBlurred || "#1A1A1Ae6") : (p.panelOverlayBg || p.panelBg);
  const panelOverlayHover = p.panelOverlayHover || p.elementHover;
  const toolbarBg = blurred ? "#00000000" : p.toolbarBg;
  const tabBarBg = blurred ? "#00000000" : p.tabBarBg;
  const tabInactiveBg = blurred ? "#00000000" : p.tabInactiveBg;
  const tabActiveBg = blurred ? "#ffffff08" : p.tabActiveBg;

  const style = {
    "border": p.border,
    "border.variant": p.borderVariant || p.border,
    "border.focused": p.accent,
    "border.selected": p.accent,
    "border.transparent": "#00000000",
    "border.disabled": p.border,
    "background": bg,
    "elevated_surface.background": p.elevatedBg,
    "surface.background": p.surfaceBg,
    "element.background": p.elementBg,
    "element.hover": p.elementHover,
    "element.active": p.elementActive || p.elementHover,
    "element.selected": p.elementSelected || p.elementHover,
    "element.disabled": tabInactiveBg,
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
    "toolbar.background": toolbarBg,
    "tab_bar.background": tabBarBg,
    "tab.inactive_background": tabInactiveBg,
    "tab.active_background": tabActiveBg,
    "search.match_background": p.searchMatch,
    "panel.background": panelBg,
    "panel.overlay_background": panelOverlayBg,
    "panel.overlay_hover": panelOverlayHover,
    "panel.focused_border": p.paneFocusedBorder || p.accent,
    "panel.indent_guide": p.indentGuide,
    "panel.indent_guide_hover": p.indentGuideActive,
    "panel.indent_guide_active": p.indentGuideActive,
    "pane.focused_border": p.paneFocusedBorder || p.accent,
    "pane_group.border": p.border,
    "scrollbar.thumb.background": p.scrollbarThumb,
    "scrollbar.thumb.hover_background": p.scrollbarThumbHover,
    "scrollbar.thumb.active_background": p.scrollbarThumbActive || p.scrollbarThumbHover,
    "scrollbar.thumb.border": "#00000000",
    "scrollbar.track.background": "#00000000",
    "scrollbar.track.border": "#00000000",
    "editor.foreground": p.text,
    "editor.background": editorBg,
    "editor.gutter.background": editorBg,
    "editor.subheader.background": toolbarBg,
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
} else if (cmd === "watch") {
  buildCukup();
  console.log("[WATCH] Watching theme-builder.js for live changes... (Ctrl+C to stop)");
  let timeout = null;
  fs.watch(__filename, () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      console.log("[REBUILD] Changes detected, updating cukup.json...");
      try {
        // Clear require cache and re-run build
        delete require.cache[require.resolve(__filename)];
        buildCukup();
      } catch (err) {
        console.error("[ERROR]", err.message);
      }
    }, 100);
  });
} else if (cmd === "new") {
  createNewTheme(process.argv.slice(3).join(" "));
} else {
  console.log("Commands: build, new <ThemeName>");
}
