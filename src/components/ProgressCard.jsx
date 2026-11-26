export default function ProgressCard({ label, value, total, color = 'var(--accent-primary)' }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;

  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        <span style={{ fontSize: '0.875rem', fontWeight: 400, color: 'var(--text-muted)' }}>
          {' '}/ {total}
        </span>
      </div>
      <div className="progress-bar-container">
        <div
          className={`progress-bar-fill${pct === 100 ? ' success' : ''}`}
          style={{ width: `${pct}%`, background: pct === 100 ? undefined : color }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label={`${label}: ${value} of ${total}`}
        />
      </div>
      <div className="text-sm text-muted" style={{ marginTop: 4 }}>{pct}% complete</div>
    </div>
  );
}
