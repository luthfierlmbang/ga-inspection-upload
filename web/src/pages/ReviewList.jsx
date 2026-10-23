import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api.js';
import { STAGES, STAGE_ORDER, STAGE_SHORT, relativeTime, formatDate, shortId } from '../lib/format.js';
import { AppHeader, Notice, Loading, StatusTag, StateScreen, roleLabel } from '../components/Layout.jsx';
import { Link, navigate } from '../router.jsx';
import Icon from '../components/Icon.jsx';

const FILTERS = [
  ['pending', 'Menunggu'],
  ['approved', 'Disetujui'],
  ['rejected', 'Ditolak'],
  ['', 'Semua'],
];

function StageStrip({ stages }) {
  const done = STAGE_ORDER.filter((s) => stages.includes(s)).length;
  return (
    <ol className="sstrip" aria-label={`Tahap berisi foto: ${done} dari 4`}>
      {STAGE_ORDER.map((s) => {
        const on = stages.includes(s);
        return (
          <li key={s} className={`sstrip-item${on ? ' is-on' : ''}`} title={STAGES[s]}>
            <span className="sstrip-bar" aria-hidden="true" />
            <span className="sstrip-label">
              {STAGE_SHORT[s]}
              <span className="sr-only">{on ? ': ada foto' : ': belum ada foto'}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function ReviewList({ me, search }) {
  const params = new URLSearchParams(search);
  const status = params.has('status') ? params.get('status') : 'pending';
  const [q, setQ] = useState(params.get('q') || '');
  const [term, setTerm] = useState(q);
  const [state, setState] = useState({ loading: true });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const sp = new URLSearchParams();
    sp.set('status', status);
    if (term) sp.set('q', term);
    window.history.replaceState(null, '', `/review?${sp}`);
    let alive = true;
    setState((s) => ({ loading: true, items: s.items, counts: s.counts }));
    apiGet(`/api/inspections?${sp}`)
      .then((d) => alive && setState({ items: d.items, counts: d.counts || null }))
      .catch((e) => alive && setState({ error: e.message }));
    return () => {
      alive = false;
    };
  }, [status, term, reload]);

  if (!me.roles.includes('reviewer')) {
    return (
      <StateScreen icon="lock" title="Akses ditolak">
        <p>Akun ini tidak terdaftar sebagai reviewer GA.</p>
        <p className="muted">Untuk upload foto, buka tombol upload pada pesan booking di GA Bot.</p>
      </StateScreen>
    );
  }

  const setStatus = (s) => {
    const sp = new URLSearchParams();
    sp.set('status', s);
    if (term) sp.set('q', term);
    navigate(`/review?${sp}`, { replace: true });
  };

  // Plates that appear more than once get their booking suffix and date in the top line.
  const plateCount = {};
  (state.items || []).forEach((it) => {
    const k = (it.plate || '').replace(/\s+/g, '').toUpperCase();
    plateCount[k] = (plateCount[k] || 0) + 1;
  });

  const counts = state.counts;
  const filterLabel = FILTERS.find(([v]) => v === status)?.[1] || 'Semua';

  return (
    <main className="page">
      <AppHeader title="Review inspeksi" sub={roleLabel(me.roles)} />

      <div className="filters">
        <label className="search">
          <Icon name="search" size={18} />
          <span className="sr-only">Cari booking atau plat</span>
          <input type="search" className="search-input" placeholder="Cari ID booking atau plat" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
        </label>
        <div className="tabs" role="tablist" aria-label="Filter status">
          {FILTERS.map(([value, label]) => {
            const n = counts ? counts[value || 'all'] : null;
            return (
              <button key={value || 'all'} type="button" role="tab" aria-selected={status === value} className={`tab${status === value ? ' is-on' : ''}`} onClick={() => setStatus(value)}>
                <span>{label}</span>
                {n !== null && n !== undefined && <span className="tab-count">{n}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {state.error && (
        <Notice kind="error" title="Daftar gagal dimuat" action={<button type="button" className="btn btn-outline" onClick={() => setReload((n) => n + 1)}>Coba lagi</button>}>
          <p>{state.error}</p>
        </Notice>
      )}
      {state.loading && !state.items && <Loading label="Memuat daftar" />}
      {state.items && state.items.length === 0 && (
        <div className="empty">
          <span className="empty-icon" aria-hidden="true">
            <Icon name={term ? 'search' : 'inbox'} size={24} />
          </span>
          <p className="empty-title">{term ? 'Tidak ada hasil' : status === 'pending' ? 'Tidak ada yang menunggu review' : `Belum ada inspeksi ${filterLabel.toLowerCase()}`}</p>
          <p className="muted">
            {term
              ? `Tidak ada plat atau booking yang cocok dengan "${term}" di filter ${filterLabel}.`
              : status === 'pending'
                ? 'Inspeksi baru muncul di sini setelah admin GA mengirim foto lewat GA Bot.'
                : 'Coba filter lain atau cari berdasarkan plat.'}
          </p>
          {(term || status !== '') && (
            <button type="button" className="btn btn-outline" onClick={() => { setQ(''); setStatus(''); }}>
              Lihat semua inspeksi
            </button>
          )}
        </div>
      )}
      {state.items && state.items.length > 0 && (
        <ul className={`insp-list${state.loading ? ' is-stale' : ''}`} aria-busy={state.loading}>
          {state.items.map((it) => {
            const dup = plateCount[(it.plate || '').replace(/\s+/g, '').toUpperCase()] > 1;
            return (
              <li key={it.id}>
                <Link to={`/review/${it.id}`} className="insp-row">
                  <div className="insp-main">
                    <div className="insp-top">
                      <div className="insp-id">
                        <p className="insp-plate">
                          {it.plate || 'Tanpa plat'}
                          {dup && <span className="insp-dup mono"> #{shortId(it.bookingId)}</span>}
                        </p>
                        {it.vehicle && <p className="insp-vehicle">{it.vehicle}</p>}
                      </div>
                      <StatusTag status={it.status} short />
                    </div>
                    <p className="insp-booking mono">{it.bookingId}</p>
                    <StageStrip stages={it.stages} />
                    <p className="insp-foot">
                      {it.photoCount} foto · <time dateTime={it.updatedAt} title={formatDate(it.updatedAt)}>{dup ? formatDate(it.updatedAt) : relativeTime(it.updatedAt)}</time>
                    </p>
                  </div>
                  <Icon name="right" className="insp-chev" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
