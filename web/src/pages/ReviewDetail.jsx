import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '../lib/api.js';
import { STAGES, STAGE_ORDER, RESULTS, formatDate } from '../lib/format.js';
import { haptic } from '../lib/telegram.js';
import { AppHeader, SectionLabel, Notice, Loading, StatusTag } from '../components/Layout.jsx';
import { Link } from '../router.jsx';
import Lightbox from '../components/Lightbox.jsx';
import Icon from '../components/Icon.jsx';

function ReviewForm({ inspection, onDone }) {
  const [decision, setDecision] = useState(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (decision === 'reject' && !reason.trim()) {
      setError('Isi alasan penolakan.');
      document.getElementById('reject-reason')?.focus();
      return;
    }
    setBusy(true);
    try {
      const r = await apiPost(`/api/inspections/${inspection.id}/review`, { decision, reason, note });
      haptic('success');
      onDone(r);
    } catch (err) {
      setError(err.message);
      haptic('error');
    } finally {
      setBusy(false);
    }
  }

  if (!decision) {
    return (
      <div className="decide-row">
        <button type="button" className="btn btn-primary" onClick={() => setDecision('approve')}>
          Setujui
        </button>
        <button type="button" className="btn btn-outline btn-danger" onClick={() => setDecision('reject')}>
          Tolak
        </button>
      </div>
    );
  }

  return (
    <form className="review-form" onSubmit={submit} noValidate>
      <p className="review-form-title">{decision === 'approve' ? 'Setujui inspection ini' : 'Tolak inspection ini'}</p>
      {decision === 'reject' && (
        <label className="field">
          <span className="field-label">Alasan penolakan (wajib)</span>
          <textarea id="reject-reason" className="input" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={Boolean(error && !reason.trim())} placeholder="Contoh: foto odometer buram, ulangi" />
        </label>
      )}
      <label className="field">
        <span className="field-label">Catatan review (opsional)</span>
        <textarea className="input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="decide-row">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Menyimpan...' : decision === 'approve' ? 'Simpan: Disetujui' : 'Simpan: Ditolak'}
        </button>
        <button type="button" className="btn btn-outline" onClick={() => setDecision(null)} disabled={busy}>
          Batal
        </button>
      </div>
    </form>
  );
}

