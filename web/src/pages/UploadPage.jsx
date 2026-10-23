import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost, uploadPhoto } from '../lib/api.js';
import { compressImage } from '../lib/compress.js';
import { STAGES, RESULTS, formatBytes } from '../lib/format.js';
import { closeMiniApp, haptic } from '../lib/telegram.js';
import { AppHeader, SectionLabel, Notice, Loading, ProgressBar } from '../components/Layout.jsx';
import { Link } from '../router.jsx';
import Icon from '../components/Icon.jsx';

const MAX_PHOTOS = 20;
const MAX_BYTES = 10 * 1024 * 1024;
const BOOKING_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
let seq = 0;

function readParams(search) {
  const q = new URLSearchParams(search);
  return {
    booking: (q.get('booking') || '').trim(),
    stage: (q.get('stage') || '').trim(),
    plate: (q.get('plate') || '').trim().slice(0, 16),
    vehicle: (q.get('vehicle') || '').trim().slice(0, 60),
  };
}

const STATUS_TEXT = {
  compressing: 'Mengompres',
  ready: 'Siap kirim',
  uploading: 'Mengirim',
  done: 'Terkirim',
  failed: 'Gagal',
  invalid: 'Ditolak',
};

export default function UploadPage({ me, search }) {
  const params = useMemo(() => readParams(search), [search]);
  const paramError = !BOOKING_RE.test(params.booking)
    ? 'ID booking tidak ada atau tidak valid di link.'
    : !STAGES[params.stage]
      ? 'Tahap inspection tidak dikenal di link.'
      : null;
  const canUpload = me.roles.includes('uploader');

  const [info, setInfo] = useState({ loading: true });
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState('');
  const [submissionId, setSubmissionId] = useState(null);
  const [phase, setPhase] = useState('edit'); // edit | uploading | partial | done
  const [formError, setFormError] = useState('');
  const [summary, setSummary] = useState(null);
  const galleryRef = useRef(null);
  const cameraRef = useRef(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    if (paramError || !canUpload) return;
    let alive = true;
    setInfo({ loading: true });
    apiGet(`/api/bookings/${encodeURIComponent(params.booking)}/stages/${params.stage}`)
      .then((d) => alive && setInfo(d))
      .catch((e) => alive && setInfo({ error: e.message }));
    return () => {
      alive = false;
    };
  }, [params.booking, params.stage, paramError, canUpload, summary]);

  useEffect(() => () => itemsRef.current.forEach((i) => i.previewUrl && URL.revokeObjectURL(i.previewUrl)), []);

  const patch = (key, p) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const remainingServer = info.remaining ?? MAX_PHOTOS;
  const pendingCount = items.filter((i) => i.status !== 'invalid' && i.status !== 'done').length;
  const doneCount = items.filter((i) => i.status === 'done').length;
  const slotsLeft = remainingServer - pendingCount - (submissionId ? 0 : doneCount);
  const locked = phase === 'uploading' || Boolean(submissionId);
  const plate = params.plate || info.plate;
  const vehicle = params.vehicle || info.vehicle;

  async function addFiles(fileList) {
    setFormError('');
    const files = [...(fileList || [])];
    if (!files.length) return;
    const room = Math.max(0, slotsLeft);
    const accepted = files.slice(0, room);
    if (files.length > room) {
      setFormError(
        room === 0
          ? `Batas ${MAX_PHOTOS} foto untuk tahap ini sudah penuh.`
          : `Hanya ${room} foto yang ditambahkan. Batas ${MAX_PHOTOS} foto per tahap.`,
      );
    }
    const fresh = accepted.map((file) => ({
      key: `p${++seq}`,
      name: file.name,
      file,
      status: 'compressing',
      caption: '',
      progress: 0,
    }));
    setItems((list) => [...list, ...fresh]);
    // One at a time keeps memory low on older phones.
    for (const it of fresh) {
      try {
        const { blob } = await compressImage(it.file);
        if (blob.size > MAX_BYTES) {
          patch(it.key, { status: 'invalid', error: 'Lebih dari 10 MB setelah dikompres', file: null });
        } else {
          patch(it.key, { status: 'ready', blob, size: blob.size, previewUrl: URL.createObjectURL(blob), file: null });
        }
      } catch (e) {
        patch(it.key, { status: 'invalid', error: e.message, file: null });
      }
    }
  }

  function removeItem(key) {
    setItems((list) => {
      const it = list.find((i) => i.key === key);
      if (it?.previewUrl) URL.revokeObjectURL(it.previewUrl);
      return list.filter((i) => i.key !== key);
    });
  }

  async function sendAll() {
    setFormError('');
    const queue = itemsRef.current.filter((i) => i.status === 'ready' || i.status === 'failed');
    if (!queue.length && submissionId && itemsRef.current.some((i) => i.status === 'done')) {
      return finish(submissionId);
    }
    if (!queue.length) {
      setFormError('Tambahkan minimal satu foto.');
      return;
    }
    if (itemsRef.current.some((i) => i.status === 'compressing')) {
      setFormError('Tunggu sampai semua foto selesai dikompres.');
      return;
    }
    setPhase('uploading');
    let subId = submissionId;
    try {
      if (!subId) {
        const r = await apiPost('/api/submissions', {
          bookingId: params.booking,
          stage: params.stage,
          plate: params.plate,
          vehicle: params.vehicle,
          notes,
          result,
          photoCount: queue.length,
        });
        subId = r.submissionId;
        setSubmissionId(subId);
      }
    } catch (e) {
      setPhase('edit');
      setFormError(e.message);
      haptic('error');
      return;
    }

    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const it = queue[next++];
        patch(it.key, { status: 'uploading', progress: 0, error: '' });
        try {
          const position = itemsRef.current.findIndex((x) => x.key === it.key);
          await uploadPhoto(subId, it.blob, it.caption, position, (p) => patch(it.key, { progress: p }));
          patch(it.key, { status: 'done', progress: 1 });
        } catch (e) {
          patch(it.key, { status: 'failed', progress: 0, error: e.message });
        }
      }
    };
    await Promise.all([worker(), worker()]);

    const failed = itemsRef.current.filter((i) => i.status === 'failed').length;
    if (failed > 0) {
      setPhase('partial');
      haptic('warning');
      return;
    }
    await finish(subId);
  }

  async function finish(subId) {
    setPhase('uploading');
    try {
      const done = await apiPost(`/api/submissions/${subId}/complete`);
      setSummary(done);
      setPhase('done');
      haptic('success');
    } catch (e) {
      setPhase('partial');
      setFormError(e.message);
    }
  }

  function startAnother() {
    items.forEach((i) => i.previewUrl && URL.revokeObjectURL(i.previewUrl));
    setItems([]);
    setNotes('');
    setResult('');
    setSubmissionId(null);
    setSummary(null);
    setFormError('');
    setPhase('edit');
  }

  const header = (
    <AppHeader
      title="Upload foto inspection"
      sub={STAGES[params.stage] || 'Tahap tidak dikenal'}
    />
  );

  if (paramError) {
    return (
      <main className="page">
        {header}
        <Notice kind="error" title="Link upload tidak lengkap">
          <p>{paramError} Buka ulang dari tombol di GA Bot.</p>
        </Notice>
      </main>
    );
  }
  if (!canUpload) {
    return (
      <main className="page">
        {header}
        <Notice kind="error" title="Akses ditolak">
          <p>Akun ini terdaftar sebagai reviewer, bukan pengunggah foto.</p>
        </Notice>
      </main>
    );
  }

  const booking = (
    <dl className="booking-card">
      <div>
        <dt>Booking</dt>
        <dd className="mono">{params.booking}</dd>
      </div>
      <div>
        <dt>Kendaraan</dt>
        <dd>
          {plate ? <strong>{plate}</strong> : <span className="muted">Plat belum ada</span>}
          {vehicle && <span className="muted"> {vehicle}</span>}
        </dd>
      </div>
    </dl>
  );

  if (phase === 'done' && summary) {
    return (
      <main className="page">
        {header}
        {booking}
        <section className="done-panel" aria-live="polite">
          <span className="done-mark" aria-hidden="true">
            <Icon name="check" size={28} strokeWidth={2.5} />
          </span>
          <h2>{summary.photoCount} foto terkirim</h2>
          <p className="muted">{STAGES[summary.stage]}. Menunggu review admin GA.</p>
          <dl className="summary-list">
            <div>
              <dt>Result</dt>
              <dd>{summary.result ? RESULTS[summary.result] : 'Tidak diisi'}</dd>
            </div>
            <div>
              <dt>Catatan</dt>
              <dd>{summary.notes || 'Tidak ada catatan'}</dd>
            </div>
          </dl>
        </section>
        <div className="stack">
          <button type="button" className="btn btn-primary" onClick={closeMiniApp}>
            Tutup
          </button>
          <button type="button" className="btn btn-outline" onClick={startAnother}>
            Tambah foto lagi untuk tahap ini
          </button>
          {me.roles.includes('reviewer') && (
            <Link className="btn btn-text" to={`/review/${summary.inspectionId}`}>
              Lihat di halaman review
            </Link>
          )}
        </div>
      </main>
    );
  }

  const totalProgress = (() => {
    const active = items.filter((i) => i.status !== 'invalid');
    if (!active.length) return 0;
    return active.reduce((s, i) => s + (i.status === 'done' ? 1 : i.status === 'uploading' ? i.progress : 0), 0) / active.length;
  })();
  const failedCount = items.filter((i) => i.status === 'failed').length;
  const sendable = items.filter((i) => i.status === 'ready' || i.status === 'failed').length;
  const compressing = items.some((i) => i.status === 'compressing');

  return (
    <main className="page page-with-bar">
      {header}
      {booking}

      {info.loading && <Loading label="Memeriksa data booking" />}
      {info.error && (
        <Notice kind="error" title="Data booking gagal dimuat">
          <p>{info.error}</p>
        </Notice>
      )}
      {info.status && info.count > 0 && (
        <p className="meta-line">
          Sudah ada {info.count} foto di tahap ini. Sisa kuota {info.remaining} foto.
        </p>
      )}

      <section aria-labelledby="sec-foto">
        <SectionLabel aside={`${items.filter((i) => i.status !== 'invalid').length} dipilih, maks ${Math.min(MAX_PHOTOS, remainingServer)}`}>
          <span id="sec-foto">Foto</span>
        </SectionLabel>

        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {items.length === 0 ? (
          <div className="empty-drop">
            <p className="empty-title">Belum ada foto</p>
            <p className="muted">Ambil foto kendaraan dari kamera atau pilih beberapa sekaligus dari galeri. Maksimal {MAX_PHOTOS} foto.</p>
          </div>
        ) : (
          <ul className="thumb-list">
            {items.map((it, idx) => (
              <li key={it.key} className={`thumb thumb-${it.status}`}>
                <div className="thumb-img">
                  {it.previewUrl ? <img src={it.previewUrl} alt={`Foto ${idx + 1}`} /> : <span className="thumb-ph">{it.status === 'invalid' ? 'Gagal' : '...'}</span>}
                  <span className="thumb-num">{idx + 1}</span>
                  {it.status !== 'done' && it.status !== 'uploading' && (
                    <button type="button" className="thumb-remove" onClick={() => removeItem(it.key)} aria-label={`Hapus foto ${idx + 1}`} disabled={phase === 'uploading'}>
                      <Icon name="close" size={16} strokeWidth={2.5} />
                    </button>
                  )}
                </div>
                <div className="thumb-body">
                  <div className="thumb-status">
                    <span className={`st st-${it.status}`}>{phase === 'uploading' && it.status === 'ready' ? 'Menunggu giliran' : STATUS_TEXT[it.status]}</span>
                    {it.size ? <span className="muted">{formatBytes(it.size)}</span> : null}
                  </div>
                  {(it.status === 'uploading' || it.status === 'done') && <ProgressBar value={it.progress} label={`Progress foto ${idx + 1}`} />}
                  {it.error && <p className="thumb-error">{it.error}</p>}
                  <input
                    type="text"
                    className="input input-sm"
                    placeholder="Keterangan (opsional)"
                    aria-label={`Keterangan foto ${idx + 1}`}
                    maxLength={300}
                    value={it.caption}
                    disabled={it.status === 'done' || it.status === 'uploading' || it.status === 'invalid'}
                    onChange={(e) => patch(it.key, { caption: e.target.value })}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="pick-row">
          <button type="button" className="btn btn-outline" onClick={() => cameraRef.current?.click()} disabled={phase === 'uploading' || slotsLeft <= 0}>
            <Icon name="camera" /> {items.length ? 'Ambil foto lagi' : 'Kamera'}
          </button>
          <button type="button" className="btn btn-outline" onClick={() => galleryRef.current?.click()} disabled={phase === 'uploading' || slotsLeft <= 0}>
            <Icon name="image" /> Galeri
          </button>
        </div>
      </section>

      <section aria-labelledby="sec-hasil">
        <SectionLabel>
          <span id="sec-hasil">Hasil inspection</span>
        </SectionLabel>
        <fieldset className="segmented" disabled={locked}>
          <legend className="sr-only">Result</legend>
          {Object.entries(RESULTS).map(([value, label]) => (
            <label key={value} className={`seg seg-${value}${result === value ? ' is-on' : ''}`}>
              <input type="radio" name="result" value={value} checked={result === value} onChange={() => setResult(value)} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span className="field-label">Catatan umum</span>
          <textarea className="input" rows={3} maxLength={2000} placeholder="Contoh: baret halus pintu kiri belakang, BBM 3/4" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={locked} />
        </label>
        {submissionId && phase !== 'uploading' && <p className="meta-line">Catatan dan result sudah terkirim bersama sesi upload ini.</p>}
      </section>

      {formError && (
        <Notice kind="error">
          <p>{formError}</p>
        </Notice>
      )}

      <div className="action-bar">
        {phase === 'uploading' && (
          <div className="total-progress" aria-live="polite">
            <div className="total-row">
              <span>{doneCount} dari {items.filter((i) => i.status !== 'invalid').length} foto terkirim</span>
              <span>{Math.round(totalProgress * 100)}%</span>
            </div>
            <ProgressBar value={totalProgress} label="Progress total" />
          </div>
        )}
        {phase === 'partial' && failedCount > 0 && (
          <p className="bar-warning">
            {failedCount} foto gagal terkirim. {doneCount} foto sudah aman di server.
          </p>
        )}
        <button type="button" className="btn btn-primary btn-block" onClick={sendAll} disabled={phase === 'uploading' || compressing || (sendable === 0 && phase !== 'partial')}>
          {phase === 'uploading'
            ? 'Mengirim...'
            : phase === 'partial'
              ? failedCount > 0
                ? `Kirim ulang ${failedCount} foto gagal`
                : 'Selesaikan kiriman'
              : compressing
                ? 'Menyiapkan foto...'
                : sendable > 0
                  ? `Kirim ${sendable} foto`
                  : 'Kirim foto'}
        </button>
      </div>
    </main>
  );
}
