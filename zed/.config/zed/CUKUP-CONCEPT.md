# 🌿 Konsep & Blueprint Pengembangan "Cukup"
> *"Bukan kurang, bukan berlebih. Pas untuk kejernihan berpikir."*

Dokumen ini merangkum visi, arsitektur token, dan rencana ekspansi tema **Cukup** ke berbagai lingkungan kerja.

---

## 1. Visi & Filosofi Desain
- **Esensialisme Visual**: Mengurangi distraksi visual sehingga perhatian tertuju penuh pada logika dan teks.
- **Tanpa Kelelahan Mata**: Menghindari kontras neon menusuk; mengutamakan gradasi abu-abu arang netral pada mode gelap dan putih kertas lembut pada mode terang.
- **Konsistensi Universal**: Nuansa identik saat berpindah antar terminal, editor kode, dan browser.

---

## 2. Palet Token Warna

### Mode Gelap (Dark & OLED)
- **Canvas / Background**: `#1A1A1A` (Solid) | `#1A1A1Ac4` (Blurred) | `#000000` (OLED)
- **Editor & Gutter Background**: `#00000000` (Blurred - tembus blur window) | `#1A1A1A` (Solid) | `#000000` (OLED)
- **Elevated Surface (Modals / Menus / Popups)**: `#222222` (Solid, kontras 100% terbaca) | `#FFFFFF` (Light) | `#111111` (OLED)
- **Panel & Sidebar**: `#141414` (Dark) | `#080808` (OLED) | `#00000000` (Blurred)
- **Active Line / Highlight**: `#222222`
- **Border**: `#282828`
- **Text Primary**: `#C9D1D9`
- **Text Muted / Comment**: `#768390` (Italic)
- **Accent Orange (Primary Text / Functions / Properties)**: `#FFAB70` (Dark) | `#D96B27` (Light)
- **Accent Purple (Strings / Literals / Regex)**: `#B392F1` (Dark) | `#6F42C1` (Light)
- **Accent Blue (Types / Focus)**: `#79B8FF` (Dark) | `#1976D2` (Light)
- **Accent Coral (Keywords / Logic)**: `#FA7584` (Dark) | `#D32F2F` (Light)
- **Accent Sage (Git Add / Tags)**: `#7EE787` (Dark) | `#22863A` (Light)
- **Accent Amber (Git Mod / Warning)**: `#E3B341` (Dark) | `#F57C00` (Light)

### Mode Terang (Light)
- **Canvas / Background**: `#FFFFFF` (Solid) | `#FFFFFFAA` (Blurred)
- **Panel & Sidebar**: `#F8F9FA`
- **Active Line / Highlight**: `#F3F4F6`
- **Border**: `#E5E7EB`
- **Text Primary**: `#1F2937`
- **Text Muted / Comment**: `#8C959F` (Italic)
- **Accent Blue**: `#1976D2`
- **Accent Coral**: `#D32F2F`
- **Accent Lavender**: `#6F42C1`
- **Accent Forest**: `#22863A`
- **Accent Amber**: `#F57C00`

---

## 3. Rencana Ekspansi Multi-Platform

```
                  ┌───────────────────────┐
                  │ Cukup Tokens (JSON)   │
                  └──────────┬────────────┘
                             │ (Build Script)
       ┌─────────────────────┼─────────────────────┐
       ▼                     ▼                     ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│     IDEs     │      │   Terminal   │      │   Web & UI   │
├──────────────┤      ├──────────────┤      ├──────────────┤
│ • Zed (Done) │      │ • Alacritty  │      │ • CSS Vars   │
│ • VS Code    │      │ • Zellij     │      │ • Tailwind   │
│ • Neovim     │      │ • Lazygit    │      │ • Shiki code │
│ • JetBrains  │      │ • Bat / Btop │      │ • UI Library │
└──────────────┘      └──────────────┘      └──────────────┘
```

1. **Tahap 1: Dotfiles Lokal Anda**
   - Zed (sudah selesai & aktif)
   - Alacritty (`alacritty.toml`)
   - Zellij (`cukup.kdl`)
   - Lazygit, Yazi, Btop
2. **Tahap 2: Ekosistem Editor Eksternal**
   - VS Code extension (`cukup-theme`)
   - Neovim plugin (`cukup.nvim`)
3. **Tahap 3: Web & Front-end**
   - `@cukup/tokens` (CSS variables & Tailwind plugin)
   - Shiki / Prism highlighter untuk blog & dokumentasi
