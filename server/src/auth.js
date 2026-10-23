import { validateInitData } from './telegramAuth.js';

function displayName(u) {
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  return (name || u.username || `ID ${u.id}`).slice(0, 80);
}

export function authMiddleware(config) {
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    let user = null;

    if (header.startsWith('tma ')) {
      const result = validateInitData(header.slice(4), config.botToken, {
        maxAgeSec: config.initDataMaxAgeSec,
      });
      if (!result.ok) return res.status(401).json({ error: 'Sesi Telegram tidak valid', reason: result.reason });
      user = { id: String(result.user.id), name: displayName(result.user) };
    } else if (config.devAuth && req.get('x-dev-user')) {
      const id = String(req.get('x-dev-user')).trim();
      if (!/^\d{1,20}$/.test(id)) return res.status(401).json({ error: 'X-Dev-User harus angka' });
      const name = String(req.get('x-dev-name') || `Dev ${id}`).slice(0, 80);
      user = { id, name, dev: true };
    } else {
      return res.status(401).json({ error: 'Buka halaman ini dari GA Bot Telegram' });
    }

    const roles = [];
    if (config.uploaderIds.has(user.id)) roles.push('uploader');
    if (config.reviewerIds.has(user.id)) roles.push('reviewer');
    if (roles.length === 0) return res.status(403).json({ error: 'Akun Telegram ini belum terdaftar sebagai admin GA' });
    req.user = { ...user, roles };
    next();
  };
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user?.roles.includes(role)) {
      const label = role === 'uploader' ? 'upload foto' : 'review inspection';
      return res.status(403).json({ error: `Akun ini tidak punya akses ${label}` });
    }
    next();
  };
}
