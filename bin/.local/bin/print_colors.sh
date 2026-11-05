#!/usr/bin/env bash
# =============================================================================
# print_colors.sh — Terminal Color Palette & Cukup Theme Visualizer
# Compatible with Alacritty's print_colors.sh + enhanced with hex & proposals
# =============================================================================

set -e

RESET="\033[0m"
BOLD="\033[1m"
DIM="\033[2m"
ITALIC="\033[3m"

# Print classic Alacritty-style ANSI table (100% compatible)
print_classic() {
    printf "${BOLD}=== Terminal ANSI Color Matrix ===${RESET}\n\n"
    printf "|039| \033[39mDefault       \033[m  |049| \033[49mDefault       \033[m  |037| \033[37mLight gray    \033[m  |047| \033[47mLight gray    \033[m\n"
    printf "|030| \033[30mBlack         \033[m  |040| \033[40mBlack         \033[m  |090| \033[90mDark gray     \033[m  |100| \033[100mDark gray     \033[m\n"
    printf "|031| \033[31mRed           \033[m  |041| \033[41mRed           \033[m  |091| \033[91mLight red     \033[m  |101| \033[101mLight red     \033[m\n"
    printf "|032| \033[32mGreen         \033[m  |042| \033[42mGreen         \033[m  |092| \033[92mLight green   \033[m  |102| \033[102mLight green   \033[m\n"
    printf "|033| \033[33mYellow        \033[m  |043| \033[43mYellow        \033[m  |093| \033[93mLight yellow  \033[m  |103| \033[103mLight yellow  \033[m\n"
    printf "|034| \033[34mBlue          \033[m  |044| \033[44mBlue          \033[m  |094| \033[94mLight blue    \033[m  |104| \033[104mLight blue    \033[m\n"
    printf "|035| \033[35mMagenta       \033[m  |045| \033[45mMagenta       \033[m  |095| \033[95mLight magenta \033[m  |105| \033[105mLight magenta \033[m\n"
    printf "|036| \033[36mCyan          \033[m  |046| \033[46mCyan          \033[m  |096| \033[96mLight cyan    \033[m  |106| \033[106mLight cyan    \033[m\n"
    echo ""
}

