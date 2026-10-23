import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '../lib/api.js';
import { STAGES, STAGE_ORDER, STAGE_SHORT, RESULTS, formatDate } from '../lib/format.js';
import { haptic } from '../lib/telegram.js';
import { AppHeader, Loading, StatusTag, StateScreen } from '../components/Layout.jsx';
import { Link } from '../router.jsx';
import Lightbox from '../components/Lightbox.jsx';
import Icon from '../components/Icon.jsx';

const BACK = { to: '/review', label: 'Daftar' };

function ReviewForm({ inspection, onDone, onCancel }) {
  const [decision, setDecision] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [reasonError, setReasonError] = useState('');
  const [error, setError] = useState('');
  const reasonRef = useRef(null);
  const reject = decision === 'reject';

  async function submit(e) {
    e.preventDefault();
    setError('');
    setReasonError('');
    if (!decision) return;
    if (reject && !reason.trim()) {
      setReasonError('Isi alasan penolakan.');
      reasonRef.current?.focus();
      haptic('error');
      return;
    }
    setBusy(true);
    try {
      const r = await apiPost(`/api/inspections/${inspection.id}/review`, { decision, reason: reject ? reason : '', note });
      haptic('success');
      onDone(r);
    } catch (err) {
      setError(err.message);
      haptic('error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="review-form" onSubmit={submit} noValidate>
      <div className="field">
        <label className="field-label" htmlFor="review-decision">
          Keputusan
        </label>
        <div className="select-wrap">
          <select
            id="review-decision"
            className={`input select${decision ? '' : ' is-empty'}`}
            value={decision}
            disabled={busy}
            aria-required="true"
            onChange={(e) => {
              setDecision(e.target.value);
              setReasonError('');
              setError('');
            }}
          >
            <option value="">Pilih keputusan</option>
            <option value="approve">Setujui</option>
            <option value="reject">Tolak</option>
          </select>
          <Icon name="down" size={18} className="select-chev" />
        </div>
      </div>
      {reject && (
        <div className="field">
          <label className="field-label" htmlFor="reject-reason">
            Alasan penolakan <span className="req">wajib</span>
          </label>
          <textarea
            id="reject-reason"
            ref={reasonRef}
            className="input"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (reasonError && e.target.value.trim()) setReasonError('');
            }}
            aria-invalid={Boolean(reasonError)}
            aria-describedby={reasonError ? 'reject-reason-err' : undefined}
            placeholder="Contoh: foto odometer buram, ulangi fotonya"
          />
          {reasonError && (
            <p className="field-error" id="reject-reason-err" role="alert">
              <Icon name="alert" size={16} strokeWidth={3} /> {reasonError}
            </p>
          )}
        </div>
      )}
      <div className="field">
        <label className="field-label" htmlFor="review-note">
          Catatan review <span className="opt">opsional</span>
        </label>
        <textarea id="review-note" className="input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className={`btn btn-primary btn-block${busy ? ' is-busy' : ''}`} disabled={!decision || busy}>
        {busy ? 'Menyimpan...' : 'Simpan keputusan'}
      </button>
      {onCancel && (
        <button type="button" className="btn btn-text decide-cancel" onClick={onCancel} disabled={busy}>
          Batal ubah
        </button>
      )}
    </form>
  );
}

function SessionBlock({ s }) {
  if (!s.result && !s.notes) {
    return (
      <p className="session-by session-bare">
        Dikirim {s.uploaderName || 'Admin GA'} · <time dateTime={s.completedAt}>{formatDate(s.completedAt)}</time>
      </p>
    );
  }
  return (
    <div className="session">
      <dl className="session-grid">
        {s.result && (
          <div>
            <dt>Hasil</dt>
            <dd>
              <span className={`result-tag result-${s.result}`}>{RESULTS[s.result]}</span>
            </dd>
          </div>
        )}
        {s.notes && (
          <div className="session-notes">
            <dt>Catatan</dt>
            <dd>{s.notes}</dd>
          </div>
        )}
      </dl>
      <p className="session-by">
        Dikirim {s.uploaderName || 'Admin GA'} · <time dateTime={s.completedAt}>{formatDate(s.completedAt)}</time>
      </p>
    </div>
  );
}

