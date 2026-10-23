import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost, uploadPhoto } from '../lib/api.js';
import { compressImage } from '../lib/compress.js';
import { STAGES, RESULTS, formatBytes } from '../lib/format.js';
import { closeMiniApp, haptic } from '../lib/telegram.js';
import { AppHeader, StepHead, Notice, Loading, ProgressBar, StateScreen } from '../components/Layout.jsx';
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
  compressing: 'Menyiapkan',
  ready: 'Siap kirim',
  queued: 'Menunggu giliran',
  uploading: 'Mengirim',
  done: 'Terkirim',
  failed: 'Gagal terkirim',
  invalid: 'Tidak bisa dipakai',
};

// Keeps the page bottom padding equal to the real height of the fixed action bar.
function useBarHeight(el) {
  useLayoutEffect(() => {
    if (!el) return undefined;
    const root = document.documentElement;
    // Shadow on the bar only while there is still content hidden underneath it.
    const edge = () => el.classList.toggle('has-more', window.innerHeight + window.scrollY < root.scrollHeight - 2);
    let prev = 0;
    const set = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      // If the bar grows (progress strip, failure warning) while the user sits at the end of the page,
      // keep the last content in view instead of letting the bar slide over it.
      const atEnd = prev && window.innerHeight + window.scrollY >= root.scrollHeight - 4;
      root.style.setProperty('--bar-h', `${h}px`);
      if (atEnd && h > prev) window.scrollBy(0, h - prev);
      prev = h;
      edge();
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    ro.observe(document.body);
    window.addEventListener('scroll', edge, { passive: true });
    window.addEventListener('resize', set);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', edge);
      window.removeEventListener('resize', set);
      root.style.removeProperty('--bar-h');
    };
  }, [el]);
}

function ThumbBadge({ status, progress }) {
  if (status === 'done') {
    return (
      <span className="tb tb-done" title="Terkirim">
        <Icon name="check" size={14} strokeWidth={3} />
      </span>
    );
  }
  if (status === 'failed' || status === 'invalid') {
    return (
      <span className="tb tb-failed" title="Gagal">
        <Icon name="alert" size={14} strokeWidth={3} />
      </span>
    );
  }
  if (status === 'uploading' || status === 'compressing') {
    const p = status === 'compressing' ? 0.25 : Math.max(0.06, progress);
    const c = 2 * Math.PI * 8;
    return (
      <span className={`tb tb-ring${status === 'compressing' ? ' is-spin' : ''}`} title={STATUS_TEXT[status]}>
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="8" fill="none" stroke="#e6e6e6" strokeWidth="3" />
          <circle cx="10" cy="10" r="8" fill="none" stroke="#111" strokeWidth="3" strokeDasharray={`${c * p} ${c}`} transform="rotate(-90 10 10)" />
        </svg>
      </span>
    );
  }
  return null;
}

