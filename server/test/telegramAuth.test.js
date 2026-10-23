import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateInitData, signInitData } from '../src/telegramAuth.js';
import { BOT_TOKEN } from './helpers.js';

const user = { id: 555, first_name: 'Budi' };

test('initData valid diterima dan user terbaca', () => {
  const now = Date.now();
  const data = signInitData({ auth_date: String(Math.floor(now / 1000)), user }, BOT_TOKEN);
  const r = validateInitData(data, BOT_TOKEN, { now });
  assert.equal(r.ok, true);
  assert.equal(r.user.id, 555);
});

test('initData dengan hash salah ditolak', () => {
  const data = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user }, BOT_TOKEN);
  const tampered = data.replace(/hash=([a-f0-9])/, (m, c) => `hash=${c === 'a' ? 'b' : 'a'}`);
  assert.deepEqual(validateInitData(tampered, BOT_TOKEN), { ok: false, reason: 'hash_mismatch' });
});

test('initData yang isinya diubah (user lain) ditolak', () => {
  const data = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user }, BOT_TOKEN);
  const params = new URLSearchParams(data);
  params.set('user', JSON.stringify({ id: 1, first_name: 'Penyusup' }));
  assert.equal(validateInitData(params.toString(), BOT_TOKEN).reason, 'hash_mismatch');
});

test('initData ditandatangani token lain ditolak', () => {
  const data = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user }, '999:OTHER');
  assert.equal(validateInitData(data, BOT_TOKEN).reason, 'hash_mismatch');
});

test('initData lebih tua dari 24 jam ditolak sebagai kedaluwarsa', () => {
  const now = Date.now();
  const old = Math.floor(now / 1000) - 24 * 3600 - 60;
  const data = signInitData({ auth_date: String(old), user }, BOT_TOKEN);
  assert.deepEqual(validateInitData(data, BOT_TOKEN, { now }), { ok: false, reason: 'expired' });
});

test('initData tanpa hash atau kosong ditolak', () => {
  assert.equal(validateInitData('', BOT_TOKEN).ok, false);
  assert.equal(validateInitData('auth_date=1&user=%7B%7D', BOT_TOKEN).reason, 'hash_missing');
  assert.equal(validateInitData('x', '').reason, 'bot_token_missing');
});
