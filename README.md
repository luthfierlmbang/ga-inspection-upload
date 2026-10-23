# GA Inspection Upload

Telegram Mini App untuk **upload dan review foto inspection kendaraan** di GA Bot (PT Intek).
Dibuka dari tombol `web_app` di GA Bot. Ada dua tampilan:

- **Upload** (`/upload?booking=<id>&stage=<tahap>`): admin GA memilih banyak foto sekaligus (kamera atau galeri), foto dikompres di HP, diberi keterangan, lalu dikirim dengan progress per foto. Foto yang gagal bisa dikirim ulang tanpa mengulang yang sudah berhasil.
- **Review** (`/review`, `/review/<inspectionId>`): admin GA reviewer melihat daftar inspection (filter status, cari booking/plat), membuka foto per tahap (lightbox geser + zoom), lalu **Setujui** atau **Tolak** (alasan wajib).

Tahap inspection: `ga_pre` (GA Pre Inspection), `user_pre` (User Pre-Use Inspection), `user_return` (User Return Inspection), `ga_final` (GA Final Inspection).

Belum terhubung ke ERPNext/Sena. Semua penyimpanan ada di `server/src/storage.js` supaya bisa diganti.

## Struktur

```
server/   Express API (Node 22, ESM). Juga menyajikan web/dist di port yang sama.
  src/app.js           route /api/*
  src/telegramAuth.js  validasi initData Telegram
  src/auth.js          middleware auth + peran
  src/storage.js       SQLite (node:sqlite) + file foto. Satu-satunya modul penyimpanan.
  src/notify.js        notifikasi Telegram opsional
  test/                node:test
web/      React 19 + Vite 7 (JavaScript)
docs/screenshots/      hasil review UI 390x844 (mode dev)
Dockerfile, docker-compose.yml   contoh deploy (belum dijalankan)
```

## Menjalankan (dev)

Butuh Node 22.13+ (pakai `node:sqlite` bawaan).

```bash
cp .env.example .env
# isi di .env untuk uji lokal tanpa Telegram:
#   DEV_AUTH=1
#   GA_UPLOADER_IDS=111,333
#   GA_REVIEWER_IDS=222,333
npm run install:all
npm run dev:server     # API  http://127.0.0.1:8787
npm run dev:web        # Vite http://127.0.0.1:5180 (proxy /api ke 8787)
```

Buka di browser (mode dev, `dev_user` dipilih lewat query lalu diingat di localStorage):

- Upload: `http://127.0.0.1:5180/upload?booking=veh-28273edac6e145a0&stage=ga_pre&plate=2612%20KYC&dev_user=333`
- Review: `http://127.0.0.1:5180/review?dev_user=333`

Produksi (satu proses, satu port):

```bash
npm run install:all
npm run build
NODE_ENV=production npm start     # API + web di PORT
```

Test: `npm test`

## Environment

| Variabel | Wajib | Keterangan |
|---|---|---|
| `BOT_TOKEN` | ya (produksi) | Token GA Bot dari BotFather. Dipakai untuk validasi initData dan kirim notifikasi. |
| `GA_UPLOADER_IDS` | ya | ID Telegram admin GA yang boleh upload, dipisah koma. |
| `GA_REVIEWER_IDS` | ya | ID Telegram admin GA yang boleh review. Satu ID boleh ada di kedua daftar. |
| `PORT` | tidak | Default `8787`. |
| `HOST` | tidak | Default `127.0.0.1`. Pakai `0.0.0.0` di container. |
| `DB_PATH` | tidak | File SQLite. Default `./data/inspections.db`. |
| `UPLOAD_DIR` | tidak | Folder foto. Default `./uploads`. |
| `NOTIFY_ENABLED` | tidak | `1` untuk kirim notifikasi Telegram. Default mati. |
| `PUBLIC_APP_URL` | tidak | URL HTTPS publik app ini, untuk tombol `web_app` di notifikasi. |
| `PHOTO_URL_SECRET` | tidak | Kunci tanda tangan URL foto. Default diturunkan dari `BOT_TOKEN`. |
| `DEV_AUTH` | tidak | `1` = terima header `X-Dev-User` tanpa Telegram. **Selalu mati kalau `NODE_ENV=production`.** |
| `NODE_ENV` | tidak | `production` di server sungguhan. |

