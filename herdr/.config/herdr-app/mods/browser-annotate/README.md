# Herdr ADE Browser Annotate

Mod & Companion Extension untuk **Cek (Inspect)**, **Block (Area Marquee)**, dan **Mengirim Anotasi UI Langsung ke AI Coding Agent di Herdr** (konsep modern Agentic Development Environment seperti Lovable, Bolt.new, Cursor Web Preview).

---

## 🌟 Fitur Utama

1. **Cek Element (Inspect)**:
   - Sorot elemen web apa pun dengan mouse untuk melihat bounding box, tag name, class (Tailwind/CSS), dimensi pixel, dan nama komponen React/Vue.
   - Klik elemen untuk memilih dan membuka popover instruksi.

2. **Block Area (Marquee Selection)**:
   - Drag & drop mouse untuk membuat kotak seleksi area yang mencakup beberapa elemen atau satu komponen card utuh.
   - Live dimension badge (`W × H px`).
   - Otomatis mengambil crop screenshot dari area yang diblock.

3. **Kirim Langsung ke Prompt Agent**:
   - Ketik instruksi (misal *"Perbaiki layout padding dan ganti warna tombol"*).
   - Chip preset cepat: UI/Styling, Fix Bug, Jelaskan, Refactor.
   - Shortcut `Cmd + Enter` untuk mengirim.
   - Otomatis menginjeksi prompt berstruktur lengkap dengan file screenshot ke terminal agent yang aktif di Herdr via `hc send`.

---

## 🚀 Cara Penggunaan

### Metode 1: Menggunakan Bookmarklet (Instan tanpa install)
1. Salin script berikut:
   ```javascript
   javascript:(function(){var s=document.createElement('script');s.src='http://127.0.0.1:7890/content.js?t='+Date.now();document.body.appendChild(s);var c=document.createElement('link');c.rel='stylesheet';c.href='http://127.0.0.1:7890/content.css?t='+Date.now();document.head.appendChild(c);})();
   ```
2. Buat bookmark baru di browser Chrome/Brave/Arc/Safari dan paste script di atas ke field URL.
3. Buka web app lokal Anda (misal `http://localhost:5173`), lalu klik bookmark tersebut. Toolbar ADE akan muncul di pojok kanan atas!

### Metode 2: Menggunakan Chrome Extension (Manifest V3)
1. Buka `chrome://extensions` di Google Chrome.
2. Aktifkan toggle **Developer mode** di pojok kanan atas.
3. Klik tombol **Load unpacked**.
4. Pilih folder:
   ```
   ~/.config/herdr-app/mods/browser-annotate/extension
   ```
5. Buka tab web apa pun dan tekan shortcut **`Alt + Shift + A`** atau klik icon ekstensi di toolbar browser.

---

## ⚙️ Komponen & Arsitektur

- **`bridge/server.js`**: HTTP bridge server lokal pada `http://127.0.0.1:7890` yang menghubungkan browser dengan Herdr core (`hc`).
- **`extension/`**: Chrome Extension Manifest V3 (`manifest.json`, `background.js`, `content.js`, `content.css`, `popup.html`, icons).
- **`main.js`**: Panel UI native GPUI di dalam Herdr untuk mengontrol bridge server, memantau riwayat anotasi masuk, dan memilih target agent terminal.
