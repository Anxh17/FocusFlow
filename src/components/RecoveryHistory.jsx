import { CheckCircle2, XCircle, Clock } from 'lucide-react';
import { formatDisplayDate, toLocalDateStr } from '../utils/dateUtils.js';

export default function RecoveryHistory({ records = [] }) {
  if (!records || records.length === 0) {
    return (
      <div className="card" style={{ padding: '20px', textAlign: 'center' }}>
        <p className="text-sm text-muted">No schedule recoveries recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="recovery-history-list">
      {records.map((rec) => {
        const dateStr = toLocalDateStr(rec.timestamp);
        const timeStr = rec.timestamp
          ? new Date(rec.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '';
        const isApplied = rec.status === 'applied';

        return (
          <div key={rec.id} className="recovery-history-item">
            <div className="recovery-history-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {isApplied ? (
                  <CheckCircle2 size={16} color="var(--color-success)" />
                ) : (
                  <XCircle size={16} color="var(--text-muted)" />
                )}
                <span className="badge badge-accent" style={{ textTransform: 'capitalize' }}>
                  {rec.approach}
                </span>
                <span className={`badge ${isApplied ? 'badge-low' : 'badge-medium'}`}>
                  {rec.status}
                </span>
              </div>
              <span className="text-sm text-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Clock size={12} /> {formatDisplayDate(dateStr)} {timeStr}
              </span>
            </div>

            {rec.userExplanation && (
              <div className="text-sm" style={{ marginTop: 6, color: 'var(--text-secondary)' }}>
                &ldquo;{rec.userExplanation}&rdquo;
              </div>
            )}

            <div className="text-sm text-muted" style={{ marginTop: 6 }}>
              {rec.summary || `${rec.movedCount || 0} moved · ${rec.unchangedCount || 0} unchanged`}
            </div>
          </div>
        );
      })}
    </div>
  );
}
