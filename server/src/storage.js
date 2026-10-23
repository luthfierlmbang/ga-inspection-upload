// The only module that knows how data is persisted. Swap this file (same exported
// interface) to move metadata to ERPNext/Sena or files to object storage.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS inspections (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL UNIQUE,
  plate TEXT,
  vehicle TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_by_id TEXT,
  reviewed_by_name TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  reject_reason TEXT
);
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL REFERENCES inspections(id),
  stage TEXT NOT NULL,
  uploader_id TEXT NOT NULL,
  uploader_name TEXT NOT NULL,
  notes TEXT,
  result TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  inspection_id TEXT NOT NULL REFERENCES inspections(id),
  stage TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  caption TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_insp_stage ON photos(inspection_id, stage);
CREATE INDEX IF NOT EXISTS idx_sub_insp ON submissions(inspection_id);
`;

const newId = (prefix) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
const nowIso = () => new Date().toISOString();

export function createStorage({ dbPath, uploadDir }) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  const photoCols = db.prepare('PRAGMA table_info(photos)').all().map((c) => c.name);
  if (!photoCols.includes('position')) db.exec('ALTER TABLE photos ADD COLUMN position INTEGER NOT NULL DEFAULT 0');
  const uploadRoot = path.resolve(uploadDir);

  function safeFilePath(rel) {
    const abs = path.resolve(uploadRoot, rel);
    if (!abs.startsWith(uploadRoot + path.sep)) throw new Error('path_outside_upload_dir');
    return abs;
  }

  const q = {
    inspByBooking: db.prepare('SELECT * FROM inspections WHERE booking_id = ?'),
    inspById: db.prepare('SELECT * FROM inspections WHERE id = ?'),
    insertInsp: db.prepare(
      'INSERT INTO inspections (id, booking_id, plate, vehicle, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ),
    fillInspMeta: db.prepare(
      'UPDATE inspections SET plate = COALESCE(plate, ?), vehicle = COALESCE(vehicle, ?) WHERE id = ?',
    ),
    insertSub: db.prepare(
      'INSERT INTO submissions (id, inspection_id, stage, uploader_id, uploader_name, notes, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    subById: db.prepare('SELECT * FROM submissions WHERE id = ?'),
    countStage: db.prepare('SELECT COUNT(*) AS n FROM photos WHERE inspection_id = ? AND stage = ?'),
    insertPhoto: db.prepare(
      'INSERT INTO photos (id, submission_id, inspection_id, stage, file_path, mime, size, caption, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    deletePhoto: db.prepare('DELETE FROM photos WHERE id = ?'),
    photoById: db.prepare('SELECT * FROM photos WHERE id = ?'),
    photosBySub: db.prepare('SELECT * FROM photos WHERE submission_id = ? ORDER BY position, rowid'),
    // Photos keep the order the uploader picked them in, even though they upload in parallel.
    photosByInsp: db.prepare(
      'SELECT p.* FROM photos p JOIN submissions s ON s.id = p.submission_id WHERE p.inspection_id = ? ORDER BY s.created_at, p.position, p.rowid',
    ),
    subsByInsp: db.prepare('SELECT * FROM submissions WHERE inspection_id = ? ORDER BY created_at'),
    completeSub: db.prepare('UPDATE submissions SET completed_at = ? WHERE id = ?'),
    resetInspPending: db.prepare(
      "UPDATE inspections SET status = 'pending', updated_at = ?, reviewed_by_id = NULL, reviewed_by_name = NULL, reviewed_at = NULL, review_note = NULL, reject_reason = NULL WHERE id = ?",
    ),
    review: db.prepare(
      'UPDATE inspections SET status = ?, reviewed_by_id = ?, reviewed_by_name = ?, reviewed_at = ?, review_note = ?, reject_reason = ?, updated_at = ? WHERE id = ?',
    ),
  };

  function ensureInspection({ bookingId, plate, vehicle }) {
    let insp = q.inspByBooking.get(bookingId);
    if (!insp) {
      const t = nowIso();
      q.insertInsp.run(newId('insp'), bookingId, plate || null, vehicle || null, 'pending', t, t);
      insp = q.inspByBooking.get(bookingId);
    } else if (plate || vehicle) {
      q.fillInspMeta.run(plate || null, vehicle || null, insp.id);
    }
    return insp;
  }

  return {
    stageCount(bookingId, stage) {
      const insp = q.inspByBooking.get(bookingId);
      return insp ? q.countStage.get(insp.id, stage).n : 0;
    },

    findInspectionByBooking(bookingId) {
      return q.inspByBooking.get(bookingId) || null;
    },

    createSubmission({ bookingId, plate, vehicle, stage, uploader, notes, result }) {
      const insp = ensureInspection({ bookingId, plate, vehicle });
      const id = newId('sub');
      q.insertSub.run(id, insp.id, stage, uploader.id, uploader.name, notes || null, result || null, nowIso());
      return { submission: q.subById.get(id), inspection: q.inspById.get(insp.id) };
    },

    getSubmission(id) {
      return q.subById.get(id) || null;
    },

    // Reserves a slot synchronously (so concurrent requests cannot exceed the cap),
    // then writes the file. The DB row is removed again if the write fails.
    async addPhoto({ submission, buffer, mime, ext, caption, position = 0, maxPerStage }) {
      const count = q.countStage.get(submission.inspection_id, submission.stage).n;
      if (count >= maxPerStage) {
        const err = new Error('stage_full');
        err.code = 'STAGE_FULL';
        throw err;
      }
      const id = newId('ph');
      const rel = path.join(submission.inspection_id, submission.stage, `${crypto.randomUUID()}.${ext}`);
      const abs = safeFilePath(rel);
      q.insertPhoto.run(id, submission.id, submission.inspection_id, submission.stage, rel, mime, buffer.length, caption || null, position, nowIso());
      try {
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        await fsp.writeFile(abs, buffer, { flag: 'wx' });
      } catch (e) {
        q.deletePhoto.run(id);
        throw e;
      }
      return q.photoById.get(id);
    },

    completeSubmission(id) {
      const sub = q.subById.get(id);
      if (!sub) return null;
      const t = nowIso();
      q.completeSub.run(t, id);
      // New evidence means any earlier decision is stale.
      q.resetInspPending.run(t, sub.inspection_id);
      return {
        submission: q.subById.get(id),
        inspection: q.inspById.get(sub.inspection_id),
        photos: q.photosBySub.all(id),
      };
    },

    listInspections({ status, search, limit = 100 } = {}) {
      const where = [];
      const args = [];
      if (status) {
        where.push('i.status = ?');
        args.push(status);
      }
      if (search) {
        where.push("(LOWER(i.booking_id) LIKE ? ESCAPE '\\' OR LOWER(REPLACE(COALESCE(i.plate,''),' ','')) LIKE ? ESCAPE '\\')");
        const esc = search.toLowerCase().replace(/[\\%_]/g, (m) => '\\' + m);
        args.push(`%${esc}%`, `%${esc.replace(/\s+/g, '')}%`);
      }
      const sql = `
        SELECT i.*,
          (SELECT COUNT(*) FROM photos p WHERE p.inspection_id = i.id) AS photo_count,
          (SELECT GROUP_CONCAT(DISTINCT stage) FROM photos p WHERE p.inspection_id = i.id) AS stages
        FROM inspections i
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY i.updated_at DESC
        LIMIT ?`;
      return db.prepare(sql).all(...args, Math.min(Number(limit) || 100, 500));
    },

    getInspection(id) {
      const insp = q.inspById.get(id);
      if (!insp) return null;
      return { ...insp, submissions: q.subsByInsp.all(id), photos: q.photosByInsp.all(id) };
    },

    reviewInspection(id, { status, reviewer, note, reason }) {
      const t = nowIso();
      q.review.run(status, reviewer.id, reviewer.name, t, note || null, reason || null, t, id);
      return q.inspById.get(id);
    },

    uploaderIdsFor(inspectionId) {
      return [...new Set(q.subsByInsp.all(inspectionId).map((s) => s.uploader_id))];
    },

    getPhoto(id) {
      return q.photoById.get(id) || null;
    },

    photoAbsolutePath(photo) {
      return safeFilePath(photo.file_path);
    },

    close() {
      db.close();
    },
  };
}
