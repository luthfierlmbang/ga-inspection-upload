import { useEffect, useState } from 'react';
import { useLocation } from './router.jsx';
import { apiGet } from './lib/api.js';
import { insideTelegram } from './lib/telegram.js';
import { AppHeader, Loading, StateScreen, roleLabel } from './components/Layout.jsx';
import UploadPage from './pages/UploadPage.jsx';
import ReviewList from './pages/ReviewList.jsx';
import ReviewDetail from './pages/ReviewDetail.jsx';

function useMe() {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let alive = true;
    apiGet('/api/me')
      .then((d) => alive && setState({ me: d.user }))
      .catch((e) => alive && setState({ error: e }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

function AuthProblem({ error }) {
  if (error.status === 401) {
    return (
      <StateScreen icon="phone" title="Buka lewat GA Bot">
        <p>
          {insideTelegram()
            ? 'Sesi Telegram tidak valid atau sudah lebih dari 24 jam.'
            : 'Halaman ini hanya bisa dibuka dari tombol di GA Bot Telegram.'}
        </p>
        <p className="muted">Tutup halaman ini, lalu tekan lagi tombol inspeksi pada pesan booking di GA Bot.</p>
      </StateScreen>
    );
  }
  if (error.status === 403) {
    return (
      <StateScreen icon="lock" title="Akses ditolak">
        <p>Akun Telegram ini belum terdaftar sebagai admin GA.</p>
        <p className="muted">Hubungi tim GA dan kirim ID Telegram Anda untuk didaftarkan.</p>
      </StateScreen>
    );
  }
  return (
    <StateScreen icon="alert" tone="error" title="Tidak bisa membuka halaman" action={<button type="button" className="btn btn-outline" onClick={() => window.location.reload()}>Muat ulang</button>}>
      <p>{error.message}</p>
    </StateScreen>
  );
}

export default function App() {
  const { path, search } = useLocation();
  const { me, loading, error } = useMe();

  if (loading) {
    return (
      <main className="page">
        <AppHeader title="Inspeksi kendaraan" />
        <Loading label="Memeriksa akses" />
      </main>
    );
  }
  if (error) return <AuthProblem error={error} />;

  const detail = path.match(/^\/review\/([A-Za-z0-9_-]+)\/?$/);
  if (path.startsWith('/upload')) return <UploadPage me={me} search={search} />;
  if (detail) return <ReviewDetail me={me} id={detail[1]} />;
  if (path === '/review' || path === '/review/') return <ReviewList me={me} search={search} />;

  if (path !== '/' && path !== '') {
    return (
      <StateScreen icon="missing" title="Tidak ditemukan" action={me.roles.includes('reviewer') && <a className="btn btn-outline" href="/review">Buka daftar review</a>}>
        <p>Halaman ini tidak ada.</p>
        <p className="muted">Buka lagi dari tombol di GA Bot.</p>
      </StateScreen>
    );
  }

  return (
    <main className="page">
      <AppHeader title="Inspeksi kendaraan" sub={roleLabel(me.roles)} />
      <div className="stack">
        {me.roles.includes('reviewer') && (
          <a className="btn btn-primary btn-block" href="/review">
            Buka daftar review
          </a>
        )}
        {me.roles.includes('uploader') && (
          <p className="muted">Untuk upload foto, tekan tombol upload pada pesan booking di GA Bot.</p>
        )}
      </div>
    </main>
  );
}
