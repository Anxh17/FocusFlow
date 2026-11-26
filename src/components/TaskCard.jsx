import { useState } from 'react';
import {
  Check, Clock, Edit3, Trash2, CalendarClock, Lock,
  RotateCcw, Flag, History, ChevronDown, ChevronUp
} from 'lucide-react';
import {
  formatDuration,
  formatDisplayDate,
  formatSecondsCompact,
  formatTimerSeconds,
} from '../utils/dateUtils.js';
import TaskTimer from './TaskTimer.jsx';

export default function TaskCard({
  task,
  allTasks = [],
  milestones = [],
  activeTimer = null,
  blocked = false,
  blockingNames = [],
  onToggle,
  onEdit,
  onDelete,
  onPostpone,
  onStartTimer,
  onPauseTimer,
  onResumeTimer,
  onStopTimer,
  compact = false,
}) {
  const [showSessions, setShowSessions] = useState(false);
  const isCompleted = task.status === 'completed';
  const sessions = Array.isArray(task.timeSessions) ? task.timeSessions : [];
  const milestone = task.milestoneId
    ? milestones.find((m) => m.id === task.milestoneId)
    : null;

  const prereqTitles = (task.dependencies || [])
    .map((id) => allTasks.find((t) => t.id === id)?.title)
    .filter(Boolean);

  return (
    <div className={`task-card-wrapper${isCompleted ? ' completed' : ''}${blocked ? ' blocked' : ''}`}>
      <div className={`task-card${isCompleted ? ' completed' : ''}`}>
        <button
          className={`task-checkbox${isCompleted ? ' checked' : ''}${blocked ? ' blocked' : ''}`}
          onClick={() => onToggle && onToggle(task)}
          aria-label={
            blocked
              ? `Blocked task: ${task.title}`
              : isCompleted
                ? `Reopen task: ${task.title}`
                : `Complete task: ${task.title}`
          }
          title={blocked ? `Blocked by: ${blockingNames.join(', ')}` : undefined}
          type="button"
        >
          {isCompleted ? <Check /> : blocked ? <Lock size={12} /> : null}
        </button>

        <div className="task-info">
          <div className="task-title">
            {task.title}
            {blocked && (
              <span className="badge badge-blocked" style={{ marginLeft: 8 }}>
                <Lock size={11} /> Blocked
              </span>
            )}
          </div>

          {!compact && task.description && (
            <div className="task-desc">{task.description}</div>
          )}

          <div className="task-meta">
            <span className={`badge badge-${task.priority}`}>{task.priority}</span>
            <span className="task-meta-item" title="Estimated duration">
              <Clock />
              Est: {formatDuration(task.estimatedMinutes)}
            </span>
            {!compact && (
              <span className="task-meta-item" title="Actual tracked time">
                Actual: {formatSecondsCompact(task.actualSeconds || 0)}
              </span>
            )}
            {!compact && (
              <span className="task-meta-item">
                {formatDisplayDate(task.date)}
              </span>
            )}
            {!compact && milestone && (
              <span className="badge badge-accent">
                <Flag size={10} /> {milestone.title}
              </span>
            )}
            {!compact && (task.postponementCount || 0) > 0 && (
              <span className="task-meta-item" style={{ color: 'var(--color-warning)' }}>
                <RotateCcw /> Postponed {task.postponementCount}x
              </span>
            )}
          </div>

          {!compact && prereqTitles.length > 0 && (
            <div className="text-sm text-muted" style={{ marginTop: 6 }}>
              Depends on: {prereqTitles.join(', ')}
            </div>
          )}
        </div>

        <div className="task-actions">
          {!compact && onStartTimer && !isCompleted && (
            <TaskTimer
              task={task}
              activeTimer={activeTimer}
              onStart={onStartTimer}
              onPause={onPauseTimer}
              onResume={onResumeTimer}
              onStop={onStopTimer}
            />
          )}
          {!compact && sessions.length > 0 && (
            <button
              className="btn-icon"
              type="button"
              onClick={() => setShowSessions((s) => !s)}
              aria-label={`View time sessions for ${task.title}`}
              title={`Time sessions (${sessions.length})`}
            >
              <History size={15} />
              {showSessions ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          )}
          {onPostpone && !isCompleted && (
            <button
              className="btn-icon"
              onClick={() => onPostpone(task)}
              aria-label={`Postpone task: ${task.title}`}
              type="button"
              title="Postpone"
            >
              <CalendarClock size={16} />
            </button>
          )}
          {onEdit && (
            <button
              className="btn-icon"
              onClick={() => onEdit(task)}
              aria-label={`Edit task: ${task.title}`}
              type="button"
              title="Edit"
            >
              <Edit3 size={16} />
            </button>
          )}
          {onDelete && (
            <button
              className="btn-icon"
              onClick={() => onDelete(task)}
              aria-label={`Delete task: ${task.title}`}
              type="button"
              title="Delete"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {showSessions && sessions.length > 0 && (
        <div className="session-history">
          <div className="text-sm" style={{ fontWeight: 600, marginBottom: 6 }}>
            Recorded Time Sessions ({sessions.length})
          </div>
          {sessions.map((s) => (
            <div key={s.id} className="session-history-row">
              <span>{new Date(s.startedAt).toLocaleString()}</span>
              <span>{formatTimerSeconds(s.durationSeconds)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
