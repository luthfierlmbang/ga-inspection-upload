import crypto from 'node:crypto';

// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
export function validateInitData(initData, botToken, { maxAgeSec = 86400, now = Date.now() } = {}) {
  if (!botToken) return { ok: false, reason: 'bot_token_missing' };
  if (typeof initData !== 'string' || initData.length === 0 || initData.length > 8192) {
    return { ok: false, reason: 'init_data_missing' };
  }
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return { ok: false, reason: 'hash_missing' };
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'hash_mismatch' };
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, reason: 'auth_date_missing' };
  const ageSec = Math.floor(now / 1000) - authDate;
  if (ageSec > maxAgeSec) return { ok: false, reason: 'expired' };
  if (ageSec < -300) return { ok: false, reason: 'auth_date_in_future' };

  let user;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    return { ok: false, reason: 'user_invalid' };
  }
  if (!user || !Number.isSafeInteger(user.id)) return { ok: false, reason: 'user_invalid' };
  return { ok: true, user, authDate };
}

// Test helper: builds initData exactly like Telegram would.
export function signInitData(fields, botToken) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    params.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return params.toString();
}
