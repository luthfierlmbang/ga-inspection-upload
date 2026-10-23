export const STAGES = {
  ga_pre: 'GA Pre Inspection',
  user_pre: 'User Pre-Use Inspection',
  user_return: 'User Return Inspection',
  ga_final: 'GA Final Inspection',
};
export const STAGE_ORDER = ['ga_pre', 'user_pre', 'user_return', 'ga_final'];
// Short labels for tight places (progress strip, stage chips).
export const STAGE_SHORT = { ga_pre: 'Pre GA', user_pre: 'Pre User', user_return: 'Return', ga_final: 'Final' };
export const RESULTS = { layak: 'Layak', perbaikan: 'Perlu perbaikan', tidak_layak: 'Tidak layak' };
export const STATUSES = { pending: 'Menunggu review', approved: 'Disetujui', rejected: 'Ditolak' };

const dtf = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(iso) {
  if (!iso) return '';
  return dtf.format(new Date(iso)).replace(/\./g, ':');
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

const dShort = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' });

// "baru saja", "5 menit lalu", "2 jam lalu", "kemarin", "3 hari lalu", then a short date.
export function relativeTime(iso, now = Date.now()) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'baru saja';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'kemarin';
  if (d < 7) return `${d} hari lalu`;
  return dShort.format(new Date(t));
}

export function shortId(id) {
  return id && id.length > 8 ? id.slice(-6) : id || '';
}
