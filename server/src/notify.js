import { STAGES, STATUSES } from './config.js';

export function createNotifier(config, { fetchImpl = globalThis.fetch, log = console } = {}) {
  async function send(chatId, text, url) {
    const body = { chat_id: chatId, text, disable_web_page_preview: true };
    // Telegram only accepts web_app buttons with an HTTPS URL.
    if (url && url.startsWith('https://')) {
      body.reply_markup = { inline_keyboard: [[{ text: 'Buka review', web_app: { url } }]] };
    }
    const res = await fetchImpl(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`telegram_${res.status}`);
  }

  async function fanOut(ids, text, url) {
    const results = await Promise.allSettled([...ids].map((id) => send(id, text, url)));
    results.forEach((r, i) => {
      if (r.status === 'rejected') log.warn(`[notify] gagal kirim ke penerima #${i + 1}: ${r.reason?.message}`);
    });
  }

  return {
    enabled: config.notifyEnabled,
    // Never throws: notification failure must not fail the upload/review.
    async uploadCompleted({ inspection, submission, photoCount }) {
      if (!config.notifyEnabled) return;
      try {
        const text = [
          'Foto inspection baru',
          `Booking: ${inspection.booking_id}${inspection.plate ? ` (${inspection.plate})` : ''}`,
          `Tahap: ${STAGES[submission.stage]}`,
          `Jumlah foto: ${photoCount}`,
          `Oleh: ${submission.uploader_name}`,
        ].join('\n');
        const url = config.publicAppUrl ? `${config.publicAppUrl}/review/${inspection.id}` : '';
        await fanOut(config.reviewerIds, text, url);
      } catch (e) {
        log.warn(`[notify] ${e.message}`);
      }
    },
    async reviewed({ inspection, uploaderIds }) {
      if (!config.notifyEnabled) return;
      try {
        const lines = [
          `Inspection ${STATUSES[inspection.status].toLowerCase()}`,
          `Booking: ${inspection.booking_id}${inspection.plate ? ` (${inspection.plate})` : ''}`,
          `Reviewer: ${inspection.reviewed_by_name}`,
        ];
        if (inspection.reject_reason) lines.push(`Alasan: ${inspection.reject_reason}`);
        if (inspection.review_note) lines.push(`Catatan: ${inspection.review_note}`);
        await fanOut(uploaderIds, lines.join('\n'), '');
      } catch (e) {
        log.warn(`[notify] ${e.message}`);
      }
    },
  };
}
