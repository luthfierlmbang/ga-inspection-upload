import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadConfig } from '../src/config.js';
import { createStorage } from '../src/storage.js';
import { createApp } from '../src/app.js';
import { signInitData } from '../src/telegramAuth.js';

export const BOT_TOKEN = '123456:TEST-ONLY-NOT-A-REAL-TOKEN';
export const UPLOADER = 1001;
export const REVIEWER = 2002;
export const ADMIN = 3003;
export const STRANGER = 9009;

const silent = { warn() {}, error: (...a) => process.env.TEST_DEBUG && console.error(...a), log() {} };

export async function startTestServer(envOverrides = {}) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'ga-insp-test-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    BOT_TOKEN,
    GA_UPLOADER_IDS: `${UPLOADER},${ADMIN}`,
    GA_REVIEWER_IDS: `${REVIEWER},${ADMIN}`,
    DATA_DIR: path.join(dir, 'data'),
    UPLOAD_DIR: path.join(dir, 'uploads'),
    ...envOverrides,
  });
  config.webDist = path.join(dir, 'no-web');
  const storage = createStorage(config);
  const notifications = [];
  const notifier = {
    uploadCompleted: async (x) => notifications.push(['upload', x]),
    reviewed: async (x) => notifications.push(['review', x]),
  };
  const app = createApp({ config, storage, notifier, log: silent });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    config,
    dir,
    notifications,
    async close() {
      await new Promise((r) => server.close(r));
      storage.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function tmaHeader(userId, { authDate = Math.floor(Date.now() / 1000), token = BOT_TOKEN } = {}) {
  const initData = signInitData(
    { auth_date: String(authDate), query_id: 'AAE-test', user: { id: userId, first_name: `User${userId}` } },
    token,
  );
  return { authorization: `tma ${initData}` };
}

// Minimal valid 1x1 PNG, generated so no binary fixtures are needed.
export function tinyPng() {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, 200, 30, 50]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function fakeJpeg(size = 2048) {
  const b = Buffer.alloc(size, 0x11);
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = 0xff;
  b[3] = 0xe0;
  return b;
}

export async function api(base, method, url, { headers = {}, json, form } = {}) {
  const init = { method, headers: { ...headers } };
  if (json !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(json);
  }
  if (form) init.body = form;
  const res = await fetch(base + url, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

export function photoForm(files, captions = []) {
  const form = new FormData();
  files.forEach((f, i) => {
    form.append('photos', new Blob([f.buf], { type: f.type || 'image/jpeg' }), f.name || `foto-${i}.jpg`);
    form.append('captions', captions[i] || '');
  });
  return form;
}
