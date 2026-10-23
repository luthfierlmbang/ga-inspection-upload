export const STAGES = {
  ga_pre: 'GA Pre Inspection',
  user_pre: 'User Pre-Use Inspection',
  user_return: 'User Return Inspection',
  ga_final: 'GA Final Inspection',
};
export const STAGE_ORDER = ['ga_pre', 'user_pre', 'user_return', 'ga_final'];
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