export default function ReviewDetail({ me, id }) {
  const [state, setState] = useState({ loading: true });
  const [reload, setReload] = useState(0);
  const [lightbox, setLightbox] = useState(null);
  const [editing, setEditing] = useState(false);
  const [activeStage, setActiveStage] = useState(null);
  // Stage chosen by a chip tap. It wins over scroll-spy while the jump animates, and afterwards only
  // while the page sits at its end (where short last sections can never reach the top).
  const pinnedRef = useRef(null);
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

  // Highlight the chip of the stage section currently under the sticky nav.
  useEffect(() => {
    if (!data) return undefined;
    const els = STAGE_ORDER.map((s) => document.getElementById(`stage-${s}`)).filter(Boolean);
    const nav = document.querySelector('.stage-nav');
    const root = document.documentElement;
    const measure = () => nav && root.style.setProperty('--snav-h', `${Math.ceil(nav.getBoundingClientRect().height)}px`);
    measure();
    const ro = nav ? new ResizeObserver(measure) : null;
    ro?.observe(nav);
    const unpin = () => {
      pinnedRef.current = null;
    };
    let settle = 0;
    const onScroll = () => {
      let cur = null;
      if (nav) nav.classList.toggle('is-stuck', nav.getBoundingClientRect().top <= 0 && window.scrollY > 0);
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      const pin = pinnedRef.current;
      if (pin && !pin.settled) {
        clearTimeout(settle);
        settle = setTimeout(() => {
          if (pinnedRef.current === pin) pin.settled = true;
        }, 150);
        setActiveStage(pin.stage);
        return;
      }
      if (pin && atEnd) {
        setActiveStage(pin.stage);
        return;
      }
      pinnedRef.current = null;
      // A section counts as current once its top passes ~1/3 down the visible area under the chips.
      const navBottom = nav ? nav.getBoundingClientRect().bottom : 0;
      const line = navBottom + (window.innerHeight - navBottom) * 0.33;
      for (const el of els) if (el.getBoundingClientRect().top <= line) cur = el.id.slice(6);
      // At the very bottom the last short sections can never reach the line.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        const visible = els.filter((el) => el.getBoundingClientRect().top < window.innerHeight);
        if (visible.length && !cur) cur = visible[0].id.slice(6);
      }
      setActiveStage(cur);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('touchstart', unpin, { passive: true });
    window.addEventListener('wheel', unpin, { passive: true });
    return () => {
      clearTimeout(settle);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('touchstart', unpin);
      window.removeEventListener('wheel', unpin);
      ro?.disconnect();
      root.style.removeProperty('--snav-h');
    };
  }, [data]);

  if (!me.roles.includes('reviewer')) {
    return (
      <StateScreen icon="lock" title="Akses ditolak">
        <p>Akun ini tidak terdaftar sebagai reviewer GA.</p>
        <p className="muted">Minta tim GA menambahkan akun Anda ke daftar reviewer.</p>
      </StateScreen>
    );
  }
  if (state.loading) {
    return (
      <main className="page">
        <AppHeader title="Detail inspeksi" back={BACK} />
        <Loading label="Memuat inspeksi" />
      </main>
    );
  }
  if (state.error) {
    const nf = state.error.status === 404;
    return (
      <StateScreen
        icon={nf ? 'missing' : 'alert'}
        tone={nf ? 'neutral' : 'error'}
        header={<AppHeader title="Review inspeksi" />}
        title={nf ? 'Inspeksi tidak ditemukan' : 'Gagal memuat inspeksi'}
        action={
          nf ? (
            <Link className="btn btn-ink" to="/review">Kembali ke daftar</Link>
          ) : (
            <button type="button" className="btn btn-outline" onClick={() => { setState({ loading: true }); setReload((n) => n + 1); }}>
              <Icon name="retry" size={18} /> Coba lagi
            </button>
          )
        }
      >
        <p>{nf ? 'Inspeksi ini sudah tidak ada atau link-nya salah.' : state.error.message}</p>
      </StateScreen>
    );
  }

  const uploadLink = (stage) => {
    const sp = new URLSearchParams({ booking: data.bookingId, stage });
    if (data.plate) sp.set('plate', data.plate);
    if (data.vehicle) sp.set('vehicle', data.vehicle);
    return `/upload?${sp}`;
  };
  const countFor = (s) => flatPhotos.filter((p) => p.stage === s).length;
  const jump = (s) => {
    const el = document.getElementById(`stage-${s}`);
    if (!el) return;
    pinnedRef.current = { stage: s, settled: false };
    setActiveStage(s);
    // scroll-margin-top on each section keeps it clear of the sticky chips.
    el.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };

  return (
    <main className="page page-detail">
      <AppHeader title={data.plate || 'Tanpa plat'} sub={data.vehicle || undefined} back={BACK} />

      <dl className="summary">
        <div>
          <dt>Status</dt>
          <dd>
            <StatusTag status={data.status} />
          </dd>
        </div>
        <div>
          <dt>Total foto</dt>
          <dd className="summary-num">{flatPhotos.length}</dd>
        </div>
        <div className="summary-wide">
          <dt>Booking</dt>
          <dd className="mono">{data.bookingId}</dd>
        </div>
      </dl>

      <nav className="stage-nav" aria-label="Lompat ke tahap">
        {STAGE_ORDER.map((s) => {
          const n = countFor(s);
          return (
            <button
              key={s}
              type="button"
              className={`snav${n ? ' has' : ''}${activeStage === s ? ' is-on' : ''}`}
              onClick={() => jump(s)}
              aria-label={`${STAGES[s]}, ${n} foto`}
            >
              <span className="snav-label">{STAGE_SHORT[s]}</span>
              <span className="snav-count">{n}</span>
            </button>
          );
        })}
      </nav>

      <div className="stages">
        {STAGE_ORDER.map((stage, i) => {
          const subs = data.submissions.filter((s) => s.stage === stage);
          const photos = flatPhotos.filter((p) => p.stage === stage);
          const num = String(i + 1).padStart(2, '0');
          if (photos.length === 0) {
            return (
              <section key={stage} id={`stage-${stage}`} className="stage-empty-row" aria-label={STAGES[stage]}>
                <span className="stage-num muted" aria-hidden="true">{num}</span>
                <div className="stage-empty-text">
                  <p className="stage-name">{STAGES[stage]}</p>
                  <p className="muted">Belum ada foto</p>
                </div>
                {canUpload && (
                  <Link className="btn btn-outline btn-sm" to={uploadLink(stage)} aria-label={`Tambah foto ${STAGES[stage]}`}>
                    <Icon name="plus" size={16} strokeWidth={2.5} /> Tambah
                  </Link>
                )}
              </section>
            );
          }
          return (
            <section key={stage} id={`stage-${stage}`} className="stage-block" aria-labelledby={`st-${stage}`}>
              <div className="stage-head">
                <span className="stage-num" aria-hidden="true">{num}</span>
                <h2 className="stage-name" id={`st-${stage}`}>{STAGES[stage]}</h2>
                <span className="stage-count">{photos.length} foto</span>
              </div>
              {subs.map((s) => (
                <SessionBlock key={s.id} s={s} />
              ))}
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
              {canUpload && (
                <Link className="btn btn-text btn-inline" to={uploadLink(stage)}>
                  <Icon name="plus" size={18} /> Tambah foto
                </Link>
              )}
            </section>
          );
        })}
      </div>

      <section className="review-block" aria-labelledby="sec-review">
        <h2 className="review-title" id="sec-review">Keputusan review</h2>
        {data.review && !editing && (
          <div className={`review-result review-${data.status}`}>
            <div className="review-result-head">
              <StatusTag status={data.status} />
              <span className="session-by">
                oleh {data.review.byName} · {formatDate(data.review.at)}
              </span>
            </div>
            {data.review.reason && (
              <div className="rr-item">
                <p className="field-label">Alasan</p>
                <p>{data.review.reason}</p>
              </div>
            )}
            {data.review.note && (
              <div className="rr-item">
                <p className="field-label">Catatan</p>
                <p>{data.review.note}</p>
              </div>
            )}
            <button type="button" className="btn btn-text btn-inline" onClick={() => setEditing(true)}>
              <Icon name="edit" size={16} /> Ubah keputusan
            </button>
          </div>
        )}
        {data.photos.length === 0 ? (
          <p className="muted">Belum ada foto yang bisa direview.</p>
        ) : (
          (!data.review || editing) && (
            <ReviewForm
              inspection={data}
              onCancel={editing ? () => setEditing(false) : null}
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
