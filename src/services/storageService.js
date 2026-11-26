const STORAGE_KEY = 'focusflow_data';
export const SCHEMA_VERSION = 3;

export function getDefaultState() {
  return {
    version: SCHEMA_VERSION,
    goal: null,
    tasks: [],
    onboardingComplete: false,
    activeTimer: null,
    recoveryHistory: [],
  };
}

function normalizeTask(task) {
  if (!task || typeof task !== 'object' || !task.id || typeof task.title !== 'string') {
    return null;
  }
  return {
    ...task,
    description: typeof task.description === 'string' ? task.description : '',
    estimatedMinutes: typeof task.estimatedMinutes === 'number' && task.estimatedMinutes > 0
      ? task.estimatedMinutes
      : 30,
    priority: ['high', 'medium', 'low'].includes(task.priority) ? task.priority : 'medium',
    status: task.status === 'completed' ? 'completed' : 'pending',
    actualSeconds: typeof task.actualSeconds === 'number' && task.actualSeconds >= 0 ? task.actualSeconds : 0,
    timeSessions: Array.isArray(task.timeSessions) ? task.timeSessions : [],
    dependencies: Array.isArray(task.dependencies) ? task.dependencies.filter((d) => typeof d === 'string' && d !== task.id) : [],
    postponementCount: typeof task.postponementCount === 'number' && task.postponementCount >= 0 ? task.postponementCount : 0,
    postponementHistory: Array.isArray(task.postponementHistory) ? task.postponementHistory : [],
    milestoneId: typeof task.milestoneId === 'string' ? task.milestoneId : null,
  };
}

function normalizeMilestone(m) {
  if (!m || typeof m !== 'object' || !m.id || typeof m.title !== 'string') {
    return null;
  }
  return {
    id: m.id,
    title: m.title,
    description: typeof m.description === 'string' ? m.description : '',
    targetDate: typeof m.targetDate === 'string' ? m.targetDate : '',
    status: m.status === 'completed' ? 'completed' : 'pending',
    createdAt: m.createdAt || new Date().toISOString(),
  };
}

function normalizeGoal(goal) {
  if (!goal || typeof goal !== 'object' || typeof goal.title !== 'string') {
    return null;
  }
  const milestones = Array.isArray(goal.milestones)
    ? goal.milestones.map(normalizeMilestone).filter(Boolean)
    : [];
  return {
    ...goal,
    id: goal.id || crypto.randomUUID(),
    milestones,
  };
}

function normalizeActiveTimer(timer, validTaskIds) {
  if (!timer || typeof timer !== 'object' || typeof timer.taskId !== 'string') {
    return null;
  }
  if (!validTaskIds.has(timer.taskId)) {
    return null;
  }
  return {
    taskId: timer.taskId,
    startedAt: typeof timer.startedAt === 'string' ? timer.startedAt : null,
    sessionStartedAt: typeof timer.sessionStartedAt === 'string' ? timer.sessionStartedAt : timer.startedAt || null,
    status: timer.status === 'paused' ? 'paused' : 'running',
    pausedAt: typeof timer.pausedAt === 'string' ? timer.pausedAt : null,
    elapsedBeforePauseSeconds: typeof timer.elapsedBeforePauseSeconds === 'number' && timer.elapsedBeforePauseSeconds >= 0
      ? timer.elapsedBeforePauseSeconds
      : 0,
  };
}

/**
 * Migrate a parsed state object from v1 or v2 to current version idempotently.
 * Migration chain: v1 → v2 → v3
 */
export function migrateState(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  if (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== SCHEMA_VERSION) {
    return null;
  }

  const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const tasks = rawTasks.map(normalizeTask).filter(Boolean);
  const validTaskIds = new Set(tasks.map((t) => t.id));

  // Remove dangling dependency references
  const cleanedTasks = tasks.map((t) => ({
    ...t,
    dependencies: t.dependencies.filter((depId) => validTaskIds.has(depId)),
  }));

  const goal = normalizeGoal(parsed.goal);
  const onboardingComplete = typeof parsed.onboardingComplete === 'boolean'
    ? parsed.onboardingComplete
    : Boolean(goal);

  const activeTimer = normalizeActiveTimer(parsed.activeTimer, validTaskIds);

  // v3: recovery history
  const recoveryHistory = Array.isArray(parsed.recoveryHistory)
    ? parsed.recoveryHistory.filter((r) => r && typeof r === 'object' && r.id)
    : [];

  return {
    version: SCHEMA_VERSION,
    goal,
    tasks: cleanedTasks,
    onboardingComplete,
    activeTimer,
    recoveryHistory,
  };
}

// Keep backward-compatible alias for existing tests
export const migrateStateToV2 = migrateState;

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultState();
    const parsed = JSON.parse(raw);
    const migrated = migrateState(parsed);
    if (!migrated) {
      return getDefaultState();
    }
    // Persist migrated state if it was an older version
    if (parsed.version !== SCHEMA_VERSION) {
      saveState(migrated);
    }
    return migrated;
  } catch {
    return getDefaultState();
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...state, version: SCHEMA_VERSION })
    );
  } catch (e) {
    console.error('Failed to save state:', e);
  }
}

export function clearState() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem('focusflow_demo_mode');
}
