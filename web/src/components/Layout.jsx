import Icon from './Icon.jsx';
import { Link } from '../router.jsx';

export function AppHeader({ title, sub, back }) {
  return (
    <header className="app-header">
      <div className="brand-row">
        <img src="/logo.png" alt="INTEK" className="brand-logo" width="113" height="23" />
        <span className="brand-unit">General Affairs</span>
      </div>
      {back && (
        <Link to={back.to} className="back-link">
          <Icon name="left" size={18} strokeWidth={2.25} /> {back.label}
        </Link>
      )}
      <div className={`title-block${back ? ' has-back' : ''}`}>
        <h1>{title}</h1>
        {sub && <p className="title-sub">{sub}</p>}
      </div>
    </header>
  );
}

// Numbered step head in the INTEK GA guide style: red number, bold title, quiet aside.
export function StepHead({ num, title, aside, id }) {
  return (
    <div className="step-head">
      <span className="step-num" aria-hidden="true">{num}</span>
      <h2 className="step-title" id={id}>{title}</h2>
      {aside && <span className="step-aside">{aside}</span>}
    </div>
  );
}

export function SectionLabel({ children, aside }) {
  return (
    <div className="section-label">
      <span>{children}</span>
      {aside && <span className="section-aside">{aside}</span>}
    </div>
  );
}

const STATUS_LABELS = { pending: 'Menunggu review', approved: 'Disetujui', rejected: 'Ditolak' };
export function StatusTag({ status, short }) {
  const label = short && status === 'pending' ? 'Menunggu' : STATUS_LABELS[status] || status;
  return <span className={`status-tag status-${status}`}>{label}</span>;
}

export function Notice({ kind = 'info', title, children, action }) {
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {title && <p className="notice-title">{title}</p>}
      {children && <div className="notice-body">{children}</div>}
      {action}
    </div>
  );
}

// Full-height state (error, access, not found): icon, meaningful title, one sentence, next step.
export function StateScreen({ icon = 'alert', tone = 'neutral', title, children, action, header }) {
  return (
    <main className="page page-state">
      {header || <AppHeader title="Inspeksi kendaraan" />}
      <section className="state" role={tone === 'error' ? 'alert' : 'status'}>
        <span className={`state-icon state-${tone}`} aria-hidden="true">
          <Icon name={icon} size={28} strokeWidth={2.25} />
        </span>
        <h2 className="state-title">{title}</h2>
        {children && <div className="state-body">{children}</div>}
        {action && <div className="state-action">{action}</div>}
      </section>
    </main>
  );
}

export function Loading({ label = 'Memuat' }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="loading-bar" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ProgressBar({ value, label }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function roleLabel(roles = []) {
  const up = roles.includes('uploader');
  const rv = roles.includes('reviewer');
  if (up && rv) return 'Admin GA, upload dan review';
  if (rv) return 'Reviewer GA';
  if (up) return 'Pengunggah foto GA';
  return '';
}
