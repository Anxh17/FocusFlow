import { useEffect, useState } from 'react';
import { Play, Pause, Square, Clock } from 'lucide-react';
import { getActiveTimerElapsedSeconds } from '../services/timerService.js';
import { formatTimerSeconds } from '../utils/dateUtils.js';

export default function TaskTimer({
  task,
  activeTimer,
  onStart,
  onPause,
  onResume,
  onStop,
}) {
  const isThisTaskActive = activeTimer && activeTimer.taskId === task.id;
  const isRunning = isThisTaskActive && activeTimer.status === 'running';
  const isPaused = isThisTaskActive && activeTimer.status === 'paused';

  const [, setTick] = useState(0);

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  const elapsed = isThisTaskActive ? getActiveTimerElapsedSeconds(activeTimer) : 0;

  if (task.status === 'completed') {
    return null;
  }

  return (
    <div className={`task-timer${isThisTaskActive ? ' active' : ''}`}>
      {isThisTaskActive ? (
        <>
          <span className="timer-readout" aria-live="polite">
            <Clock size={13} />
            {formatTimerSeconds(elapsed)}
            {isPaused && <span className="timer-paused-tag">Paused</span>}
          </span>
          {isRunning ? (
            <button
              type="button"
              className="btn-icon"
              onClick={() => onPause && onPause()}
              aria-label={`Pause timer for ${task.title}`}
              title="Pause timer"
            >
              <Pause size={15} />
            </button>
          ) : (
            <button
              type="button"
              className="btn-icon"
              onClick={() => onResume && onResume()}
              aria-label={`Resume timer for ${task.title}`}
              title="Resume timer"
            >
              <Play size={15} />
            </button>
          )}
          <button
            type="button"
            className="btn-icon"
            onClick={() => onStop && onStop()}
            aria-label={`Stop timer for ${task.title}`}
            title="Stop & save session"
          >
            <Square size={14} />
          </button>
        </>
      ) : (
        <button
          type="button"
          className="btn-icon"
          onClick={() => onStart && onStart(task)}
          aria-label={`Start timer for ${task.title}`}
          title="Start timer"
        >
          <Play size={15} />
        </button>
      )}
    </div>
  );
}
