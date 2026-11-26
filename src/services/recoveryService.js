import { loadState, saveState } from './storageService.js';
import { getTodayStr, daysUntil, addDaysLocal, formatDisplayDate } from '../utils/dateUtils.js';
import { calculateDailyCapacity, distributeTasks } from './planningService.js';
import { isTaskBlocked } from '../utils/schedulingUtils.js';

/**
 * Recovery approach strategies.
 */
export const RECOVERY_APPROACHES = [
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Distribute work realistically across remaining days while respecting priorities.',
  },
  {
    id: 'deadline',
    label: 'Deadline-focused',
    description: 'Prioritize urgent deadlines and compress schedule to finish on time.',
  },
  {
    id: 'priority',
    label: 'Priority-focused',
    description: 'Prioritize high-priority tasks; lower-priority items may be deferred if capacity is tight.',
  },
  {
    id: 'light',
    label: 'Light workload',
    description: 'Reduce daily workload today and spread tasks where possible.',
  },
];

/**
 * Quick-select explanation chips for the user.
 */
export const EXPLANATION_CHIPS = [
  'I lost time today.',
  'Some tasks took longer than expected.',
  'I had an unexpected interruption.',
  'I want to prioritize urgent tasks.',
  'I need a lighter schedule.',
];

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateStr(dateStr) {
  if (typeof dateStr !== 'string' || !DATE_REGEX.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function taskSummary(t) {
  return {
    id: t.id,
    title: t.title,
    date: t.date,
    estimatedMinutes: t.estimatedMinutes || 30,
    actualSeconds: t.actualSeconds || 0,
    priority: t.priority,
    status: t.status,
    dependencies: Array.isArray(t.dependencies) ? t.dependencies : [],
    postponementCount: t.postponementCount || 0,
    postponementHistory: Array.isArray(t.postponementHistory) ? t.postponementHistory : [],
    milestoneId: t.milestoneId || null,
  };
}

/**
 * Build a structured recovery context from current state.
 */
export function buildRecoveryContext(goal, tasks, milestones, explanation, approach) {
  const today = getTodayStr();
  const dailyCapacity = calculateDailyCapacity(goal);
  const daysLeft = Math.max(0, daysUntil(goal.deadline));

  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const pendingTasks = tasks.filter((t) => t.status !== 'completed');
  const overdueTasks = pendingTasks.filter((t) => t.date && t.date < today);
  const todayTasks = pendingTasks.filter((t) => t.date === today);
  const futureTasks = pendingTasks.filter((t) => t.date && t.date > today);
  const blockedTasks = pendingTasks.filter((t) => isTaskBlocked(t, tasks));

  const totalPendingMinutes = pendingTasks.reduce((s, t) => s + (t.estimatedMinutes || 30), 0);
  const totalCompletedMinutes = completedTasks.reduce((s, t) => s + (t.estimatedMinutes || 30), 0);
  const remainingCapacity = (daysLeft + 1) * dailyCapacity;

  const now = new Date();
  const hoursLeftInDay = Math.max(0, 23 - now.getHours());
  const goalHoursPerDay = Number(goal.availableHoursPerDay) || 2;
  const estimatedRemainingTodayMinutes = Math.min(
    dailyCapacity,
    Math.round(Math.min(hoursLeftInDay, goalHoursPerDay) * 60)
  );

  return {
    goal: {
      id: goal.id,
      title: goal.title,
      category: goal.category,
      deadline: goal.deadline,
      availableHoursPerDay: goal.availableHoursPerDay,
      skillLevel: goal.skillLevel,
    },
    milestones: (milestones || []).map((m) => ({
      id: m.id,
      title: m.title,
      targetDate: m.targetDate,
      status: m.status,
    })),
    tasks: {
      completed: completedTasks.map(taskSummary),
      pending: pendingTasks.map(taskSummary),
      overdue: overdueTasks.map(taskSummary),
      today: todayTasks.map(taskSummary),
      future: futureTasks.map(taskSummary),
      blocked: blockedTasks.map((t) => t.id),
    },
    schedule: {
      today,
      daysLeft,
      dailyCapacityMinutes: dailyCapacity,
      totalPendingMinutes,
      totalCompletedMinutes,
      remainingCapacity,
      estimatedRemainingTodayMinutes,
    },
    userInput: {
      explanation: explanation || '',
      approach: approach || 'balanced',
    },
  };
}

/**
 * Parse and validate the raw JSON structure returned by the AI / server endpoint.
 * Ensures no arbitrary fields or malformed structures enter the app.
 */
export function parseRecoveryResponse(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Recovery response must be a JSON object.');
  }

  if (typeof raw.explanation !== 'string' || !raw.explanation.trim()) {
    throw new Error('Recovery response is missing a valid explanation.');
  }

  if (!Array.isArray(raw.proposedSchedule)) {
    throw new Error('Recovery response is missing proposedSchedule array.');
  }

  for (const item of raw.proposedSchedule) {
    if (!item || typeof item !== 'object') {
      throw new Error('Invalid entry in proposedSchedule.');
    }
    if (typeof item.taskId !== 'string' || !item.taskId) {
      throw new Error('proposedSchedule entry missing valid taskId.');
    }
    if (!isValidDateStr(item.date)) {
      throw new Error(`Invalid date "${item.date}" in proposedSchedule.`);
    }
  }

  const unscheduledTasks = Array.isArray(raw.unscheduledTasks)
    ? raw.unscheduledTasks
        .filter((u) => u && typeof u.taskId === 'string')
        .map((u) => ({
          taskId: u.taskId,
          reason: typeof u.reason === 'string' ? u.reason : 'Insufficient capacity',
        }))
    : [];

  const movedTasks = Array.isArray(raw.movedTasks) ? raw.movedTasks : [];
  const unchangedTaskIds = Array.isArray(raw.unchangedTaskIds) ? raw.unchangedTaskIds : [];
  const dailyWorkload = Array.isArray(raw.dailyWorkload) ? raw.dailyWorkload : [];
  const warnings = Array.isArray(raw.warnings) ? raw.warnings.filter((w) => typeof w === 'string') : [];
  const summary = typeof raw.summary === 'string' ? raw.summary : raw.explanation;

  return {
    provider: typeof raw.provider === 'string' ? raw.provider : 'ai',
    model: typeof raw.model === 'string' ? raw.model : '',
    isDevProvider: Boolean(raw.isDevProvider),
    isFallback: Boolean(raw.isFallback),
    fallbackReason: typeof raw.fallbackReason === 'string' ? raw.fallbackReason : '',
    fallbackMessage: typeof raw.fallbackMessage === 'string' ? raw.fallbackMessage : '',
    approach: typeof raw.approach === 'string' ? raw.approach : 'balanced',
    explanation: raw.explanation.trim(),
    proposedSchedule: raw.proposedSchedule.map((e) => ({ taskId: e.taskId, date: e.date })),
    movedTasks,
    unchangedTaskIds,
    unscheduledTasks,
    dailyWorkload,
    warnings,
    summary,
    feasible: unscheduledTasks.length === 0,
  };
}

let inFlightRecovery = null;

function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().slice(0, 8);
  }
  return `req-${Date.now().toString(36)}`;
}

