import { loadState, saveState } from './storageService.js';

/**
 * Calculate live elapsed seconds for the current active timer using real timestamps.
 */
export function getActiveTimerElapsedSeconds(activeTimer, nowMs = Date.now()) {
  if (!activeTimer) return 0;
  const base = Math.max(0, activeTimer.elapsedBeforePauseSeconds || 0);
  if (activeTimer.status === 'paused' || !activeTimer.startedAt) {
    return base;
  }
  const startedMs = Date.parse(activeTimer.startedAt);
  if (Number.isNaN(startedMs)) return base;
  const delta = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
  return base + delta;
}

export function getActiveTimer() {
  const state = loadState();
  return state.activeTimer || null;
}

/**
 * Start a timer for a task.
 * If another timer is already running/paused, returns { conflict: true, activeTimer }
 * unless forceSwitch is true (in which case it stops & saves the previous timer first).
 */
export function startTimer(taskId, { forceSwitch = false, now = new Date() } = {}) {
  const state = loadState();
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) {
    throw new Error('Task not found.');
  }
  if (task.status === 'completed') {
    throw new Error('Cannot start a timer for a completed task.');
  }

  if (state.activeTimer && state.activeTimer.taskId !== taskId) {
    if (!forceSwitch) {
      return { conflict: true, activeTimer: state.activeTimer };
    }
    stopTimer({ now });
  }

  const freshState = loadState();
  if (freshState.activeTimer && freshState.activeTimer.taskId === taskId) {
    if (freshState.activeTimer.status === 'paused') {
      return resumeTimer({ now });
    }
    return { conflict: false, activeTimer: freshState.activeTimer };
  }

  const nowIso = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  freshState.activeTimer = {
    taskId,
    startedAt: nowIso,
    sessionStartedAt: nowIso,
    status: 'running',
    pausedAt: null,
    elapsedBeforePauseSeconds: 0,
  };
  saveState(freshState);
  return { conflict: false, activeTimer: freshState.activeTimer };
}

export function pauseTimer({ now = new Date() } = {}) {
  const state = loadState();
  if (!state.activeTimer || state.activeTimer.status === 'paused') {
    return state.activeTimer || null;
  }

  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const elapsed = getActiveTimerElapsedSeconds(state.activeTimer, nowMs);

  state.activeTimer = {
    ...state.activeTimer,
    status: 'paused',
    pausedAt: new Date(nowMs).toISOString(),
    startedAt: null,
    elapsedBeforePauseSeconds: elapsed,
  };
  saveState(state);
  return state.activeTimer;
}

export function resumeTimer({ now = new Date() } = {}) {
  const state = loadState();
  if (!state.activeTimer) return null;
  if (state.activeTimer.status === 'running') {
    return { conflict: false, activeTimer: state.activeTimer };
  }

  const nowIso = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  state.activeTimer = {
    ...state.activeTimer,
    status: 'running',
    startedAt: nowIso,
    pausedAt: null,
  };
  saveState(state);
  return { conflict: false, activeTimer: state.activeTimer };
}

/**
 * Stop the active timer, record a timeSession on the task, and accumulate actualSeconds.
 */
export function stopTimer({ now = new Date() } = {}) {
  const state = loadState();
  if (!state.activeTimer) return null;

  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const nowIso = new Date(nowMs).toISOString();
  const durationSeconds = Math.max(0, getActiveTimerElapsedSeconds(state.activeTimer, nowMs));
  const taskIdx = state.tasks.findIndex((t) => t.id === state.activeTimer.taskId);

  let recordedSession = null;
  if (taskIdx !== -1 && durationSeconds > 0) {
    recordedSession = {
      id: crypto.randomUUID(),
      startedAt: state.activeTimer.sessionStartedAt || state.activeTimer.startedAt || nowIso,
      endedAt: nowIso,
      durationSeconds,
    };
    const task = state.tasks[taskIdx];
    const prevSessions = Array.isArray(task.timeSessions) ? task.timeSessions : [];
    const prevActual = typeof task.actualSeconds === 'number' ? task.actualSeconds : 0;

    state.tasks[taskIdx] = {
      ...task,
      timeSessions: [...prevSessions, recordedSession],
      actualSeconds: prevActual + durationSeconds,
      updatedAt: nowIso,
    };
  }

  state.activeTimer = null;
  saveState(state);
  return { session: recordedSession, durationSeconds };
}
