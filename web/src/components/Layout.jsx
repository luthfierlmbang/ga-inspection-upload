export function AppHeader({ title, sub, right }) {
  return (
    <header className="app-header">
      <div className="brand-row">
        <img src="/logo.png" alt="INTEK" className="brand-logo" width="113" height="23" />
        <span className="brand-unit">General Affairs</span>
      </div>
      <div className="title-row">
        <div className="title-block">
          <h1>{title}</h1>
          {sub && <p className="title-sub">{sub}</p>}
        </div>
        {right}
      </div>
    </header>
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

export function StatusTag({ status }) {
  const labels = { pending: 'Menunggu review', approved: 'Disetujui', rejected: 'Ditolak' };
  return <span className={`status-tag status-${status}`}>{labels[status] || status}</span>;
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
