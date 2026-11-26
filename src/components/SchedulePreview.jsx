import { X, AlertTriangle, CheckCircle2, Calendar } from 'lucide-react';
import { formatDisplayDate, formatDuration } from '../utils/dateUtils.js';

export default function SchedulePreview({ preview, onConfirm, onClose }) {
  if (!preview) return null;

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Schedule Preview">
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580 }}>
        <div className="modal-header">
          <h2>Schedule Preview</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close" type="button">
            <X size={18} />
          </button>
        </div>

        <p className="text-sm text-muted" style={{ marginBottom: 16 }}>
          {preview.explanation} Completed tasks ({preview.preservedCompleted.length}) will be preserved untouched.
        </p>

        {!preview.feasible && (
          <div className="sample-data-notice" style={{ marginBottom: 16 }}>
            <AlertTriangle />
            <div>
              <strong>Schedule infeasible:</strong> {preview.unscheduled.length} task(s) could not fit
              ({formatDuration(preview.shortfallMinutes)} shortfall at {formatDuration(preview.dailyCapacity)}/day).
            </div>
          </div>
        )}

        <div className="preview-list">
          {preview.scheduledPending.map((t) => (
            <div key={t.id} className="preview-item">
              <span className="preview-item-title">{t.title}</span>
              <span className="task-meta-item">
                <Calendar size={13} /> {formatDisplayDate(t.date)} · {formatDuration(t.estimatedMinutes)}
              </span>
            </div>
          ))}
          {preview.unscheduled.map((t) => (
            <div key={t.id} className="preview-item unscheduled">
              <div>
                <div className="preview-item-title">{t.title}</div>
                <div className="text-sm" style={{ color: 'var(--color-error)' }}>{t.reason}</div>
              </div>
              <span className="badge badge-high">Unscheduled</span>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onConfirm(preview.scheduledTasks)}
          >
            <CheckCircle2 size={16} /> Apply Revised Schedule
          </button>
        </div>
      </div>
    </div>
  );
}