User ID di luar kedua daftar mendapat **403**. Uploader saja tidak bisa membuka review, reviewer saja tidak bisa upload.

## API

Semua `/api/*` (kecuali foto) butuh header `Authorization: tma <initData>` dari `Telegram.WebApp.initData`.
Di dev (`DEV_AUTH=1`) boleh `X-Dev-User: <id>` dan opsional `X-Dev-Name`.

| Method | Path | Peran | Fungsi |
|---|---|---|---|
| GET | `/api/me` | semua admin GA | user, peran, label tahap/result/status, batas |
| GET | `/api/bookings/:bookingId/stages/:stage` | uploader | jumlah foto yang sudah ada dan sisa kuota tahap |
| POST | `/api/submissions` | uploader | mulai sesi upload `{bookingId, stage, plate?, vehicle?, notes?, result?, photoCount}` |
| POST | `/api/submissions/:id/photos` | uploader (pemilik sesi) | multipart `photos` + `captions` + `positions` |
| POST | `/api/submissions/:id/complete` | uploader (pemilik sesi) | tutup sesi, status inspection kembali **Menunggu review**, kirim notifikasi |
| GET | `/api/inspections?status=&q=` | reviewer | daftar, urut terbaru. `status`: `pending` / `approved` / `rejected` |
| GET | `/api/inspections/:id` | reviewer | detail + foto (URL bertanda tangan, berlaku 6 jam) |
| POST | `/api/inspections/:id/review` | reviewer | `{decision: "approve"|"reject", reason, note}`. Tolak tanpa alasan = 400 |
| GET | `/api/photos/:id?exp=&sig=` | URL bertanda tangan | file foto (dipakai `<img>`, yang tidak bisa kirim header) |

Satu inspection = satu booking ID. Foto ditambahkan per tahap lewat sesi upload. Menambah foto baru setelah review mengembalikan status ke **Menunggu review**.

### Validasi upload

- Tipe dibaca dari **magic bytes**, bukan Content-Type atau nama file. Diterima JPEG, PNG, WebP. HEIC ditolak dengan pesan "kirim ulang sebagai JPEG" (di HP, kompresi client sudah mengubah ke JPEG kalau browser bisa membaca HEIC).
- Maks **10 MB per file**, maks **20 foto per tahap** (dicek saat membuat sesi dan saat menyimpan tiap foto).
- Nama file asli dibuang. File disimpan sebagai `UPLOAD_DIR/<inspectionId>/<stage>/<uuid>.<ext>`, path dicek tetap di dalam `UPLOAD_DIR`.
- Booking ID hanya `[A-Za-z0-9._-]`, maks 64 karakter.

### Kompresi di client

Sisi terpanjang maks 1600 px, JPEG kualitas 0.82, orientasi EXIF dihormati (`createImageBitmap(..., {imageOrientation: 'from-image'})`). Foto uji 1600x1200 menjadi sekitar 20 sampai 30 KB.

## Menambahkan tombol di GA Bot

Bot yang sedang berjalan **tidak diubah** oleh project ini. Yang perlu ditambahkan di kode GA Bot saat mengirim pesan booking ke admin GA adalah tombol `web_app`:

```json
{
  "chat_id": 123456789,
  "text": "Booking veh-28273edac6e145a0 (2612 KYC) disetujui. Silakan GA Pre Inspection.",
  "reply_markup": {
    "inline_keyboard": [
      [
        {
          "text": "Upload foto GA Pre Inspection",
          "web_app": {
            "url": "https://ga-inspection.example.co.id/upload?booking=veh-28273edac6e145a0&stage=ga_pre&plate=2612%20KYC"
          }
        }
      ],
      [
        { "text": "Review inspection", "web_app": { "url": "https://ga-inspection.example.co.id/review" } }
      ]
    ]
  }
}
```

Catatan:
- `web_app` di inline keyboard hanya berfungsi di **chat pribadi** dengan bot dan URL wajib **HTTPS**.
- Parameter `stage`: `ga_pre`, `user_pre`, `user_return`, `ga_final`. `plate` dan `vehicle` opsional (URL-encode).
- Di grup, pakai tombol `url` ke Direct Link Mini App (`https://t.me/<bot>/<appname>?startapp=...`). Itu butuh Mini App terdaftar di BotFather dan belum didukung routing `startapp` di app ini.

