import { useEffect, useState } from 'react';
import { useLocation } from './router.jsx';
import { apiGet } from './lib/api.js';
import { insideTelegram } from './lib/telegram.js';
import { AppHeader, Loading, Notice } from './components/Layout.jsx';
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
  let title = 'Tidak bisa membuka halaman';
  let body = error.message;
  if (error.status === 401) {
    title = 'Buka dari GA Bot Telegram';
    body = insideTelegram()
      ? 'Sesi Telegram tidak valid atau sudah lebih dari 24 jam. Tutup halaman ini lalu tekan lagi tombol dari GA Bot.'
      : 'Halaman ini hanya bisa dibuka lewat tombol di GA Bot Telegram.';
  } else if (error.status === 403) {
    title = 'Akses ditolak';
    body = 'Akun Telegram ini belum terdaftar sebagai admin GA. Hubungi tim GA untuk didaftarkan.';
  }
  return (
    <main className="page">
      <AppHeader title="Inspection Kendaraan" />
      <Notice kind="error" title={title}>
        <p>{body}</p>
      </Notice>
    </main>
  );
}

export default function App() {
  const { path, search } = useLocation();
  const { me, loading, error } = useMe();

  if (loading) {
    return (
      <main className="page">
        <AppHeader title="Inspection Kendaraan" />
        <Loading label="Memeriksa akses" />
      </main>
    );
  }
  if (error) return <AuthProblem error={error} />;

  const detail = path.match(/^\/review\/([A-Za-z0-9_-]+)\/?$/);
  if (path.startsWith('/upload')) return <UploadPage me={me} search={search} />;
  if (detail) return <ReviewDetail me={me} id={detail[1]} />;
  if (path === '/review' || path === '/review/') return <ReviewList me={me} search={search} />;

  return (
    <main className="page">
      <AppHeader title="Inspection Kendaraan" sub={me.name} />
      <Notice kind="info" title="Pilih menu">
        <p>Halaman ini dibuka dari tombol GA Bot. Pilih tujuan:</p>
      </Notice>
      <div className="stack">
        {me.roles.includes('reviewer') && (
          <a className="btn btn-primary" href="/review">
            Daftar inspection untuk direview
          </a>
        )}
        {me.roles.includes('uploader') && (
          <p className="muted">Untuk upload foto, buka tombol upload pada pesan booking di GA Bot.</p>
        )}
      </div>
    </main>
  );
}
