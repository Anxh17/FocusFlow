import { Check, Calendar, Edit3 } from 'lucide-react';
import { formatDisplayDate } from '../utils/dateUtils.js';

export default function MilestoneCard({ milestone, progress, onToggle, onEdit }) {
  const isCompleted = milestone.status === 'completed';

  return (
    <div className={`milestone-card${isCompleted ? ' completed' : ''}`}>
      <div className="milestone-card-header">
        <button
          type="button"
          className={`task-checkbox${isCompleted ? ' checked' : ''}`}
          onClick={() => onToggle && onToggle(milestone)}
          aria-label={isCompleted ? `Reopen milestone: ${milestone.title}` : `Complete milestone: ${milestone.title}`}
        >
          {isCompleted && <Check />}
        </button>
        <div className="milestone-card-info">
          <div className="milestone-title">{milestone.title}</div>
          {milestone.description && (
            <div className="text-sm text-muted">{milestone.description}</div>
          )}
        </div>
        {onEdit && (
          <button
            type="button"
            className="btn-icon"
            onClick={() => onEdit(milestone)}
            aria-label={`Edit milestone: ${milestone.title}`}
            title="Edit milestone"
          >
            <Edit3 size={15} />
          </button>
        )}
      </div>

      <div className="milestone-card-footer">
        <span className="task-meta-item">
          <Calendar size={13} /> {formatDisplayDate(milestone.targetDate)}
        </span>
        <span className="text-sm text-muted">
          {progress.completed}/{progress.total} tasks ({progress.percentage}%)
        </span>
      </div>
      <div className="progress-bar-container" style={{ marginTop: 8 }}>
        <div
          className={`progress-bar-fill${progress.percentage === 100 || isCompleted ? ' success' : ''}`}
          style={{ width: `${isCompleted ? 100 : progress.percentage}%` }}
        />
      </div>
    </div>
  );
}
