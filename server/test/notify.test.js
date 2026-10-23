import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotifier } from '../src/notify.js';
import { loadConfig } from '../src/config.js';

const insp = { id: 'insp_1', booking_id: 'veh-1', plate: '2612 KYC', status: 'approved', reviewed_by_name: 'R' };
const sub = { stage: 'ga_pre', uploader_name: 'U' };
const quiet = { warn() {} };

test('notifikasi default mati: tidak memanggil Telegram', async () => {
  let called = 0;
  const n = createNotifier(loadConfig({ BOT_TOKEN: 'x:y', GA_REVIEWER_IDS: '1' }), { fetchImpl: async () => { called++; }, log: quiet });
  await n.uploadCompleted({ inspection: insp, submission: sub, photoCount: 2 });
  assert.equal(called, 0);
});

test('gagal kirim tidak melempar error', async () => {
  const warnings = [];
  const n = createNotifier(
    loadConfig({ BOT_TOKEN: 'x:y', NOTIFY_ENABLED: '1', GA_REVIEWER_IDS: '1,2', PUBLIC_APP_URL: 'https://ga.example.test' }),
    { fetchImpl: async () => { throw new Error('network down'); }, log: { warn: (m) => warnings.push(m) } },
  );
  await assert.doesNotReject(n.uploadCompleted({ inspection: insp, submission: sub, photoCount: 2 }));
  assert.equal(warnings.length, 2);
});

test('pesan ke reviewer memuat tombol web_app ke halaman review', async () => {
  const bodies = [];
  const n = createNotifier(
    loadConfig({ BOT_TOKEN: 'x:y', NOTIFY_ENABLED: '1', GA_REVIEWER_IDS: '7', PUBLIC_APP_URL: 'https://ga.example.test/' }),
    { fetchImpl: async (url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true }; }, log: quiet },
  );
  await n.uploadCompleted({ inspection: insp, submission: sub, photoCount: 3 });
  assert.equal(bodies[0].chat_id, '7');
  assert.equal(bodies[0].reply_markup.inline_keyboard[0][0].web_app.url, 'https://ga.example.test/review/insp_1');
});
