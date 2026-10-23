import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import {
  startTestServer, tmaHeader, api, photoForm, tinyPng, fakeJpeg,
  UPLOADER, REVIEWER, ADMIN, STRANGER,
} from './helpers.js';

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });

async function newSubmission(bookingId, { stage = 'ga_pre', photoCount = 1, user = UPLOADER, extra = {} } = {}) {
  const r = await api(srv.base, 'POST', '/api/submissions', {
    headers: tmaHeader(user),
    json: { bookingId, stage, photoCount, plate: '2612 KYC', notes: 'Ban depan aus', result: 'layak', ...extra },
  });
  return r;
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile());
}

describe('autentikasi dan peran', () => {
  test('tanpa auth -> 401', async () => {
    const r = await api(srv.base, 'GET', '/api/me');
    assert.equal(r.status, 401);
  });

  test('initData kedaluwarsa -> 401', async () => {
    const r = await api(srv.base, 'GET', '/api/me', { headers: tmaHeader(UPLOADER, { authDate: Math.floor(Date.now() / 1000) - 90000 }) });
    assert.equal(r.status, 401);
    assert.equal(r.body.reason, 'expired');
  });

  test('user Telegram valid tapi bukan admin GA -> 403', async () => {
    const r = await api(srv.base, 'GET', '/api/me', { headers: tmaHeader(STRANGER) });
    assert.equal(r.status, 403);
  });

  test('uploader tidak boleh membuka daftar review -> 403', async () => {
    const r = await api(srv.base, 'GET', '/api/inspections', { headers: tmaHeader(UPLOADER) });
    assert.equal(r.status, 403);
  });

  test('reviewer saja tidak boleh upload -> 403', async () => {
    const r = await newSubmission('veh-role-check', { user: REVIEWER });
    assert.equal(r.status, 403);
  });

  test('admin GA (di kedua daftar) punya dua peran', async () => {
    const r = await api(srv.base, 'GET', '/api/me', { headers: tmaHeader(ADMIN) });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.user.roles, ['uploader', 'reviewer']);
  });

  test('header X-Dev-User diabaikan kalau DEV_AUTH mati', async () => {
    const r = await api(srv.base, 'GET', '/api/me', { headers: { 'x-dev-user': String(ADMIN) } });
    assert.equal(r.status, 401);
  });

  test('DEV_AUTH=1 otomatis mati di production', () => {
    assert.equal(loadConfig({ NODE_ENV: 'production', DEV_AUTH: '1' }).devAuth, false);
    assert.equal(loadConfig({ NODE_ENV: 'development', DEV_AUTH: '1' }).devAuth, true);
  });
});