# Helper to print truecolor hex row
hex_row() {
    local hex="$1"
    local name="$2"
    local r=$((16#${hex:1:2}))
    local g=$((16#${hex:3:2}))
    local b=$((16#${hex:5:2}))
    printf "\033[48;2;%d;%d;%dm       ${RESET} \033[38;2;%d;%d;%dm%-17s${RESET} ${DIM}%s${RESET}\n" "$r" "$g" "$b" "$r" "$g" "$b" "$name" "$hex"
}

# Helper to render a code snippet using exact RGB colors
render_code_sample() {
    local kw_r="$1" kw_g="$2" kw_b="$3"
    local fn_r="$4" fn_g="$5" fn_b="$6"
    local str_r="$7" str_g="$8" str_b="$9"
    local type_r="${10}" type_g="${11}" type_b="${12}"
    local cm_r="${13}" cm_g="${14}" cm_b="${15}"

    printf "  \033[38;2;%d;%d;%dmimport\033[0m { \033[38;2;%d;%d;%dmcreateTheme\033[0m } \033[38;2;%d;%d;%dmfrom\033[0m \033[38;2;%d;%d;%dm'@cukup/core'\033[0m;\n" \
        "$kw_r" "$kw_g" "$kw_b" "$fn_r" "$fn_g" "$fn_b" "$kw_r" "$kw_g" "$kw_b" "$str_r" "$str_g" "$str_b"
    printf "  \033[38;2;%d;%d;%dm// Konsep esensialisme visual Cukup\033[0m\n" "$cm_r" "$cm_g" "$cm_b"
    printf "  \033[38;2;%d;%d;%dmconst\033[0m \033[38;2;%d;%d;%dmpalette\033[0m: \033[38;2;%d;%d;%dmThemeConfig\033[0m = \033[38;2;%d;%d;%dmcreateTheme\033[0m({\n" \
        "$kw_r" "$kw_g" "$kw_b" "$fn_r" "$fn_g" "$fn_b" "$type_r" "$type_g" "$type_b" "$fn_r" "$fn_g" "$fn_b"
    printf "    \033[38;2;%d;%d;%dmfocus\033[0m: \033[38;2;%d;%d;%dm'clarity'\033[0m,\n" "$fn_r" "$fn_g" "$fn_b" "$str_r" "$str_g" "$str_b"
    printf "    \033[38;2;%d;%d;%dmsaturasi\033[0m: \033[38;2;%d;%d;%dm0.85\033[0m,\n" "$fn_r" "$fn_g" "$fn_b" "$type_r" "$type_g" "$type_b"
    printf "  });\n\n"
}

# Print current active Cukup
print_current() {
    printf "${BOLD}☕ [TEMA AKTIF SAAT INI] Cukup Kopi (Espresso, Persimmon & Cashmere Mauve)${RESET}\n"
    printf "${DIM}Filosofi: Modern tactile coffeehouse. Hangat, bersahabat, kontras lembut.${RESET}\n"
    hex_row "#161413" "Background (Espresso)"
    hex_row "#E0D8D0" "Foreground (Oat Silk)"
    hex_row "#E87D4B" "Function (Persimmon)"
    hex_row "#B8969E" "String (Cashmere)"
    hex_row "#D25C54" "Keyword (Paprika)"
    hex_row "#5E9EA0" "Type (Ceramic Blue)"
    hex_row "#CCA062" "Constant (Ochre)"
    hex_row "#7A726A" "Comment (Chicory)"
    echo ""
    render_code_sample 210 92 84  232 125 75   184 150 158  94 158 160  122 114 106
}

# Proposal 1: Cukup Senja
print_p1() {
    printf "${BOLD}✨ [REKOMENDASI 1] Cukup Senja (Warm Terracotta, Dusty Lilac & Celadon)${RESET}  ${BOLD}\033[33m★ REKOMENDASI UTAMA\033[0m\n"
    printf "${DIM}Filosofi: Kehangatan tanah liat & senja. Organik, natural, sangat ramah mata.${RESET}\n"
    hex_row "#181816" "Background (Warm)"
    hex_row "#D8D5CD" "Foreground"
    hex_row "#E89058" "Function (Terracotta)"
    hex_row "#B294C7" "String (Dusty Lilac)"
    hex_row "#DE6E75" "Keyword (Rose Rust)"
    hex_row "#6BAFAD" "Type (Celadon Teal)"
    hex_row "#DDA861" "Constant (Amber Gold)"
    hex_row "#78776F" "Comment (Warm Stone)"
    echo ""
    render_code_sample 222 110 117  232 144 88   178 148 199  107 175 173  120 119 111
}

# Proposal 2: Cukup Malam
print_p2() {
    printf "${BOLD}🌲 [REKOMENDASI 2] Cukup Malam (Deep Pine, Wild Amber & Frost Jade)${RESET}\n"
    printf "${DIM}Filosofi: Heningnya hutan pinus Skandinavia. Sejuk, tenang, fokus tinggi.${RESET}\n"
    hex_row "#131718" "Background (Pine)"
    hex_row "#D6E0DD" "Foreground (Frost)"
    hex_row "#E6A854" "Function (Wild Amber)"
    hex_row "#74BBA2" "String (Frost Jade)"
    hex_row "#D4708A" "Keyword (Berry Red)"
    hex_row "#6CA7C8" "Type (Glacier Blue)"
    hex_row "#6A7875" "Comment (Muted Pine)"
    echo ""
    render_code_sample 212 112 138  230 168 84   116 187 162  108 167 200  106 120 117
}

# Proposal 3: Cukup Kopi
print_p3() {
    printf "${BOLD}☕ [REKOMENDASI 3] Cukup Kopi (Espresso, Persimmon & Cashmere Mauve)${RESET}\n"
    printf "${DIM}Filosofi: Modern tactile coffeehouse. Hangat, bersahabat, kontras lembut.${RESET}\n"
    hex_row "#161413" "Background (Espresso)"
    hex_row "#E0D8D0" "Foreground (Oat Silk)"
    hex_row "#E87D4B" "Function (Persimmon)"
    hex_row "#B8969E" "String (Cashmere)"
    hex_row "#D25C54" "Keyword (Paprika)"
    hex_row "#5E9EA0" "Type (Ceramic Blue)"
    hex_row "#7A726A" "Comment (Chicory)"
    echo ""
    render_code_sample 210 92 84   232 125 75   184 150 158  94 158 160   122 114 106
}

case "$1" in
    --classic|-c)
        print_classic
        ;;
    --current)
        print_current
        ;;
    --proposals|-p)
        print_p1
        print_p2
        print_p3
        ;;
    *)
        print_classic
        printf "======================================================================\n\n"
        print_current
        printf "======================================================================\n\n"
        print_p1
        printf "======================================================================\n\n"
        print_p2
        printf "======================================================================\n\n"
        print_p3
        ;;
esac