/**
 * Abort and clear any in-flight recovery request (e.g., on modal close or unmount).
 */
export function cancelInFlightRecoveryRequest() {
  if (inFlightRecovery) {
    inFlightRecovery.controller.abort();
    inFlightRecovery = null;
  }
}

/**
 * Request a recovery plan from the server API with timeout handling.
 * Frontend timeout defaults to 100s (> 90s backend overall deadline).
 * Always releases the in-flight lock in finally across success, errors, timeouts, and aborts.
 */
export async function requestRecoveryPlan(context, { timeoutMs = 100000, requestId: providedRequestId } = {}) {
  if (inFlightRecovery) {
    return inFlightRecovery.promise;
  }

  const requestId = providedRequestId || createRequestId();
  const controller = new AbortController();
  let didTimeout = false;
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  console.info(`[Recovery:${requestId}] Request started`);

  const promise = (async () => {
    try {
const API_BASE = (import.meta.env?.VITE_API_BASE_URL || '').replace(/\/$/, '');

      const response = await fetch(`${API_BASE}/api/recover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': requestId,
        },
        body: JSON.stringify(context),
        signal: controller.signal,
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const msg = payload?.error || `Recovery server returned status ${response.status}.`;
        const err = new Error(msg);
        err.status = response.status;
        err.code = payload?.code || 'SERVER_ERROR';
        err.requestId = requestId;
        throw err;
      }

      console.info(`[Recovery:${requestId}] Frontend response received (provider: ${payload?.provider || 'unknown'})`);
      const parsed = parseRecoveryResponse(payload);
      return { ...parsed, requestId };
    } catch (err) {
      if (err.name === 'AbortError' && didTimeout) {
        const timeoutErr = new Error('Recovery request timed out. Please try again.');
        timeoutErr.code = 'CLIENT_TIMEOUT';
        timeoutErr.requestId = requestId;
        throw timeoutErr;
      }
      if (!err.requestId) {
        err.requestId = requestId;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (inFlightRecovery?.requestId === requestId) {
        inFlightRecovery = null;
      }
    }
  })();

  inFlightRecovery = { promise, controller, requestId };
  return promise;
}

/**
 * Development/test deterministic recovery plan generator.
 * Clearly labelled as dev-deterministic so it is never mistaken for real AI.
 */
export function generateDevRecoveryPlan(context) {
  const { goal, tasks, schedule, userInput } = context;
  const today = schedule.today;
  const approach = userInput?.approach || 'balanced';

  const allPending = tasks.pending.map((t) => ({ ...t, status: 'pending' }));
  const allCompleted = tasks.completed.map((t) => ({ ...t, status: 'completed' }));
  const allTasks = [...allCompleted, ...allPending];

  let adjustedGoal = {
    ...goal,
    deadline: goal.deadline,
    availableHoursPerDay: goal.availableHoursPerDay,
  };
  let tasksToSchedule = [...allTasks];

  if (approach === 'deadline') {
    adjustedGoal.availableHoursPerDay = Math.min(16, (Number(adjustedGoal.availableHoursPerDay) || 2) * 1.3);
  } else if (approach === 'priority') {
    if (schedule.totalPendingMinutes > schedule.remainingCapacity) {
      tasksToSchedule = allTasks.filter((t) => t.status === 'completed' || t.priority !== 'low');
    }
  } else if (approach === 'light') {
    const tomorrow = addDaysLocal(today, 1);
    tasksToSchedule = allTasks.map((t) => {
      if (t.status !== 'completed' && t.date === today && t.priority !== 'high') {
        return { ...t, date: tomorrow };
      }
      return t;
    });
  }

  const startDate = approach === 'light' ? today : today;
  const result = distributeTasks(tasksToSchedule, adjustedGoal, { startDate });

  // Also track any tasks intentionally dropped by priority mode
  const scheduledIds = new Set(result.scheduledPending.map((t) => t.id));
  const droppedInPriority = approach === 'priority'
    ? allPending
        .filter((t) => t.priority === 'low' && !scheduledIds.has(t.id) && !result.unscheduled.some((u) => u.id === t.id))
        .map((t) => ({ ...t, reason: 'Deferred in priority-focused recovery to protect high-priority work.' }))
    : [];

  const allUnscheduled = [...result.unscheduled, ...droppedInPriority];
  const originalDateMap = new Map(allPending.map((t) => [t.id, t.date]));
  const movedTasks = [];
  const unchangedTaskIds = [];

  for (const scheduled of result.scheduledPending) {
    const originalDate = originalDateMap.get(scheduled.id);
    if (originalDate && originalDate !== scheduled.date) {
      movedTasks.push({ taskId: scheduled.id, fromDate: originalDate, toDate: scheduled.date });
    } else {
      unchangedTaskIds.push(scheduled.id);
    }
  }

  const dailyWorkloadMap = new Map();
  for (const t of result.scheduledPending) {
    dailyWorkloadMap.set(t.date, (dailyWorkloadMap.get(t.date) || 0) + (t.estimatedMinutes || 30));
  }
  const dailyWorkload = [...dailyWorkloadMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, totalMinutes]) => ({
      date,
      label: formatDisplayDate(date),
      totalMinutes,
    }));

  const warnings = [];
  if (allUnscheduled.length > 0) {
    warnings.push(`${allUnscheduled.length} task(s) could not fit before ${goal.deadline}.`);
  }
  if (movedTasks.length === 0 && allUnscheduled.length === 0) {
    warnings.push('Your current schedule already fits within capacity.');
  }

  const approachLabel = RECOVERY_APPROACHES.find((a) => a.id === approach)?.label || 'Balanced';

  return {
    provider: 'dev-deterministic',
    isDevProvider: true,
    approach,
    explanation: `${approachLabel} (Dev/Test Deterministic Fallback): Rescheduled ${movedTasks.length} task(s) using ${schedule.dailyCapacityMinutes}m/day capacity.`,
    proposedSchedule: result.scheduledPending.map((t) => ({ taskId: t.id, date: t.date })),
    movedTasks,
    unchangedTaskIds,
    unscheduledTasks: allUnscheduled.map((t) => ({
      taskId: t.id,
      reason: t.reason || 'Insufficient capacity before deadline',
    })),
    dailyWorkload,
    warnings,
    summary: movedTasks.length > 0
      ? `Moved ${movedTasks.length} task(s); ${unchangedTaskIds.length} unchanged; ${allUnscheduled.length} unscheduled.`
      : `No date changes required; ${unchangedTaskIds.length} task(s) kept on current dates.`,
    feasible: allUnscheduled.length === 0,
  };
}

/**
 * Enrich a validated proposal with computed diffs (moved/unchanged/workload before & after)
 * so the UI always displays accurate deterministic comparisons.
 */
export function enrichProposalDiffs(proposal, tasks) {
  const pendingTasks = tasks.filter((t) => t.status !== 'completed');
  const taskMap = new Map(pendingTasks.map((t) => [t.id, t]));
  const proposedMap = new Map(proposal.proposedSchedule.map((e) => [e.taskId, e.date]));
  const unscheduledMap = new Map((proposal.unscheduledTasks || []).map((u) => [u.taskId, u.reason]));

  const movedTasks = [];
  const unchangedTaskIds = [];
  const unscheduledTasks = [];

  for (const task of pendingTasks) {
    const proposedDate = proposedMap.get(task.id);
    if (proposedDate) {
      if (proposedDate !== task.date) {
        movedTasks.push({
          taskId: task.id,
          title: task.title,
          fromDate: task.date,
          toDate: proposedDate,
          priority: task.priority,
          estimatedMinutes: task.estimatedMinutes || 30,
        });
      } else {
        unchangedTaskIds.push(task.id);
      }
    } else {
      unscheduledTasks.push({
        taskId: task.id,
        title: task.title,
        fromDate: task.date,
        reason: unscheduledMap.get(task.id) || 'Could not fit within remaining capacity',
      });
    }
  }

  // Daily workload before & after
  const beforeMap = new Map();
  const afterMap = new Map();
  for (const task of pendingTasks) {
    const mins = task.estimatedMinutes || 30;
    if (task.date) {
      beforeMap.set(task.date, (beforeMap.get(task.date) || 0) + mins);
    }
    const afterDate = proposedMap.get(task.id);
    if (afterDate) {
      afterMap.set(afterDate, (afterMap.get(afterDate) || 0) + mins);
    }
  }

  const allDates = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort();
  const dailyWorkload = allDates.map((date) => ({
    date,
    label: formatDisplayDate(date),
    beforeMinutes: beforeMap.get(date) || 0,
    afterMinutes: afterMap.get(date) || 0,
  }));

  return {
    ...proposal,
    movedTasks,
    unchangedTaskIds,
    unscheduledTasks,
    dailyWorkload,
    feasible: unscheduledTasks.length === 0,
    taskMap,
  };
}

/**
 * Validate a recovery proposal deterministically.
 * Checks: unknown task IDs, duplicate task IDs, completed task preservation,
 * valid dates, deadline, daily capacity, dependencies, and missing tasks.
 */
export function validateRecoveryProposal(proposal, tasks, goal) {
  const issues = [];

  if (!proposal || typeof proposal !== 'object' || !Array.isArray(proposal.proposedSchedule)) {
    return { valid: false, issues: ['Invalid proposal structure.'], repairable: false };
  }

  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const dailyCapacity = calculateDailyCapacity(goal);
  const deadline = goal?.deadline;
  const seenIds = new Set();

  for (const entry of proposal.proposedSchedule) {
    if (!entry || typeof entry.taskId !== 'string' || !isValidDateStr(entry.date)) {
      issues.push('Invalid schedule entry or date format.');
      continue;
    }

    if (seenIds.has(entry.taskId)) {
      issues.push(`Duplicate task ID "${entry.taskId}" in proposed schedule.`);
      continue;
    }
    seenIds.add(entry.taskId);

    const task = taskMap.get(entry.taskId);
    if (!task) {
      issues.push(`Unknown task ID "${entry.taskId}" in proposed schedule.`);
      continue;
    }

    if (task.status === 'completed') {
      issues.push(`Completed task "${task.title}" cannot be moved or modified.`);
    }

    if (deadline && entry.date > deadline) {
      issues.push(`Task "${task.title}" is scheduled after goal deadline (${deadline}).`);
    }
  }

  // Check daily capacity
  const minutesByDay = new Map();
  for (const entry of proposal.proposedSchedule) {
    const task = taskMap.get(entry.taskId);
    if (!task || task.status === 'completed') continue;
    minutesByDay.set(entry.date, (minutesByDay.get(entry.date) || 0) + (task.estimatedMinutes || 30));
  }

  for (const [date, mins] of minutesByDay.entries()) {
    if (mins > dailyCapacity) {
      issues.push(`${date} has ${mins}m planned, exceeding ${dailyCapacity}m daily capacity.`);
    }
  }

  // Check dependency ordering
  const scheduledDateMap = new Map(proposal.proposedSchedule.map((e) => [e.taskId, e.date]));
  for (const entry of proposal.proposedSchedule) {
    const task = taskMap.get(entry.taskId);
    if (!task || task.status === 'completed' || !Array.isArray(task.dependencies)) continue;
    for (const depId of task.dependencies) {
      const prereq = taskMap.get(depId);
      if (prereq && prereq.status !== 'completed') {
        const prereqDate = scheduledDateMap.get(depId);
        if (!prereqDate) {
          issues.push(`Task "${task.title}" is scheduled while prerequisite "${prereq.title}" is unscheduled.`);
        } else if (prereqDate > entry.date) {
          issues.push(`Task "${task.title}" is scheduled before prerequisite "${prereq.title}".`);
        }
      }
    }
  }

  // Check if any pending task was silently omitted (neither scheduled nor in unscheduledTasks)
  const unscheduledSet = new Set((proposal.unscheduledTasks || []).map((u) => u.taskId));
  for (const task of tasks) {
    if (task.status !== 'completed' && !seenIds.has(task.id) && !unscheduledSet.has(task.id)) {
      issues.push(`Pending task "${task.title}" was omitted from the proposal.`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    repairable: issues.length > 0,
  };
}

/**
 * Deterministically repair an invalid proposal so it obeys all constraints:
 * - removes unknown/duplicate/completed task entries
 * - re-runs distributeTasks if capacity, deadline, dependency, or omission issues exist
 */
export function repairRecoveryProposal(proposal, tasks, goal) {
  if (!proposal || !Array.isArray(proposal.proposedSchedule)) {
    return { repaired: false, proposal, adjustments: [] };
  }

  const validation = validateRecoveryProposal(proposal, tasks, goal);
  if (validation.valid) {
    return { repaired: false, proposal, adjustments: [] };
  }

  const today = getTodayStr();
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const proposedDateMap = new Map();

  for (const entry of proposal.proposedSchedule) {
    if (!entry || typeof entry.taskId !== 'string' || !isValidDateStr(entry.date)) continue;
    const task = taskMap.get(entry.taskId);
    if (!task || task.status === 'completed') continue;
    if (!proposedDateMap.has(entry.taskId)) {
      proposedDateMap.set(entry.taskId, entry.date);
    }
  }

  // Seed pending tasks with valid proposed dates, then run deterministic distributeTasks
  const seededTasks = tasks.map((t) => {
    if (t.status === 'completed') return t;
    const proposedDate = proposedDateMap.get(t.id);
    return proposedDate ? { ...t, date: proposedDate } : t;
  });

  const distributed = distributeTasks(seededTasks, goal, { startDate: today });

  const repairedProposal = {
    ...proposal,
    proposedSchedule: distributed.scheduledPending.map((t) => ({ taskId: t.id, date: t.date })),
    unscheduledTasks: distributed.unscheduled.map((t) => ({
      taskId: t.id,
      reason: t.reason || 'Insufficient capacity before deadline',
    })),
    warnings: [
      ...(proposal.warnings || []),
      `Adjusted automatically to resolve ${validation.issues.length} scheduling constraint issue(s).`,
    ],
    feasible: distributed.feasible,
  };

  return {
    repaired: true,
    proposal: repairedProposal,
    adjustments: validation.issues,
  };
}

/**
 * Apply an approved recovery plan to the current state.
 * Preserves completed tasks, IDs, dependencies, milestones, and timer sessions.
 */
export function applyRecoveryPlan(proposal, tasksOverride = null) {
  const state = loadState();
  const currentTasks = tasksOverride || state.tasks;
  const validation = validateRecoveryProposal(proposal, currentTasks, state.goal);
  if (!validation.valid) {
    throw new Error(`Cannot apply invalid recovery plan: ${validation.issues[0]}`);
  }

  const scheduleMap = new Map(proposal.proposedSchedule.map((e) => [e.taskId, e.date]));
  const now = new Date().toISOString();

  state.tasks = state.tasks.map((existing) => {
    if (existing.status === 'completed') {
      return existing;
    }
    const newDate = scheduleMap.get(existing.id);
    if (newDate && newDate !== existing.date) {
      return {
        ...existing,
        date: newDate,
        updatedAt: now,
      };
    }
    return existing;
  });

  saveState(state);
  return state.tasks;
}

/**
 * Save a recovery record (applied or cancelled) to recoveryHistory.
 */
export function saveRecoveryRecord(record) {
  const state = loadState();
  if (!Array.isArray(state.recoveryHistory)) {
    state.recoveryHistory = [];
  }

  const entry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    status: record.status === 'cancelled' ? 'cancelled' : 'applied',
    approach: record.approach || 'balanced',
    userExplanation: record.userExplanation || '',
    explanation: record.explanation || '',
    provider: record.provider || 'deterministic',
    originalDates: Array.isArray(record.originalDates) ? record.originalDates : [],
    proposedDates: Array.isArray(record.proposedDates) ? record.proposedDates : [],
    movedCount: record.movedCount || 0,
    unchangedCount: record.unchangedCount || 0,
    unscheduledCount: record.unscheduledCount || 0,
    summary: record.summary || '',
    warnings: Array.isArray(record.warnings) ? record.warnings : [],
  };

  state.recoveryHistory.push(entry);
  if (state.recoveryHistory.length > 50) {
    state.recoveryHistory = state.recoveryHistory.slice(-50);
  }

  saveState(state);
  return entry;
}

/**
 * Load recovery history (most recent first).
 */
export function getRecoveryHistory() {
  const state = loadState();
  return Array.isArray(state.recoveryHistory) ? [...state.recoveryHistory].reverse() : [];
}

/**
 * Analyze execution patterns to generate insights for recovery.
 */
export function analyzeExecution(goal, tasks) {
  const today = getTodayStr();
  const pending = tasks.filter((t) => t.status !== 'completed');
  const completed = tasks.filter((t) => t.status === 'completed');
  const overdue = pending.filter((t) => t.date && t.date < today);

  const totalPostponements = tasks.reduce((s, t) => s + (t.postponementCount || 0), 0);
  const completionRate = tasks.length > 0 ? Math.round((completed.length / tasks.length) * 100) : 0;

  const totalPendingMinutes = pending.reduce((s, t) => s + (t.estimatedMinutes || 30), 0);
  const dailyCapacity = calculateDailyCapacity(goal);
  const daysLeft = Math.max(0, daysUntil(goal?.deadline));
  const remainingCapacity = (daysLeft + 1) * dailyCapacity;
  const schedulePressure = remainingCapacity > 0
    ? Math.round((totalPendingMinutes / remainingCapacity) * 100)
    : totalPendingMinutes > 0 ? 999 : 0;

  const tasksWithTimer = tasks.filter((t) => (t.actualSeconds || 0) > 0);
  const avgAccuracyRatio = tasksWithTimer.length > 0
    ? tasksWithTimer.reduce((s, t) => {
        const estimated = (t.estimatedMinutes || 30) * 60;
        return s + ((t.actualSeconds || 0) / estimated);
      }, 0) / tasksWithTimer.length
    : null;

  const insights = [];
  if (overdue.length > 0) {
    insights.push({
      type: 'overdue',
      severity: overdue.length >= 3 ? 'high' : 'medium',
      message: `You have ${overdue.length} overdue task(s).`,
    });
  }
  if (schedulePressure > 100) {
    insights.push({
      type: 'pressure',
      severity: schedulePressure > 150 ? 'high' : 'medium',
      message: `Schedule pressure is at ${schedulePressure}% — pending work exceeds remaining capacity.`,
    });
  }
  if (totalPostponements >= 3) {
    insights.push({
      type: 'postponement',
      severity: 'medium',
      message: `${totalPostponements} total postponements recorded.`,
    });
  }
  if (avgAccuracyRatio !== null && avgAccuracyRatio > 1.3) {
    insights.push({
      type: 'estimation',
      severity: 'medium',
      message: `Tasks are taking ${Math.round(avgAccuracyRatio * 100)}% of estimated time on average.`,
    });
  }

  return {
    completionRate,
    overdueCount: overdue.length,
    totalPostponements,
    schedulePressure,
    totalPendingMinutes,
    remainingCapacity,
    avgAccuracyRatio,
    needsRecovery: overdue.length >= 2 || schedulePressure > 110,
    insights,
  };
}
