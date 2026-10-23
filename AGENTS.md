# AGENTS.md

Telegram Mini App untuk upload dan review foto inspection kendaraan GA Bot (PT Intek).
Bahasa UI dan dokumen: Bahasa Indonesia.

## Peta
- `server/src/index.js`: entry. Baca env, jalankan Express (API + sajikan `web/dist`).
- `server/src/app.js`: semua route `/api/*`, validasi upload, error handler.
- `server/src/telegramAuth.js`: validasi initData Mini App (HMAC, auth_date 24 jam).
- `server/src/auth.js`: middleware auth + peran dari `GA_UPLOADER_IDS` / `GA_REVIEWER_IDS`; `DEV_AUTH` hanya di non-production.
- `server/src/storage.js`: SATU-SATUNYA modul penyimpanan (SQLite `node:sqlite` + file di `UPLOAD_DIR`). Ganti modul ini untuk ERPNext/S3, antarmuka tetap.
- `server/src/notify.js`: notifikasi Telegram opsional (`NOTIFY_ENABLED=1`).
- `server/test/*.test.js`: `node:test`.
- `web/src/pages/`: `UploadPage`, `ReviewList`, `ReviewDetail`. Router kecil di `web/src/router.jsx`.

## Cara jalan (dev)
```
cp .env.example .env        # isi DEV_AUTH=1 dan ID uji
npm run install:all
npm run dev:server          # API di 127.0.0.1:8787
npm run dev:web             # Vite di 127.0.0.1:5180, proxy /api ke 8787
```
Buka `http://127.0.0.1:5180/upload?booking=veh-28273edac6e145a0&stage=ga_pre&plate=2612%20KYC&dev_user=<id>`.

## Port
- 8787 API (produksi: satu proses menyajikan API + web).
- 5180 Vite dev.
- Jangan sentuh port lain di VPS build ini (22, 80, 2019, 4321, 4400, 5432, 20128, 44565).

## Aturan
- Jangan commit `.env`, `data/`, `uploads/`.
- Jangan ubah bot GA yang sedang berjalan; integrasi bot cukup lewat tombol `web_app`.
- Test: `npm test`. Build: `npm run build`.
