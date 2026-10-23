import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { STAGES, RESULTS, STATUSES } from './config.js';
import { authMiddleware, requireRole } from './auth.js';
import { detectImageType } from './fileType.js';

const BOOKING_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PLATE_RE = /^[A-Za-z0-9 ]{1,16}$/;

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max) : '');

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function signPhoto(secret, id, exp) {
  return crypto.createHmac('sha256', secret).update(`${id}.${exp}`).digest('base64url');
}

export function createApp({ config, storage, notifier, log = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });

  const photoUrl = (id) => {
    const exp = Math.floor(Date.now() / 1000) + 6 * 3600;
    return `/api/photos/${id}?exp=${exp}&sig=${signPhoto(config.photoSecret, id, exp)}`;
  };

  // Photos are loaded by <img>, which cannot send the Authorization header,
  // so they are authorised by a short-lived signed URL handed out by the authenticated API.
  app.get('/api/photos/:id', (req, res) => {
    const { id } = req.params;
    const exp = Number(req.query.exp);
    const sig = String(req.query.sig || '');
    const expected = signPhoto(config.photoSecret, id, exp);
    const ok =
      Number.isFinite(exp) &&
      exp > Date.now() / 1000 &&
      sig.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!ok) return res.status(403).json({ error: 'Link foto kedaluwarsa' });
    const photo = storage.getPhoto(id);
    if (!photo) return res.status(404).json({ error: 'Foto tidak ditemukan' });
    res.set('Cache-Control', 'private, max-age=3600');
    res.type(photo.mime);
    // Path comes from the DB, not the request; allow dot-dirs in the install path.
    res.sendFile(storage.photoAbsolutePath(photo), { dotfiles: 'allow' });
  });

  const api = express.Router();
  api.use(express.json({ limit: '32kb' }));
  api.use(authMiddleware(config));

  api.get('/me', (req, res) => {
    res.json({ user: req.user, stages: STAGES, results: RESULTS, statuses: STATUSES, limits: { maxPhotosPerStage: config.maxPhotosPerStage, maxFileBytes: config.maxFileBytes } });
  });

  api.get('/bookings/:bookingId/stages/:stage', requireRole('uploader'), (req, res) => {
    const { bookingId, stage } = req.params;
    if (!BOOKING_RE.test(bookingId)) throw new HttpError(400, 'ID booking tidak valid');
    if (!STAGES[stage]) throw new HttpError(400, 'Tahap inspection tidak valid');
    const insp = storage.findInspectionByBooking(bookingId);
    const count = storage.stageCount(bookingId, stage);
    res.json({
      inspectionId: insp?.id || null,
      plate: insp?.plate || null,
      vehicle: insp?.vehicle || null,
      status: insp?.status || null,
      count,
      remaining: Math.max(0, config.maxPhotosPerStage - count),
    });
  });

  api.post('/submissions', requireRole('uploader'), (req, res) => {
    const b = req.body || {};
    const bookingId = clean(b.bookingId, 64);
    const stage = clean(b.stage, 20);
    const plate = clean(b.plate, 16).toUpperCase();
    const vehicle = clean(b.vehicle, 60);
    const result = clean(b.result, 20);
    const notes = clean(b.notes, 2000);
    const photoCount = Number(b.photoCount);
    if (!BOOKING_RE.test(bookingId)) throw new HttpError(400, 'ID booking tidak valid');
    if (!STAGES[stage]) throw new HttpError(400, 'Tahap inspection tidak valid');
    if (plate && !PLATE_RE.test(plate)) throw new HttpError(400, 'Plat nomor tidak valid');
    if (result && !RESULTS[result]) throw new HttpError(400, 'Result tidak valid');
    if (!Number.isInteger(photoCount) || photoCount < 1) throw new HttpError(400, 'Pilih minimal satu foto');
    const remaining = config.maxPhotosPerStage - storage.stageCount(bookingId, stage);
    if (photoCount > remaining) {
      throw new HttpError(413, `Tahap ini sudah berisi ${config.maxPhotosPerStage - remaining} foto. Sisa kuota ${Math.max(0, remaining)} foto.`, { remaining: Math.max(0, remaining) });
    }
    const { submission, inspection } = storage.createSubmission({ bookingId, plate, vehicle, stage, uploader: req.user, notes, result });
    res.status(201).json({ submissionId: submission.id, inspectionId: inspection.id, remaining });
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxFileBytes, files: config.maxPhotosPerStage, fields: 40, fieldSize: 2048, parts: 80 },
  });

  const loadOwnSubmission = (req, res, next) => {
    const sub = storage.getSubmission(req.params.id);
    if (!sub) return next(new HttpError(404, 'Sesi upload tidak ditemukan'));
    if (sub.uploader_id !== req.user.id) return next(new HttpError(403, 'Sesi upload ini milik admin lain'));
    if (sub.completed_at) return next(new HttpError(409, 'Sesi upload sudah ditutup. Mulai upload baru.'));
    req.submission = sub;
    next();
  };

  api.post('/submissions/:id/photos', requireRole('uploader'), loadOwnSubmission, upload.array('photos'), async (req, res) => {
    const files = req.files || [];
    if (files.length === 0) throw new HttpError(400, 'Tidak ada file foto');
    const captions = [].concat(req.body?.captions ?? req.body?.caption ?? []);
    const positions = [].concat(req.body?.positions ?? []);
    const checked = files.map((f, i) => {
      const type = detectImageType(f.buffer);
      if (!type) throw new HttpError(415, `File ke-${i + 1} bukan gambar JPEG, PNG, atau WebP`);
      if (type.unsupported) throw new HttpError(415, `File ke-${i + 1} berformat HEIC. Kirim ulang sebagai JPEG.`);
      const pos = Number.parseInt(positions[i], 10);
      return { f, type, caption: clean(captions[i], 300), position: Number.isInteger(pos) && pos >= 0 && pos < 1000 ? pos : i };
    });
    const saved = [];
    for (const { f, type, caption, position } of checked) {
      try {
        const p = await storage.addPhoto({ submission: req.submission, buffer: f.buffer, mime: type.mime, ext: type.ext, caption, position, maxPerStage: config.maxPhotosPerStage });
        saved.push({ id: p.id, size: p.size, caption: p.caption });
      } catch (e) {
        if (e.code === 'STAGE_FULL') throw new HttpError(413, `Batas ${config.maxPhotosPerStage} foto per tahap sudah tercapai`, { saved });
        throw e;
      }
    }
    res.status(201).json({ photos: saved });
  });

  api.post('/submissions/:id/complete', requireRole('uploader'), loadOwnSubmission, (req, res) => {
    const out = storage.completeSubmission(req.submission.id);
    if (out.photos.length === 0) throw new HttpError(400, 'Belum ada foto yang berhasil diupload');
    notifier.uploadCompleted({ inspection: out.inspection, submission: out.submission, photoCount: out.photos.length });
    res.json({
      inspectionId: out.inspection.id,
      bookingId: out.inspection.booking_id,
      stage: out.submission.stage,
      photoCount: out.photos.length,
      notes: out.submission.notes,
      result: out.submission.result,
      completedAt: out.submission.completed_at,
    });
  });

  api.get('/inspections', requireRole('reviewer'), (req, res) => {
    const status = clean(req.query.status, 20);
    if (status && !STATUSES[status]) throw new HttpError(400, 'Status tidak valid');
    const search = clean(req.query.q, 64);
    const items = storage.listInspections({ status: status || null, search: search || null }).map((i) => ({
      id: i.id,
      bookingId: i.booking_id,
      plate: i.plate,
      vehicle: i.vehicle,
      status: i.status,
      photoCount: i.photo_count,
      stages: i.stages ? i.stages.split(',') : [],
      updatedAt: i.updated_at,
      reviewedByName: i.reviewed_by_name,
    }));
    const counts = storage.countInspections({ search: search || null });
    res.json({ items, counts });
  });

  api.get('/inspections/:id', requireRole('reviewer'), (req, res) => {
    const insp = storage.getInspection(req.params.id);
    if (!insp) throw new HttpError(404, 'Inspection tidak ditemukan');
    const subs = insp.submissions.filter((s) => s.completed_at);
    const subIds = new Set(subs.map((s) => s.id));
    res.json({
      id: insp.id,
      bookingId: insp.booking_id,
      plate: insp.plate,
      vehicle: insp.vehicle,
      status: insp.status,
      createdAt: insp.created_at,
      updatedAt: insp.updated_at,
      review: insp.reviewed_at
        ? { byId: insp.reviewed_by_id, byName: insp.reviewed_by_name, at: insp.reviewed_at, note: insp.review_note, reason: insp.reject_reason }
        : null,
      submissions: subs.map((s) => ({
        id: s.id,
        stage: s.stage,
        uploaderId: s.uploader_id,
        uploaderName: s.uploader_name,
        notes: s.notes,
        result: s.result,
        completedAt: s.completed_at,
      })),
      photos: insp.photos
        .filter((p) => subIds.has(p.submission_id))
        .map((p) => ({ id: p.id, submissionId: p.submission_id, stage: p.stage, caption: p.caption, size: p.size, createdAt: p.created_at, url: photoUrl(p.id) })),
    });
  });

  api.post('/inspections/:id/review', requireRole('reviewer'), (req, res) => {
    const insp = storage.getInspection(req.params.id);
    if (!insp) throw new HttpError(404, 'Inspection tidak ditemukan');
    const decision = clean(req.body?.decision, 10);
    const note = clean(req.body?.note, 1000);
    const reason = clean(req.body?.reason, 500);
    if (decision !== 'approve' && decision !== 'reject') throw new HttpError(400, 'Keputusan harus approve atau reject');
    if (decision === 'reject' && !reason) throw new HttpError(400, 'Alasan penolakan wajib diisi');
    if (!insp.submissions.some((s) => s.completed_at)) throw new HttpError(409, 'Belum ada foto untuk direview');
    const updated = storage.reviewInspection(insp.id, {
      status: decision === 'approve' ? 'approved' : 'rejected',
      reviewer: req.user,
      note,
      reason: decision === 'reject' ? reason : '',
    });
    notifier.reviewed({ inspection: updated, uploaderIds: storage.uploaderIdsFor(insp.id) });
    res.json({
      id: updated.id,
      status: updated.status,
      review: { byId: updated.reviewed_by_id, byName: updated.reviewed_by_name, at: updated.reviewed_at, note: updated.review_note, reason: updated.reject_reason },
    });
  });

  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));

  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(upload|review)(\/.*)?$|^\/$/, (req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      const map = {
        LIMIT_FILE_SIZE: [413, `Ukuran foto melebihi ${Math.round(config.maxFileBytes / 1048576)} MB`],
        LIMIT_FILE_COUNT: [413, `Maksimal ${config.maxPhotosPerStage} foto per kiriman`],
        LIMIT_UNEXPECTED_FILE: [400, 'Field file harus bernama photos'],
      };
      const [status, message] = map[err.code] || [400, 'Data upload tidak valid'];
      return res.status(status).json({ error: message, code: err.code });
    }
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON tidak valid' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Data terlalu besar' });
    log.error('[error]', err);
    res.status(500).json({ error: 'Terjadi kesalahan di server' });
  });

  return app;
}
