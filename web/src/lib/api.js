import { tg } from './telegram.js';

// Outside Telegram (dev only) the server accepts X-Dev-User when DEV_AUTH=1.
// Pick the dev user with ?dev_user=<id>; it is remembered in localStorage.
function devUser() {
  const q = new URLSearchParams(window.location.search).get('dev_user');
  if (q && /^\d+$/.test(q)) localStorage.setItem('dev_user', q);
  return localStorage.getItem('dev_user');
}

export function authHeaders() {
  const initData = tg()?.initData;
  if (initData) return { authorization: `tma ${initData}` };
  const id = devUser();
  return id ? { 'x-dev-user': id } : {};
}

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function parse(res) {
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) throw new ApiError(res.status, body?.error || `Gagal (HTTP ${res.status})`, body);
  return body;
}

export async function apiGet(path) {
  let res;
  try {
    res = await fetch(path, { headers: authHeaders() });
  } catch {
    throw new ApiError(0, 'Tidak bisa terhubung ke server. Cek koneksi internet.');
  }
  return parse(res);
}

export async function apiPost(path, json) {
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(json ?? {}),
    });
  } catch {
    throw new ApiError(0, 'Tidak bisa terhubung ke server. Cek koneksi internet.');
  }
  return parse(res);
}

// XHR because fetch has no upload progress events.
export function uploadPhoto(submissionId, blob, caption, position, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/submissions/${encodeURIComponent(submissionId)}/photos`);
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(xhr.status, body?.error || `Gagal (HTTP ${xhr.status})`, body));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Koneksi terputus'));
    xhr.ontimeout = () => reject(new ApiError(0, 'Waktu upload habis'));
    xhr.timeout = 120000;
    const form = new FormData();
    form.append('captions', caption || '');
    form.append('positions', String(position));
    form.append('photos', blob, 'foto.jpg');
    xhr.send(form);
  });
}