export default function ReviewDetail({ me, id }) {
  const [state, setState] = useState({ loading: true });
  const [reload, setReload] = useState(0);
  const [lightbox, setLightbox] = useState(null);
  const [editing, setEditing] = useState(false);
  const canUpload = me.roles.includes('uploader');

  useEffect(() => {
    let alive = true;
    apiGet(`/api/inspections/${encodeURIComponent(id)}`)
      .then((d) => alive && setState({ data: d }))
      .catch((e) => alive && setState({ error: e }));
    return () => {
      alive = false;
    };
  }, [id, reload]);

  const data = state.data;
  const flatPhotos = useMemo(() => {
    if (!data) return [];
    return STAGE_ORDER.flatMap((s) => data.photos.filter((p) => p.stage === s).map((p) => ({ ...p, stageLabel: STAGES[s] })));
  }, [data]);

  const back = (
    <Link to="/review" className="back-link">
      <Icon name="left" size={18} /> Daftar
    </Link>
  );

  if (!me.roles.includes('reviewer')) {
    return (
      <main className="page">
        <AppHeader title="Detail inspection" />
        <Notice kind="error" title="Akses ditolak">
          <p>Akun ini tidak terdaftar sebagai reviewer GA.</p>
        </Notice>
      </main>
    );
  }
  if (state.loading) {
    return (
      <main className="page">
        <AppHeader title="Detail inspection" right={back} />
        <Loading label="Memuat inspection" />
      </main>
    );
  }
  if (state.error) {
    return (
      <main className="page">
        <AppHeader title="Detail inspection" right={back} />
        <Notice kind="error" title={state.error.status === 404 ? 'Inspection tidak ditemukan' : 'Gagal memuat'} action={state.error.status !== 404 && <button type="button" className="btn btn-outline" onClick={() => { setState({ loading: true }); setReload((n) => n + 1); }}>Coba lagi</button>}>
          <p>{state.error.message}</p>
        </Notice>
      </main>
    );
  }

  const uploadLink = (stage) => {
    const sp = new URLSearchParams({ booking: data.bookingId, stage });
    if (data.plate) sp.set('plate', data.plate);
    return `/upload?${sp}`;
  };

  return (
    <main className="page">
      <AppHeader title={data.plate || 'Tanpa plat'} sub={data.vehicle || undefined} right={back} />

      <dl className="booking-card">
        <div>
          <dt>Booking</dt>
          <dd className="mono">{data.bookingId}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <StatusTag status={data.status} />
          </dd>
        </div>
      </dl>

      {STAGE_ORDER.map((stage) => {
        const subs = data.submissions.filter((s) => s.stage === stage);
        const photos = flatPhotos.filter((p) => p.stage === stage);
        return (
          <section key={stage} className="stage-block" aria-labelledby={`st-${stage}`}>
            <SectionLabel aside={photos.length ? `${photos.length} foto` : null}>
              <span id={`st-${stage}`}>{STAGES[stage]}</span>
            </SectionLabel>
            {photos.length === 0 ? (
              <p className="muted stage-empty">Belum ada foto untuk tahap ini.</p>
            ) : (
              <ul className="photo-grid">
                {photos.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="photo-cell" onClick={() => setLightbox(flatPhotos.indexOf(p))} aria-label={`Buka foto: ${p.caption || 'tanpa keterangan'}`}>
                      <img src={p.url} alt="" loading="lazy" />
                    </button>
                    {p.caption && <p className="photo-cap">{p.caption}</p>}
                  </li>
                ))}
              </ul>
            )}
            {subs.map((s) => (
              <div key={s.id} className="sub-meta">
                <p className="sub-by">
                  {s.uploaderName} <span className="muted">{formatDate(s.completedAt)}</span>
                </p>
                <p>
                  <span className="kv-k">Result</span> {s.result ? <span className={`result result-${s.result}`}>{RESULTS[s.result]}</span> : <span className="muted">Tidak diisi</span>}
                </p>
                {s.notes && (
                  <p>
                    <span className="kv-k">Catatan</span> {s.notes}
                  </p>
                )}
              </div>
            ))}
            {canUpload && (
              <Link className="btn btn-text btn-inline" to={uploadLink(stage)}>
                <Icon name="plus" size={18} /> Tambah foto {STAGES[stage]}
              </Link>
            )}
          </section>
        );
      })}

      <section className="review-block" aria-labelledby="sec-review">
        <SectionLabel>
          <span id="sec-review">Keputusan review</span>
        </SectionLabel>
        {data.review && !editing && (
          <div className={`review-result review-${data.status}`}>
            <p>
              <strong>{data.status === 'approved' ? 'Disetujui' : 'Ditolak'}</strong> oleh {data.review.byName}
            </p>
            <p className="muted small">{formatDate(data.review.at)}</p>
            {data.review.reason && (
              <p>
                <span className="kv-k">Alasan</span> {data.review.reason}
              </p>
            )}
            {data.review.note && (
              <p>
                <span className="kv-k">Catatan</span> {data.review.note}
              </p>
            )}
            <button type="button" className="btn btn-text btn-inline" onClick={() => setEditing(true)}>
              Ubah keputusan
            </button>
          </div>
        )}
        {data.photos.length === 0 ? (
          <p className="muted">Belum ada foto yang bisa direview.</p>
        ) : (
          (!data.review || editing) && (
            <ReviewForm
              inspection={data}
              onDone={(r) => {
                setEditing(false);
                setState({ data: { ...data, status: r.status, review: r.review } });
              }}
            />
          )
        )}
      </section>

      {lightbox !== null && <Lightbox photos={flatPhotos} index={lightbox} onIndex={setLightbox} onClose={() => setLightbox(null)} />}
    </main>
  );
}
