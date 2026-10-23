import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api.js';
import { STAGES, STAGE_ORDER, formatDate } from '../lib/format.js';
import { AppHeader, Notice, Loading, StatusTag } from '../components/Layout.jsx';
import { Link, navigate } from '../router.jsx';
import Icon from '../components/Icon.jsx';

const FILTERS = [
  ['pending', 'Menunggu'],
  ['approved', 'Disetujui'],
  ['rejected', 'Ditolak'],
  ['', 'Semua'],
];

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
    setState((s) => ({ loading: true, items: s.items }));
    apiGet(`/api/inspections?${sp}`)
      .then((d) => alive && setState({ items: d.items }))
      .catch((e) => alive && setState({ error: e.message }));
    return () => {
      alive = false;
    };
  }, [status, term, reload]);

  if (!me.roles.includes('reviewer')) {
    return (
      <main className="page">
        <AppHeader title="Review inspection" />
        <Notice kind="error" title="Akses ditolak">
          <p>Akun ini tidak terdaftar sebagai reviewer GA.</p>
        </Notice>
      </main>
    );
  }

  const setStatus = (s) => {
    const sp = new URLSearchParams();
    sp.set('status', s);
    if (term) sp.set('q', term);
    navigate(`/review?${sp}`, { replace: true });
  };

  return (
    <main className="page">
      <AppHeader title="Review inspection" sub={me.name} />

      <div className="filters">
        <label className="search">
          <Icon name="search" size={18} />
          <span className="sr-only">Cari booking atau plat</span>
          <input type="search" className="search-input" placeholder="Cari ID booking atau plat" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
        </label>
        <div className="tabs" role="tablist" aria-label="Filter status">
          {FILTERS.map(([value, label]) => (
            <button key={value || 'all'} type="button" role="tab" aria-selected={status === value} className={`tab${status === value ? ' is-on' : ''}`} onClick={() => setStatus(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {state.error && (
        <Notice kind="error" title="Daftar gagal dimuat" action={<button type="button" className="btn btn-outline" onClick={() => setReload((n) => n + 1)}>Coba lagi</button>}>
          <p>{state.error}</p>
        </Notice>
      )}
      {state.loading && !state.items && <Loading label="Memuat daftar" />}
      {state.items && state.items.length === 0 && (
        <div className="empty-drop">
          <p className="empty-title">{term ? 'Tidak ada hasil' : 'Belum ada inspection'}</p>
          <p className="muted">
            {term ? `Tidak ada inspection yang cocok dengan "${term}" di filter ini.` : 'Inspection akan muncul di sini setelah admin GA mengirim foto.'}
          </p>
        </div>
      )}
      {state.items && state.items.length > 0 && (
        <ul className={`insp-list${state.loading ? ' is-stale' : ''}`} aria-busy={state.loading}>
          {state.items.map((it) => (
            <li key={it.id}>
              <Link to={`/review/${it.id}`} className="insp-row">
                <div className="insp-main">
                  <div className="insp-top">
                    <strong className="insp-plate">{it.plate || 'Tanpa plat'}</strong>
                    <StatusTag status={it.status} />
                  </div>
                  <p className="insp-booking mono">{it.bookingId}</p>
                  <div className="stage-dots" aria-label="Tahap yang sudah ada foto">
                    {STAGE_ORDER.map((s, i) => (
                      <span key={s} className={`stage-dot${it.stages.includes(s) ? ' is-on' : ''}`} title={STAGES[s]}>
                        {i + 1}
                      </span>
                    ))}
                    <span className="muted small">{it.photoCount} foto</span>
                  </div>
                  <p className="muted small">Diperbarui {formatDate(it.updatedAt)}</p>
                </div>
                <Icon name="right" className="insp-chev" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
