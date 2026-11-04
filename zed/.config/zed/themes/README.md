# Cukup Theme (`~/.config/zed/themes`)

**"Cukup"** adalah sistem tema minimalis modern yang dirancang dengan prinsip esensialisme visual: *tidak kurang, tidak berlebih, pas sesuai kebutuhan konsentrasi berpikir.*

---

## 🎨 Varian Theme "Cukup" yang Tersedia

File: [`cukup.json`](./cukup.json)

1. **`Cukup Dark (Blurred)`**
   - Translusen macOS (`background.appearance: "blurred"`, `#1A1A1Ac4`).
   - Sangat nyaman untuk sesi coding berjam-jam tanpa ketegangan mata.
2. **`Cukup Dark (Solid)`**
   - Latar belakang matte solid `#1A1A1A` tanpa transparansi.
3. **`Cukup Light (Blurred)`**
   - Tema terang dengan efek blur translusen macOS (`#FFFFFFAA`).
   - Kontras teks tinggi dengan estetika kertas putih bersih.
4. **`Cukup Light (Solid)`**
   - Latar belakang solid `#FFFFFF` & panel `#F8F9FA`.
5. **`Cukup OLED (Pure Black)`**
   - Hitam pekat sejati `#000000` untuk efisiensi energi dan rasio kontras maksimal di layar OLED / Liquid Retina XDR.

---

## ⚙️ Konfigurasi di Zed

Buka `~/.config/zed/settings.json` atau gunakan shortcut **`Cmd+K Cmd+T`** di Zed:

```json
{
  "theme": {
    "mode": "dark",
    "light": "Cukup Light (Blurred)",
    "dark": "Cukup Dark (Blurred)"
  }
}
```

---

## 🛠️ CLI Generator: `theme-builder.js`

```bash
# Build ulang cukup.json setelah mengubah palet
./theme-builder.js build

# Membuat keluarga tema baru turunan
./theme-builder.js new "NamaTheme"
```