function PhotoSheet({ item, index, total, editable, onCaption, onRemove, onClose, onStep }) {
  const [caption, setCaption] = useState(item.caption);
  const inputRef = useRef(null);
  useEffect(() => setCaption(item.caption), [item.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  const save = () => {
    onCaption(caption.trim());
    onClose();
  };
  const status = item.status;
  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <button type="button" className="sheet-backdrop" aria-label="Tutup" onClick={save} />
      <div className="sheet">
        <div className="sheet-head">
          <p id="sheet-title" className="sheet-title">
            Foto {index + 1} <span className="muted">dari {total}</span>
          </p>
          <div className="sheet-nav">
            <button type="button" className="icon-btn" onClick={() => { onCaption(caption.trim()); onStep(-1); }} disabled={index === 0} aria-label="Foto sebelumnya">
              <Icon name="left" />
            </button>
            <button type="button" className="icon-btn" onClick={() => { onCaption(caption.trim()); onStep(1); }} disabled={index === total - 1} aria-label="Foto berikutnya">
              <Icon name="right" />
            </button>
            <button type="button" className="icon-btn" onClick={save} aria-label="Tutup">
              <Icon name="close" />
            </button>
          </div>
        </div>
        <div className="sheet-preview">
          {item.previewUrl ? <img src={item.previewUrl} alt={`Foto ${index + 1}`} /> : <span className="muted">{STATUS_TEXT[status]}</span>}
        </div>
        <p className={`sheet-status st-${status}`}>
          {STATUS_TEXT[status]}
          {item.size ? <span className="muted"> · {formatBytes(item.size)}</span> : null}
        </p>
        {item.error && <p className="sheet-error">{item.error}</p>}
        <label className="field">
          <span className="field-label">Keterangan foto</span>
          <textarea
            ref={inputRef}
            className="input"
            rows={2}
            maxLength={300}
            placeholder="Contoh: baret pintu kiri belakang"
            value={caption}
            disabled={!editable}
            onChange={(e) => setCaption(e.target.value)}
          />
        </label>
        <div className="sheet-actions">
          {editable || status === 'invalid' ? (
            <button type="button" className="btn btn-outline btn-danger" onClick={() => { onRemove(); onClose(); }}>
              Hapus foto
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="btn btn-primary" onClick={save}>
            {editable ? 'Simpan' : 'Tutup'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UploadPage({ me, search }) {
  const params = useMemo(() => readParams(search), [search]);
  const paramError = !BOOKING_RE.test(params.booking)
    ? 'ID booking di link tidak ada atau tidak valid.'
    : !STAGES[params.stage]
      ? 'Tahap inspeksi di link tidak dikenal.'
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
  const [sheetKey, setSheetKey] = useState(null);
  const [skipped, setSkipped] = useState(0);
  const galleryRef = useRef(null);
  const cameraRef = useRef(null);
  const [barEl, setBarEl] = useState(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useBarHeight(barEl);

  useEffect(() => {
    if (paramError || !canUpload) return undefined;
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
  const active = items.filter((i) => i.status !== 'invalid');
  const pendingCount = items.filter((i) => i.status !== 'invalid' && i.status !== 'done').length;
  const doneCount = items.filter((i) => i.status === 'done').length;
  // info.remaining is read once per session, so photos already saved in it still take slots.
  const slotsLeft = remainingServer - pendingCount - doneCount;
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
      return undefined;
    }
    if (itemsRef.current.some((i) => i.status === 'compressing')) {
      setFormError('Tunggu sampai semua foto selesai disiapkan.');
      return undefined;
    }
    setSheetKey(null);
    setPhase('uploading');
    queue.forEach((it) => patch(it.key, { status: 'queued', progress: 0, error: '' }));
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
      queue.forEach((it) => patch(it.key, { status: it.status }));
      setPhase('edit');
      setFormError(e.message);
      haptic('error');
      return undefined;
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
      return undefined;
    }
    return finish(subId);
  }

  async function finish(subId) {
    setPhase('uploading');
    try {
      const done = await apiPost(`/api/submissions/${subId}/complete`);
      setSummary(done);
      setPhase('done');
      window.scrollTo(0, 0);
      haptic('success');
    } catch (e) {
      setPhase('partial');
      setFormError(e.message);
    }
  }

  // Skipped photos leave the list, so every count on screen matches what the server holds.
  function dropFailed() {
    const failed = itemsRef.current.filter((i) => i.status === 'failed');
    failed.forEach((i) => i.previewUrl && URL.revokeObjectURL(i.previewUrl));
    const kept = itemsRef.current.filter((i) => i.status !== 'failed');
    itemsRef.current = kept;
    setItems(kept);
    setSkipped((n) => n + failed.length);
    if (submissionId && kept.some((i) => i.status === 'done')) return finish(submissionId);
    return undefined;
  }

  function startAnother() {
    items.forEach((i) => i.previewUrl && URL.revokeObjectURL(i.previewUrl));
    setItems([]);
    setNotes('');
    setResult('');
    setSubmissionId(null);
    setSummary(null);
    setSkipped(0);
    setFormError('');
    setPhase('edit');
    window.scrollTo(0, 0);
  }

  const stageName = STAGES[params.stage] || 'Tahap tidak dikenal';

  if (paramError) {
    return (
      <StateScreen icon="missing" title="Link upload tidak lengkap">
        <p>{paramError}</p>
        <p className="muted">Tutup halaman ini lalu tekan lagi tombol upload pada pesan booking di GA Bot.</p>
      </StateScreen>
    );
  }
  if (!canUpload) {
    return (
      <StateScreen icon="lock" title="Akses ditolak">
        <p>Akun ini terdaftar sebagai reviewer, bukan pengunggah foto.</p>
        <p className="muted">Minta tim GA menambahkan akun Anda ke daftar pengunggah bila perlu upload.</p>
      </StateScreen>
    );
  }

  const bookingStrip = (
    <section className="booking-strip" aria-label="Data booking">
      <p className="bs-stage">{stageName}</p>
      <p className="bs-plate">
        {plate || <span className="muted">Plat belum ada</span>}
        {vehicle && <span className="bs-vehicle"> {vehicle}</span>}
      </p>
      <p className="bs-id mono">Booking {params.booking}</p>
    </section>
  );

  if (phase === 'done' && summary) {
    return (
      <main className="page page-done">
        <AppHeader title="Foto terkirim" />
        <div className="done-body">
        <section className="done" aria-live="polite">
          <div className="done-head">
            <span className="done-mark" aria-hidden="true">
              <Icon name="check" size={28} strokeWidth={2.75} />
            </span>
            <div>
              <p className="done-count">{summary.photoCount} foto tersimpan</p>
              <p className="muted">Menunggu review GA</p>
              {skipped > 0 && <p className="done-skip">{skipped} foto yang gagal tidak ikut dikirim.</p>}
            </div>
          </div>
          {items.some((i) => i.status === 'done' && i.previewUrl) && (
            <ul className="done-thumbs" aria-label="Foto yang tersimpan">
              {items
                .filter((i) => i.status === 'done')
                .map((it, idx) => (
                  <li key={it.key}>
                    {it.previewUrl && <img src={it.previewUrl} alt={`Foto ${idx + 1}${it.caption ? `: ${it.caption}` : ''}`} />}
                    <span className="tcell-num" aria-hidden="true">{idx + 1}</span>
                  </li>
                ))}
            </ul>
          )}
          <dl className="kv">
            <div>
              <dt>Kendaraan</dt>
              <dd>
                <strong>{plate || '-'}</strong>
                {vehicle && <span className="muted"> {vehicle}</span>}
              </dd>
            </div>
            <div>
              <dt>Booking</dt>
              <dd className="mono">{summary.bookingId}</dd>
            </div>
            <div>
              <dt>Tahap</dt>
              <dd>{STAGES[summary.stage]}</dd>
            </div>
            {summary.result && (
              <div>
                <dt>Hasil</dt>
                <dd>
                  <span className={`result-tag result-${summary.result}`}>{RESULTS[summary.result]}</span>
                </dd>
              </div>
            )}
            {summary.notes && (
              <div>
                <dt>Catatan</dt>
                <dd className="kv-text">{summary.notes}</dd>
              </div>
            )}
          </dl>
          <div className="next-step">
            <p className="next-label">Berikutnya</p>
            <p>Reviewer GA akan memeriksa foto ini. Hasil review dikirim lewat GA Bot.</p>
          </div>
        </section>
        <div className="done-actions">
          <button type="button" className="btn btn-primary btn-block" onClick={closeMiniApp}>
            Tutup
          </button>
          <button type="button" className="btn btn-outline btn-block" onClick={startAnother}>
            Tambah foto lagi
          </button>
          {me.roles.includes('reviewer') && (
            <Link className="btn btn-text" to={`/review/${summary.inspectionId}`}>
              Lihat di halaman review
            </Link>
          )}
        </div>
        </div>
      </main>
    );
  }

  const progressValue = active.length
    ? active.reduce((s, i) => s + (i.status === 'done' ? 1 : i.status === 'uploading' ? i.progress * 0.95 : 0), 0) / active.length
    : 0;
  const failedCount = items.filter((i) => i.status === 'failed').length;
  const sendable = items.filter((i) => i.status === 'ready' || i.status === 'failed').length;
  const compressing = items.some((i) => i.status === 'compressing');
  const maxHere = Math.min(MAX_PHOTOS, remainingServer);
  const sheetIndex = items.findIndex((i) => i.key === sheetKey);
  const sheetItem = sheetIndex >= 0 ? items[sheetIndex] : null;
  const canPick = phase !== 'uploading' && slotsLeft > 0;

  const pickers = (
    <>
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        data-testid="gallery-input"
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
    </>
  );

  return (
    <main className="page page-with-bar">
      <AppHeader title="Upload foto inspeksi" />
      {bookingStrip}

      {info.loading && <Loading label="Memeriksa data booking" />}
      {info.error && (
        <Notice kind="error" title="Data booking gagal dimuat">
          <p>{info.error}</p>
        </Notice>
      )}

      <section className="step" aria-labelledby="sec-foto">
        <StepHead num="01" id="sec-foto" title="Foto" aside={items.length ? `${active.length} / ${maxHere}` : `Maks ${maxHere}`} />
        {info.count > 0 && (
          <p className="meta-line">
            Tahap ini sudah berisi {info.count} foto dari kiriman sebelumnya.
          </p>
        )}
        {pickers}

        {items.length === 0 ? (
          <div className="pick-hero">
            <button type="button" className="pick-big" onClick={() => cameraRef.current?.click()} disabled={!canPick}>
              <Icon name="camera" size={28} strokeWidth={1.75} />
              <span className="pick-big-label">Kamera</span>
              <span className="pick-big-hint">Ambil foto</span>
            </button>
            <button type="button" className="pick-big" onClick={() => galleryRef.current?.click()} disabled={!canPick}>
              <Icon name="image" size={28} strokeWidth={1.75} />
              <span className="pick-big-label">Galeri</span>
              <span className="pick-big-hint">Pilih banyak sekaligus</span>
            </button>
            <p className="pick-note">
              Foto dikompres otomatis di HP. Ketuk foto untuk menambah keterangan.
            </p>
          </div>
        ) : (
          <>
            <ul className="tgrid" aria-label="Foto dipilih">
              {items.map((it, idx) => {
                const removable = phase !== 'uploading' && it.status !== 'done' && it.status !== 'uploading' && it.status !== 'queued';
                const st = it.status;
                return (
                  <li key={it.key} className={`tcell tcell-${st}`}>
                    <div className="tcell-media">
                    <button
                      type="button"
                      className="tcell-open"
                      onClick={() => setSheetKey(it.key)}
                      aria-label={`Foto ${idx + 1}, ${STATUS_TEXT[st]}${it.caption ? `, keterangan: ${it.caption}` : ', tanpa keterangan'}. Ketuk untuk detail`}
                    >
                      {it.previewUrl ? <img src={it.previewUrl} alt="" /> : <span className="tcell-ph">{st === 'invalid' ? 'Gagal' : ''}</span>}
                    </button>
                    <span className="tcell-num" aria-hidden="true">{idx + 1}</span>
                    {removable && (
                      <button type="button" className="tcell-remove" onClick={() => removeItem(it.key)} aria-label={`Hapus foto ${idx + 1}`}>
                        <span className="tcell-remove-vis">
                          <Icon name="close" size={14} strokeWidth={3} />
                        </span>
                      </button>
                    )}
                    <span className="tcell-badge" aria-hidden="true">
                      <ThumbBadge status={st} progress={it.progress} />
                    </span>
                    </div>
                    <span className={`tcell-cap${it.caption ? ' has-cap' : ''}`} aria-hidden="true">
                      {it.caption || (st === 'failed' || st === 'invalid' ? 'Gagal' : '+ Keterangan')}
                    </span>
                  </li>
                );
              })}
            </ul>
            {slotsLeft <= 0 ? (
              <p className="limit-note">Batas {MAX_PHOTOS} foto tercapai.</p>
            ) : (
              <div className="pick-row">
                <button type="button" className="btn btn-outline" onClick={() => cameraRef.current?.click()} disabled={!canPick}>
                  <Icon name="camera" /> Kamera
                </button>
                <button type="button" className="btn btn-outline" onClick={() => galleryRef.current?.click()} disabled={!canPick}>
                  <Icon name="image" /> Galeri
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="step" aria-labelledby="sec-hasil">
        <StepHead num="02" id="sec-hasil" title="Hasil dan catatan" aside="Opsional" />
        <fieldset className="segmented" disabled={locked}>
          <legend className="field-label">Hasil inspeksi</legend>
          <div className="seg-row">
            {Object.entries(RESULTS).map(([value, label]) => (
              <label key={value} className={`seg seg-${value}${result === value ? ' is-on' : ''}`}>
                <input
                  type="radio"
                  name="result"
                  value={value}
                  checked={result === value}
                  onChange={() => setResult(value)}
                  onClick={() => result === value && setResult('')}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="field">
          <span className="field-label">Catatan umum</span>
          <textarea className="input" rows={3} maxLength={2000} placeholder="Contoh: baret halus pintu kiri belakang, BBM 3/4" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={locked} />
        </label>
        {submissionId && phase !== 'uploading' && (notes.trim() || result) && <p className="meta-line">Hasil dan catatan sudah tersimpan bersama kiriman ini.</p>}
      </section>

      {formError && (
        <Notice kind="error">
          <p>{formError}</p>
        </Notice>
      )}

      <div className="action-bar" ref={setBarEl}>
        <div className="action-inner">
          {phase === 'uploading' && (
            <div className="total-progress" aria-live="polite">
              <p className="total-row">
                <span>Mengirim foto</span>
                <span className="total-count">{doneCount} dari {active.length} terkirim</span>
              </p>
              <ProgressBar value={progressValue} label="Progress kiriman" />
            </div>
          )}
          {phase === 'partial' && failedCount > 0 && (
            <div className="bar-warning" role="alert">
              <p>
                <strong>{failedCount} foto gagal terkirim.</strong> {doneCount} foto sudah aman di server.
              </p>
            </div>
          )}
          {phase === 'partial' && failedCount > 0 ? (
            <div className="bar-buttons">
              <button type="button" className="btn btn-primary" onClick={sendAll}>
                <Icon name="retry" size={18} /> Kirim ulang {failedCount} foto
              </button>
              {doneCount > 0 && (
                <button type="button" className="btn btn-outline" onClick={dropFailed}>
                  Lanjut tanpa {failedCount} foto gagal
                </button>
              )}
            </div>
          ) : (
            <button type="button" className="btn btn-primary btn-block" onClick={sendAll} disabled={phase === 'uploading' || compressing || (sendable === 0 && phase !== 'partial')}>
              {phase === 'uploading'
                ? 'Mengirim...'
                : phase === 'partial'
                  ? 'Selesaikan kiriman'
                  : compressing
                    ? 'Menyiapkan foto...'
                    : sendable > 0
                      ? `Kirim ${sendable} foto`
                      : 'Pilih foto dulu'}
            </button>
          )}
        </div>
      </div>

      {sheetItem && (
        <PhotoSheet
          item={sheetItem}
          index={sheetIndex}
          total={items.length}
          editable={phase !== 'uploading' && (sheetItem.status === 'ready' || sheetItem.status === 'failed' || sheetItem.status === 'compressing')}
          onCaption={(c) => patch(sheetItem.key, { caption: c })}
          onRemove={() => removeItem(sheetItem.key)}
          onClose={() => setSheetKey(null)}
          onStep={(d) => setSheetKey(items[sheetIndex + d]?.key ?? sheetKey)}
        />
      )}
    </main>
  );
}
