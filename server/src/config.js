import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(here, '..', '..');

export const STAGES = {
  ga_pre: 'GA Pre Inspection',
  user_pre: 'User Pre-Use Inspection',
  user_return: 'User Return Inspection',
  ga_final: 'GA Final Inspection',
};
export const RESULTS = {
  layak: 'Layak',
  perbaikan: 'Perlu perbaikan',
  tidak_layak: 'Tidak layak',
};
export const STATUSES = {
  pending: 'Menunggu review',
  approved: 'Disetujui',
  rejected: 'Ditolak',
};

function parseIds(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^\d{1,20}$/.test(s)),
  );
}

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const botToken = env.BOT_TOKEN || '';
  const photoSecret =
    env.PHOTO_URL_SECRET ||
    (botToken
      ? crypto.createHmac('sha256', 'photo-url').update(botToken).digest('hex')
      : crypto.randomBytes(32).toString('hex'));
  return {
    production,
    port: Number(env.PORT) || 8787,
    host: env.HOST || '127.0.0.1',
    botToken,
    uploaderIds: parseIds(env.GA_UPLOADER_IDS),
    reviewerIds: parseIds(env.GA_REVIEWER_IDS),
    publicAppUrl: (env.PUBLIC_APP_URL || '').replace(/\/+$/, ''),
    notifyEnabled: env.NOTIFY_ENABLED === '1' && Boolean(botToken),
    // Dev auth can never be on in production, whatever DEV_AUTH says.
    devAuth: !production && env.DEV_AUTH === '1',
    photoSecret,
    initDataMaxAgeSec: 24 * 60 * 60,
    maxPhotosPerStage: 20,
    maxFileBytes: 10 * 1024 * 1024,
    dbPath: path.resolve(env.DB_PATH || path.join(PROJECT_ROOT, 'data', 'inspections.db')),
    uploadDir: path.resolve(env.UPLOAD_DIR || path.join(PROJECT_ROOT, 'uploads')),
    webDist: path.join(PROJECT_ROOT, 'web', 'dist'),
  };
}