describe('validasi upload', () => {
  test('file bukan gambar ditolak walau Content-Type image/jpeg', async () => {
    const s = await newSubmission('veh-magic-01');
    assert.equal(s.status, 201);
    const form = photoForm([{ buf: Buffer.from('<?php echo "bukan gambar"; ?>'.padEnd(64, ' ')), type: 'image/jpeg', name: 'foto.jpg' }]);
    const r = await api(srv.base, 'POST', `/api/submissions/${s.body.submissionId}/photos`, { headers: tmaHeader(UPLOADER), form });
    assert.equal(r.status, 415);
  });

  test('HEIC ditolak dengan pesan jelas', async () => {
    const s = await newSubmission('veh-heic-01');
    const heic = Buffer.alloc(64);
    heic.write('ftypheic', 4, 'ascii');
    const r = await api(srv.base, 'POST', `/api/submissions/${s.body.submissionId}/photos`, { headers: tmaHeader(UPLOADER), form: photoForm([{ buf: heic, name: 'IMG_1.HEIC' }]) });
    assert.equal(r.status, 415);
    assert.match(r.body.error, /HEIC/);
  });

  test('file lebih dari 10 MB ditolak 413', async () => {
    const s = await newSubmission('veh-size-01');
    const big = fakeJpeg(10 * 1024 * 1024 + 10);
    const r = await api(srv.base, 'POST', `/api/submissions/${s.body.submissionId}/photos`, { headers: tmaHeader(UPLOADER), form: photoForm([{ buf: big }]) });
    assert.equal(r.status, 413);
    assert.equal(r.body.code, 'LIMIT_FILE_SIZE');
  });

  test('lebih dari 20 file dalam satu kiriman ditolak', async () => {
    const s = await newSubmission('veh-count-01', { photoCount: 20 });
    const files = Array.from({ length: 21 }, () => ({ buf: fakeJpeg(256) }));
    const r = await api(srv.base, 'POST', `/api/submissions/${s.body.submissionId}/photos`, { headers: tmaHeader(UPLOADER), form: photoForm(files) });
    assert.equal(r.status, 413);
    assert.equal(r.body.code, 'LIMIT_FILE_COUNT');
  });

  test('kuota 20 foto per tahap ditegakkan lintas kiriman', async () => {
    const booking = 'veh-quota-01';
    const s1 = await newSubmission(booking, { photoCount: 20 });
    const files = Array.from({ length: 18 }, () => ({ buf: fakeJpeg(256) }));
    const r1 = await api(srv.base, 'POST', `/api/submissions/${s1.body.submissionId}/photos`, { headers: tmaHeader(UPLOADER), form: photoForm(files) });
    assert.equal(r1.status, 201);
    await api(srv.base, 'POST', `/api/submissions/${s1.body.submissionId}/complete`, { headers: tmaHeader(UPLOADER) });

    const tooMany = await newSubmission(booking, { photoCount: 3 });
    assert.equal(tooMany.status, 413);
    assert.equal(tooMany.body.remaining, 2);

    const s2 = await newSubmission(booking, { photoCount: 2 });
    assert.equal(s2.status, 201);
    const three = Array.from({ length: 3 }, () => ({ buf: fakeJpeg(256) }));
    const r2 = await api(srv.base, 'POST', `/api/submissions/${s2.body.submissionId}/photos`, { headers: tmaHeader(UPLOADER), form: photoForm(three) });
    assert.equal(r2.status, 413);
    assert.equal(r2.body.saved.length, 2);
  });

  test('nama file berbahaya tidak dipakai, file disimpan dengan nama acak di dalam uploads/', async () => {
    const s = await newSubmission('veh-path-01');
    const evil = '../../../../etc/passwd.jpg';
    const r = await api(srv.base, 'POST', `/api/submissions/${s.body.submissionId}/photos`, {
      headers: tmaHeader(UPLOADER),
      form: photoForm([{ buf: tinyPng(), type: 'image/jpeg', name: evil }], ['<script>alert(1)</script>']),
    });
    assert.equal(r.status, 201);
    const uploadDir = srv.config.uploadDir;
    const files = listFiles(uploadDir);
    assert.ok(files.length >= 1);
    for (const f of files) {
      assert.ok(!f.includes('passwd'));
      assert.match(path.basename(f), /^[0-9a-f-]{36}\.(jpg|png|webp)$/);
      assert.ok(path.resolve(uploadDir, f).startsWith(uploadDir + path.sep));
    }
    assert.ok(files.some((f) => f.endsWith('.png')), 'tipe dideteksi dari isi (PNG), bukan dari nama .jpg');
  });

  test('booking ID dengan karakter path ditolak', async () => {
    const r = await newSubmission('../../etc');
    assert.equal(r.status, 400);
  });

  test('tahap tidak dikenal ditolak', async () => {
    const r = await newSubmission('veh-stage-01', { stage: 'ga_middle' });
    assert.equal(r.status, 400);
  });

  test('admin lain tidak bisa menambah foto ke sesi upload milik orang lain', async () => {
    const s = await newSubmission('veh-owner-01');
    const r = await api(srv.base, 'POST', `/api/submissions/${s.body.submissionId}/photos`, { headers: tmaHeader(ADMIN), form: photoForm([{ buf: fakeJpeg() }]) });
    assert.equal(r.status, 403);
  });
});