### Mendaftarkan di BotFather

1. `/mybots` lalu pilih GA Bot.
2. **Bot Settings, Configure Mini App** (atau **Menu Button**): isi URL HTTPS app ini, misalnya `https://ga-inspection.example.co.id/review`, supaya reviewer bisa membuka daftar dari tombol menu.
3. Opsional `/newapp` untuk membuat Direct Link Mini App.
4. Tombol `web_app` di inline keyboard tidak perlu didaftarkan, cukup domain HTTPS yang valid.

## Notifikasi (opsional)

`NOTIFY_ENABLED=1` + `BOT_TOKEN`:
- Setelah sesi upload selesai: pesan ke semua `GA_REVIEWER_IDS` dengan tombol `web_app` "Buka review" (kalau `PUBLIC_APP_URL` HTTPS diisi).
- Setelah review: pesan ke uploader inspection itu (status, alasan, catatan).
- Gagal kirim hanya dicatat di log, upload/review tetap sukses.
- Penerima harus pernah memulai chat dengan bot, kalau tidak Telegram menolak (403).

## Deploy ke server lain

Project ini **dibangun dan diuji di VPS build, bukan di-host di sana**. Untuk server tujuan:

1. **HTTPS wajib.** Telegram tidak membuka `web_app` dari URL http. Taruh app di belakang reverse proxy HTTPS (Caddy, Nginx, Traefik) di domain yang valid.
2. **Satu proses, satu port.** Express menyajikan `/api/*` dan hasil build `web/dist`. Proxy cukup meneruskan semua path ke `PORT`.
3. **Volume persisten** untuk `DB_PATH` (SQLite) dan `UPLOAD_DIR` (foto). Backup keduanya bersama-sama.
4. Set `NODE_ENV=production` (otomatis mematikan `DEV_AUTH`), isi `BOT_TOKEN`, `GA_UPLOADER_IDS`, `GA_REVIEWER_IDS`.
5. Batas body di reverse proxy minimal 12 MB (Nginx: `client_max_body_size 12m;`).

Dengan Docker (contoh, **belum dijalankan di VPS build**):

```bash
cp .env.example .env    # isi BOT_TOKEN, GA_UPLOADER_IDS, GA_REVIEWER_IDS, PUBLIC_APP_URL
docker compose up -d --build
# app di 127.0.0.1:8787, data di volume ga-inspection-data (/data)
```

Contoh Caddy di server tujuan:

```
ga-inspection.example.co.id {
  reverse_proxy 127.0.0.1:8787
}
```

## Mengganti penyimpanan

`server/src/storage.js` mengekspor `createStorage(config)` dengan fungsi: `stageCount`, `findInspectionByBooking`, `createSubmission`, `getSubmission`, `addPhoto`, `completeSubmission`, `listInspections`, `getInspection`, `reviewInspection`, `uploaderIdsFor`, `getPhoto`, `photoAbsolutePath`, `close`. Untuk ERPNext atau S3, buat modul baru dengan fungsi yang sama dan ganti import di `server/src/index.js`. Untuk S3, route `/api/photos/:id` perlu diganti menjadi redirect ke presigned URL.

## Status verifikasi

Sudah:
- Test otomatis server (`npm test`).
- E2E dengan curl dan gambar uji nyata di server lokal.
- Review UI di Chromium 390x844 dengan `DEV_AUTH` (screenshot di `docs/screenshots/`).
- `npm run build`.

Belum:
- Belum diuji di aplikasi Telegram asli (initData nyata, `Telegram.WebApp.close()`, kamera HP).
- Belum ada HTTPS / domain.
- Dockerfile dan docker-compose belum pernah dijalankan.
- Notifikasi belum dikirim ke Telegram sungguhan (hanya diuji dengan fetch tiruan).
- Belum terhubung ERPNext/Sena; data booking (plat/kendaraan) hanya dari query URL.
- Kompresi HEIC bergantung pada kemampuan browser HP membaca HEIC (iOS Safari bisa, Chrome Android umumnya tidak).