describe('alur review', () => {
  let inspectionId;
  test('upload lengkap muncul di daftar review dengan status Menunggu', async () => {
    const s = await newSubmission('veh-28273edac6e145a0', { photoCount: 2 });
    const up = await api(srv.base, 'POST', `/api/submissions/${s.body.submissionId}/photos`, {
      headers: tmaHeader(UPLOADER),
      form: photoForm([{ buf: fakeJpeg() }, { buf: tinyPng() }], ['Depan', 'Interior']),
    });
    assert.equal(up.status, 201);
    const done = await api(srv.base, 'POST', `/api/submissions/${s.body.submissionId}/complete`, { headers: tmaHeader(UPLOADER) });
    assert.equal(done.status, 200);
    assert.equal(done.body.photoCount, 2);
    inspectionId = done.body.inspectionId;
    assert.ok(srv.notifications.some(([k]) => k === 'upload'));

    const list = await api(srv.base, 'GET', '/api/inspections?status=pending&q=2612kyc', { headers: tmaHeader(REVIEWER) });
    assert.equal(list.status, 200);
    assert.ok(list.body.items.some((i) => i.id === inspectionId));

    const detail = await api(srv.base, 'GET', `/api/inspections/${inspectionId}`, { headers: tmaHeader(REVIEWER) });
    assert.equal(detail.body.photos.length, 2);
    assert.deepEqual(detail.body.photos.map((p) => p.caption), ['Depan', 'Interior']);
    const img = await fetch(srv.base + detail.body.photos[0].url);
    assert.equal(img.status, 200);
    const bad = await fetch(srv.base + detail.body.photos[0].url.replace(/sig=[^&]+/, 'sig=xxxx'));
    assert.equal(bad.status, 403);
  });

  test('urutan foto mengikuti pilihan uploader, bukan urutan selesai upload', async () => {
    const s = await newSubmission('veh-order-01', { photoCount: 3 });
    const send = (pos, cap) => {
      const form = new FormData();
      form.append('captions', cap);
      form.append('positions', String(pos));
      form.append('photos', new Blob([fakeJpeg()]), 'x.jpg');
      return api(srv.base, 'POST', `/api/submissions/${s.body.submissionId}/photos`, { headers: tmaHeader(UPLOADER), form });
    };
    await send(2, 'ketiga');
    await send(0, 'pertama');
    await send(1, 'kedua');
    const done = await api(srv.base, 'POST', `/api/submissions/${s.body.submissionId}/complete`, { headers: tmaHeader(UPLOADER) });
    const detail = await api(srv.base, 'GET', `/api/inspections/${done.body.inspectionId}`, { headers: tmaHeader(REVIEWER) });
    assert.deepEqual(detail.body.photos.map((p) => p.caption), ['pertama', 'kedua', 'ketiga']);
  });

  test('tolak tanpa alasan ditolak 400', async () => {
    const r = await api(srv.base, 'POST', `/api/inspections/${inspectionId}/review`, { headers: tmaHeader(REVIEWER), json: { decision: 'reject', reason: '   ' } });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /Alasan/);
  });

  test('tolak dengan alasan tersimpan beserta reviewer', async () => {
    const r = await api(srv.base, 'POST', `/api/inspections/${inspectionId}/review`, { headers: tmaHeader(REVIEWER), json: { decision: 'reject', reason: 'Foto dashboard kurang jelas', note: 'Ulang foto odometer' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'rejected');
    assert.equal(r.body.review.byId, String(REVIEWER));
    assert.equal(r.body.review.reason, 'Foto dashboard kurang jelas');
  });

  test('setujui mengubah status dan uploader tidak boleh review', async () => {
    const no = await api(srv.base, 'POST', `/api/inspections/${inspectionId}/review`, { headers: tmaHeader(UPLOADER), json: { decision: 'approve' } });
    assert.equal(no.status, 403);
    const r = await api(srv.base, 'POST', `/api/inspections/${inspectionId}/review`, { headers: tmaHeader(ADMIN), json: { decision: 'approve' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'approved');
    assert.equal(r.body.review.reason, null);
    const list = await api(srv.base, 'GET', '/api/inspections?status=approved', { headers: tmaHeader(REVIEWER) });
    assert.ok(list.body.items.some((i) => i.id === inspectionId));
  });

  test('daftar menyertakan counts per status yang mengikuti pencarian', async () => {
    const all = await api(srv.base, 'GET', '/api/inspections', { headers: tmaHeader(REVIEWER) });
    assert.equal(all.status, 200);
    const c = all.body.counts;
    assert.ok(c, 'counts ada');
    for (const k of ['pending', 'approved', 'rejected', 'all']) assert.equal(typeof c[k], 'number');
    assert.equal(c.all, c.pending + c.approved + c.rejected);
    assert.equal(c.all, all.body.items.length);
    assert.ok(c.approved >= 1);
    const pend = await api(srv.base, 'GET', '/api/inspections?status=pending', { headers: tmaHeader(REVIEWER) });
    assert.equal(pend.body.items.length, c.pending);
    assert.deepEqual(pend.body.counts, c, 'counts tidak dipengaruhi filter status');
    const none = await api(srv.base, 'GET', '/api/inspections?q=tidak-ada-zzz', { headers: tmaHeader(REVIEWER) });
    assert.deepEqual(none.body.counts, { pending: 0, approved: 0, rejected: 0, all: 0 });
  });

  test('keputusan tidak dikenal ditolak', async () => {
    const r = await api(srv.base, 'POST', `/api/inspections/${inspectionId}/review`, { headers: tmaHeader(REVIEWER), json: { decision: 'maybe' } });
    assert.equal(r.status, 400);
  });
});
