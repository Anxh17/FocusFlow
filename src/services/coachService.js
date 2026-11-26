import { computeExecutionAnalytics } from './analyticsService.js';
import { calculateDailyCapacity, getNextRecommendedTask } from './planningService.js';
import { isTaskBlocked } from '../utils/schedulingUtils.js';
import {
  daysUntil,
  formatDuration,
  formatSecondsCompact,
  getTaskCompletionLocalDate,
  getTodayStr,
  getWeekDatesLocal,
  toLocalDateStr,
} from '../utils/dateUtils.js';

/**
 * Compute comprehensive Stage 4 productivity intelligence from real tasks, goal, and milestones.
 * Never fabricates metrics when historical data is unavailable.
 */
export function computeProductivityIntelligence(goal, tasks = [], milestones = [], today = getTodayStr()) {
  const analytics = computeExecutionAnalytics(tasks, milestones, today);
  const dailyCapacityMinutes = calculateDailyCapacity(goal);

  const pendingTasks = tasks.filter((t) => t.status !== 'completed');
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const todayPending = pendingTasks.filter((t) => t.date === today);
  const overdueTasks = pendingTasks.filter((t) => t.date && t.date < today);
  const incompleteHighPriority = pendingTasks.filter((t) => t.priority === 'high');
  const largeTasks = pendingTasks.filter((t) => (t.estimatedMinutes || 30) >= 75);

  const todayPlannedMinutes = todayPending.reduce((s, t) => s + (t.estimatedMinutes || 30), 0);
  const workloadUtilizationPct = dailyCapacityMinutes > 0
    ? Math.round((todayPlannedMinutes / dailyCapacityMinutes) * 100)
    : 0;
  const isOverloadedToday = todayPlannedMinutes > dailyCapacityMinutes;

  // Planned vs actual duration ratio (only when actual timer data exists)
  const trackedTasks = tasks.filter((t) => (t.actualSeconds || 0) > 0);
  const trackedEstimatedMinutes = trackedTasks.reduce((s, t) => s + (t.estimatedMinutes || 30), 0);
  const trackedActualMinutes = trackedTasks.reduce((s, t) => s + (t.actualSeconds || 0) / 60, 0);
  const durationAccuracyRatio = trackedEstimatedMinutes > 0
    ? Math.round((trackedActualMinutes / trackedEstimatedMinutes) * 100) / 100
    : null;

  // Focus sessions count
  const totalFocusSessions = tasks.reduce(
    (s, t) => s + (Array.isArray(t.timeSessions) ? t.timeSessions.length : 0),
    0
  );

  // Upcoming deadline warnings (goal or pending milestones within 5 days)
  const deadlineWarnings = [];
  if (goal?.deadline) {
    const goalDaysLeft = daysUntil(goal.deadline);
    if (goalDaysLeft < 0) {
      deadlineWarnings.push({
        type: 'goal_overdue',
        title: goal.title,
        daysLeft: goalDaysLeft,
        message: `Your goal deadline (${goal.deadline}) has passed with ${pendingTasks.length} pending task(s).`,
      });
    } else if (goalDaysLeft <= 5 && pendingTasks.length > 0) {
      deadlineWarnings.push({
        type: 'goal_soon',
        title: goal.title,
        daysLeft: goalDaysLeft,
        message: `Goal deadline is in ${goalDaysLeft} day(s) with ${pendingTasks.length} pending task(s).`,
      });
    }
  }

  for (const m of milestones || []) {
    if (m.status === 'completed' || !m.targetDate) continue;
    const mDays = daysUntil(m.targetDate);
    if (mDays <= 5) {
      deadlineWarnings.push({
        type: mDays < 0 ? 'milestone_overdue' : 'milestone_soon',
        title: m.title,
        daysLeft: mDays,
        message: mDays < 0
          ? `Milestone "${m.title}" target date (${m.targetDate}) has passed.`
          : `Milestone "${m.title}" is due in ${mDays} day(s).`,
      });
    }
  }

  // Procrastination / Friction detection (supportive, evidence-based)
  const repeatedlyPostponedTasks = pendingTasks
    .filter((t) => (t.postponementCount || 0) >= 2)
    .sort((a, b) => (b.postponementCount || 0) - (a.postponementCount || 0));

  const overrunningTasks = trackedTasks.filter(
    (t) => (t.actualSeconds || 0) > (t.estimatedMinutes || 30) * 60 * 1.25
  );

  const stalledHighPriority = incompleteHighPriority.filter(
    (t) => (t.date && t.date < today) || (t.postponementCount || 0) >= 1
  );

  const frictionIndicators = [];
  if (repeatedlyPostponedTasks.length > 0) {
    frictionIndicators.push({
      id: 'repeated_postponements',
      title: `${repeatedlyPostponedTasks.length} task(s) moved multiple times`,
      detail: `"${repeatedlyPostponedTasks[0].title}" has been postponed ${repeatedlyPostponedTasks[0].postponementCount} times. Breaking it into a smaller first step can make starting easier.`,
    });
  }
  if (overrunningTasks.length > 0) {
    frictionIndicators.push({
      id: 'duration_overruns',
      title: `${overrunningTasks.length} task(s) took longer than estimated`,
      detail: 'Some tasks are taking over 25% longer than planned. Adding buffer time helps keep daily plans realistic.',
    });
  }
  if (stalledHighPriority.length > 0) {
    frictionIndicators.push({
      id: 'stalled_high_priority',
      title: `${stalledHighPriority.length} high-priority task(s) need attention`,
      detail: 'Starting your day with one high-priority task before checking lower-priority items can build momentum.',
    });
  }

  const intelligence = {
    analytics,
    workload: {
      dailyCapacityMinutes,
      todayPlannedMinutes,
      todayPendingCount: todayPending.length,
      workloadUtilizationPct,
      isOverloadedToday,
      overdueCount: overdueTasks.length,
      blockedCount: analytics.completion.blockedCount,
      incompleteHighPriorityCount: incompleteHighPriority.length,
      largeTaskCount: largeTasks.length,
    },
    focus: {
      totalActualSeconds: analytics.time.totalActualSeconds,
      totalActualMinutes: analytics.time.totalActualMinutes,
      totalEstimatedMinutes: analytics.time.totalEstimatedMinutes,
      trackedTaskCount: trackedTasks.length,
      totalFocusSessions,
      durationAccuracyRatio,
      hasActualData: trackedTasks.length > 0,
    },
    procrastination: {
      repeatedlyPostponedTasks,
      overrunningTasks,
      stalledHighPriority,
      frictionIndicators,
      hasFriction: frictionIndicators.length > 0,
    },
    deadlineWarnings,
    hasEnoughHistory: tasks.length > 0 && (completedTasks.length > 0 || trackedTasks.length > 0),
  };

  intelligence.recommendations = generateRecommendations(intelligence, goal, tasks, today);
  return intelligence;
}

/**
 * Generate actionable, transparent recommendations with explicit WHY reasoning.
 */
export function generateRecommendations(intelligence, goal, tasks = [], today = getTodayStr()) {
  const recs = [];
  const { workload, focus, procrastination, deadlineWarnings, analytics } = intelligence;
  const pending = tasks.filter((t) => t.status !== 'completed');
  const nextTask = getNextRecommendedTask(tasks, today);

  if (workload.overdueCount >= 2 || workload.isOverloadedToday) {
    const reasons = [];
    if (workload.overdueCount >= 2) reasons.push(`${workload.overdueCount} overdue task(s)`);
    if (workload.isOverloadedToday) {
      reasons.push(
        `${formatDuration(workload.todayPlannedMinutes)} planned today vs ${formatDuration(workload.dailyCapacityMinutes)} daily capacity`
      );
    }
    recs.push({
      id: 'recover-schedule',
      priority: 'high',
      title: workload.isOverloadedToday
        ? "Reduce today's workload with Schedule Recovery"
        : 'Recover your overdue schedule',
      why: `Recommended because you currently have ${reasons.join(' and ')}. Rebalancing prevents burnout and keeps your plan realistic.`,
      actionLabel: 'Recover My Day',
      actionType: 'recover',
    });
  }

  if (procrastination.repeatedlyPostponedTasks.length > 0) {
    const target = procrastination.repeatedlyPostponedTasks[0];
    recs.push({
      id: 'postponed-task',
      priority: 'high',
      title: `Split or simplify "${target.title}"`,
      why: `This task has been postponed ${target.postponementCount} times. Tasks moved repeatedly are often too broad or scheduled at low-energy times.`,
      actionLabel: 'Review Tasks',
      actionType: 'tasks',
    });
  }

  if (workload.largeTaskCount > 0) {
    const large = pending.find((t) => (t.estimatedMinutes || 30) >= 75);
    if (large) {
      recs.push({
        id: 'break-large-task',
        priority: 'medium',
        title: `Break "${large.title}" (${formatDuration(large.estimatedMinutes)}) into 30–45m blocks`,
        why: `Tasks longer than 75 minutes are harder to finish in one sitting and more likely to spill into tomorrow.`,
        actionLabel: 'Edit in Tasks',
        actionType: 'tasks',
      });
    }
  }

  if (deadlineWarnings.length > 0) {
    recs.push({
      id: 'approaching-deadline',
      priority: 'high',
      title: 'Prioritize approaching deadline items',
      why: deadlineWarnings[0].message,
      actionLabel: 'View Priority Tasks',
      actionType: 'tasks',
    });
  }

  if (!focus.hasActualData && pending.length > 0) {
    recs.push({
      id: 'start-timer',
      priority: 'medium',
      title: 'Track at least one focus session with the task timer',
      why: 'No actual focus time has been recorded yet. Tracking even 1–2 tasks lets FocusFlow calibrate your real pace vs estimates.',
      actionLabel: 'Open Tasks',
      actionType: 'tasks',
    });
  } else if (focus.durationAccuracyRatio !== null && focus.durationAccuracyRatio > 1.25) {
    recs.push({
      id: 'calibrate-estimates',
      priority: 'medium',
      title: 'Increase time estimates by ~25% for upcoming tasks',
      why: `Your tracked tasks took ${Math.round(focus.durationAccuracyRatio * 100)}% of their estimated duration on average. Realistic estimates reduce rollover stress.`,
      actionLabel: 'Adjust Estimates',
      actionType: 'tasks',
    });
  }

  if (nextTask && recs.length < 4) {
    recs.push({
      id: 'next-focus',
      priority: 'low',
      title: `Focus next on "${nextTask.task.title}"`,
      why: nextTask.reason,
      actionLabel: 'Go to Tasks',
      actionType: 'tasks',
    });
  }

  if (recs.length === 0 && analytics.completion.totalTasks > 0 && pending.length === 0) {
    recs.push({
      id: 'all-complete',
      priority: 'low',
      title: 'All scheduled tasks are complete',
      why: `You have completed ${analytics.completion.completedCount} of ${analytics.completion.totalTasks} tasks for "${goal?.title || 'your goal'}".`,
      actionLabel: 'Add Next Tasks',
      actionType: 'tasks',
    });
  }

  return recs;
}

/**
 * Compute a real Monday-to-Sunday weekly productivity report using local calendar dates.
 * Only reports "bestProductivityDay" when >= 2 days have completed tasks.
 */
export function generateWeeklyReport(goal, tasks = [], milestones = [], today = getTodayStr()) {
  const weekDates = getWeekDatesLocal(today);
  const startDate = weekDates[0];
  const endDate = weekDates[6];
  const inWindow = (dateStr) => Boolean(dateStr && dateStr >= startDate && dateStr <= endDate);

  const completedInWeek = tasks.filter((t) => {
    if (t.status !== 'completed') return false;
    const completedDay = getTaskCompletionLocalDate(t);
    return inWindow(completedDay);
  });

  const plannedInWeek = tasks.filter((t) => inWindow(t.date));
  const completionRate = plannedInWeek.length > 0
    ? Math.round((completedInWeek.length / plannedInWeek.length) * 100)
    : null;

  const plannedMinutes = plannedInWeek.reduce((s, t) => s + (t.estimatedMinutes || 30), 0);

  // Sum actual focus seconds in the Monday-to-Sunday window using local calendar dates
  let focusTimeSeconds = 0;
  for (const t of tasks) {
    if (Array.isArray(t.timeSessions) && t.timeSessions.length > 0) {
      for (const sess of t.timeSessions) {
        const sessDay = toLocalDateStr(sess.endedAt || sess.startedAt || t.date);
        if (inWindow(sessDay)) {
          focusTimeSeconds += sess.durationSeconds || 0;
        }
      }
    } else if ((t.actualSeconds || 0) > 0) {
      const day = getTaskCompletionLocalDate(t);
      if (inWindow(day)) {
        focusTimeSeconds += t.actualSeconds;
      }
    }
  }
  const actualMinutes = Math.round((focusTimeSeconds / 60) * 10) / 10;

  // Postponements in week
  let postponementsInWeek = 0;
  for (const t of tasks) {
    if (Array.isArray(t.postponementHistory) && t.postponementHistory.length > 0) {
      const count = t.postponementHistory.filter((h) => inWindow(toLocalDateStr(h.postponedAt))).length;
      postponementsInWeek += count;
    } else if ((t.postponementCount || 0) > 0 && inWindow(toLocalDateStr(t.updatedAt))) {
      postponementsInWeek += t.postponementCount;
    }
  }

  // Daily breakdown (Monday -> Sunday) for chart & best day calculation
  const completedByDay = new Map();
  const focusByDay = new Map();
  for (const t of completedInWeek) {
    const d = getTaskCompletionLocalDate(t);
    if (d) {
      completedByDay.set(d, (completedByDay.get(d) || 0) + 1);
    }
  }
  for (const t of tasks) {
    if ((t.actualSeconds || 0) > 0) {
      const d = getTaskCompletionLocalDate(t);
      if (inWindow(d)) {
        focusByDay.set(d, (focusByDay.get(d) || 0) + Math.round(t.actualSeconds / 60));
      }
    }
  }

  const dailyTrend = weekDates.map((dateStr) => {
    const weekday = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'short',
    });
    return {
      date: dateStr,
      day: weekday,
      Planned: tasks.filter((t) => t.date === dateStr).length,
      Completed: completedByDay.get(dateStr) || 0,
      FocusMinutes: focusByDay.get(dateStr) || 0,
    };
  });

  // Only identify best productivity day when >= 2 days have completed tasks
  const activeDaysWithCompletions = dailyTrend.filter((d) => d.Completed > 0);
  let bestProductivityDay = null;
  if (activeDaysWithCompletions.length >= 2) {
    const best = [...activeDaysWithCompletions].sort((a, b) => b.Completed - a.Completed)[0];
    bestProductivityDay = {
      date: best.date,
      day: best.day,
      completedCount: best.Completed,
    };
  }

  const intel = computeProductivityIntelligence(goal, tasks, milestones, today);
  let mainObstacle = 'No major obstacles detected — keep a steady daily pace.';
  if (intel.workload.overdueCount >= 2) {
    mainObstacle = `${intel.workload.overdueCount} overdue task(s) creating backlog pressure.`;
  } else if (postponementsInWeek >= 3) {
    mainObstacle = `${postponementsInWeek} task postponement(s) this week disrupting daily flow.`;
  } else if (intel.focus.durationAccuracyRatio !== null && intel.focus.durationAccuracyRatio > 1.25) {
    mainObstacle = 'Tasks are taking longer than estimated, squeezing remaining daily capacity.';
  } else if (intel.workload.isOverloadedToday) {
    mainObstacle = "Today's planned work exceeds your daily available hours.";
  }

  const threeImprovements = [];
  if (intel.workload.overdueCount > 0 || intel.workload.isOverloadedToday) {
    threeImprovements.push('Use Recover My Day to rebalance overdue or overloaded tasks into realistic daily slots.');
  } else {
    threeImprovements.push('Protect your daily capacity cap by keeping new tasks within available hours.');
  }

  if (intel.procrastination.repeatedlyPostponedTasks.length > 0 || intel.workload.largeTaskCount > 0) {
    threeImprovements.push('Split large or repeatedly postponed tasks into focused 30–45 minute steps.');
  } else {
    threeImprovements.push('Start each day with one unblocked high-priority task before lower-priority work.');
  }

  if (!intel.focus.hasActualData) {
    threeImprovements.push('Run the built-in task timer on key sessions to compare planned vs actual duration.');
  } else if (intel.focus.durationAccuracyRatio > 1.25) {
    threeImprovements.push('Add a 25% time buffer to complex tasks based on your recent timer history.');
  } else {
    threeImprovements.push('Keep logging focus sessions to maintain accurate pacing toward your goal deadline.');
  }

  return {
    windowStart: startDate,
    windowEnd: endDate,
    tasksCompleted: completedInWeek.length,
    tasksPlanned: plannedInWeek.length,
    completionRate,
    focusTimeSeconds,
    focusTimeFormatted: formatSecondsCompact(focusTimeSeconds),
    plannedMinutes,
    actualMinutes,
    postponements: postponementsInWeek,
    bestProductivityDay,
    mainObstacle,
    threeImprovements: threeImprovements.slice(0, 3),
    dailyTrend,
  };
}

/**
 * Minimize user data before sending to backend AI chat.
 * Excludes raw session timestamps, full postponement logs, task descriptions, and internal IDs.
 */
export function buildMinimizedChatContext(goal, intelligence, weeklyReport, tasks = [], today = getTodayStr()) {
  const pending = tasks.filter((t) => t.status !== 'completed');
  const topTasks = pending
    .filter((t) => !isTaskBlocked(t, tasks))
    .slice(0, 8)
    .map((t) => ({
      title: t.title,
      date: t.date,
      priority: t.priority,
      estimatedMinutes: t.estimatedMinutes || 30,
      postponementCount: t.postponementCount || 0,
      isOverdue: Boolean(t.date && t.date < today),
    }));

  return {
    today,
    goal: goal
      ? {
          title: goal.title,
          category: goal.category,
          deadline: goal.deadline,
          availableHoursPerDay: goal.availableHoursPerDay,
        }
      : null,
    summary: {
      completionPct: intelligence.analytics.completion.completionPercentage,
      completedCount: intelligence.analytics.completion.completedCount,
      pendingCount: intelligence.analytics.completion.remainingCount,
      overdueCount: intelligence.workload.overdueCount,
      blockedCount: intelligence.workload.blockedCount,
      todayPlannedMinutes: intelligence.workload.todayPlannedMinutes,
      dailyCapacityMinutes: intelligence.workload.dailyCapacityMinutes,
      focusTrackedMinutes: intelligence.focus.totalActualMinutes,
      totalPostponements: intelligence.analytics.postponements.totalPostponements,
      durationAccuracyRatio: intelligence.focus.durationAccuracyRatio,
    },
    weeklyReport: {
      tasksCompleted: weeklyReport.tasksCompleted,
      completionRate: weeklyReport.completionRate,
      focusTimeFormatted: weeklyReport.focusTimeFormatted,
      postponements: weeklyReport.postponements,
      mainObstacle: weeklyReport.mainObstacle,
    },
    topActionableTasks: topTasks,
    recommendations: intelligence.recommendations.slice(0, 4).map((r) => ({
      title: r.title,
      why: r.why,
    })),
  };
}

/**
 * Deterministic Coach response generator using only verified local productivity data.
 */
export function generateDeterministicCoachReply(question, goal, intelligence, weeklyReport, tasks = [], today = getTodayStr()) {
  const q = (question || '').toLowerCase();
  const nextTask = getNextRecommendedTask(tasks, today);
  const { workload, focus, procrastination, analytics } = intelligence;

  if (q.includes('focus') || q.includes('prioritize') || q.includes('today')) {
    if (!nextTask) {
      return 'You have no unblocked pending tasks right now. Check your Tasks page to add new steps or unblock dependent tasks.';
    }
    const loadNote = workload.isOverloadedToday
      ? ` Note that today has ${formatDuration(workload.todayPlannedMinutes)} planned against your ${formatDuration(workload.dailyCapacityMinutes)} daily capacity — consider using Recover My Day if things feel tight.`
      : '';
    return `Focus first on "${nextTask.task.title}" (${formatDuration(nextTask.task.estimatedMinutes)}). ${nextTask.reason}${loadNote}`;
  }

  if (q.includes('behind') || q.includes('obstacle') || q.includes('procrastinat')) {
    const parts = [];
    if (workload.overdueCount > 0) parts.push(`${workload.overdueCount} overdue task(s)`);
    if (procrastination.repeatedlyPostponedTasks.length > 0) {
      parts.push(
        `${procrastination.repeatedlyPostponedTasks.length} task(s) postponed multiple times (e.g. "${procrastination.repeatedlyPostponedTasks[0].title}")`
      );
    }
    if (focus.durationAccuracyRatio !== null && focus.durationAccuracyRatio > 1.25) {
      parts.push(`tasks taking ~${Math.round(focus.durationAccuracyRatio * 100)}% of estimated time`);
    }
    if (parts.length === 0) {
      return `You aren't showing major backlog signals right now (${analytics.completion.completionPercentage}% overall completion). Stay steady with your ${formatDuration(workload.dailyCapacityMinutes)}/day target.`;
    }
    return `The main friction points in your data are ${parts.join(', ')}. Using Recover My Day or splitting large tasks into 30–45 minute blocks can help reset momentum.`;
  }

  if (q.includes('week') || q.includes('report') || q.includes('productive')) {
    const rateText = weeklyReport.completionRate !== null
      ? `${weeklyReport.completionRate}% of tasks planned this week`
      : 'no tasks scheduled in the last 7 days';
    const bestText = weeklyReport.bestProductivityDay
      ? ` Your strongest day was ${weeklyReport.bestProductivityDay.day} (${weeklyReport.bestProductivityDay.completedCount} completed).`
      : '';
    return `Over the last 7 days, you completed ${weeklyReport.tasksCompleted} task(s) (${rateText}), logged ${weeklyReport.focusTimeFormatted} of focus time, and had ${weeklyReport.postponements} postponement(s).${bestText} Main obstacle: ${weeklyReport.mainObstacle}`;
  }

  if (q.includes('improve') || q.includes('schedule')) {
    return `Top improvements based on your data: 1) ${weeklyReport.threeImprovements[0]} 2) ${weeklyReport.threeImprovements[1]} 3) ${weeklyReport.threeImprovements[2]}`;
  }

  const topRec = intelligence.recommendations[0];
  return topRec
    ? `For "${goal?.title || 'your goal'}", you are at ${analytics.completion.completionPercentage}% completion (${workload.overdueCount} overdue). Top suggestion: ${topRec.title} — ${topRec.why}`
    : `You are at ${analytics.completion.completionPercentage}% overall completion with ${analytics.completion.remainingCount} task(s) remaining.`;
}

/**
 * Send a context-aware Coach chat request to /api/coach/chat with minimized data.
 * Falls back cleanly to deterministic coaching if AI is unavailable.
 */
export async function askCoachChat({
  question,
  history = [],
  goal,
  tasks = [],
  milestones = [],
  today = getTodayStr(),
  timeoutMs = 30000,
}) {
  const trimmed = (question || '').trim();
  if (!trimmed) {
    throw new Error('Please enter a question for the Coach.');
  }

  const intelligence = computeProductivityIntelligence(goal, tasks, milestones, today);
  const weeklyReport = generateWeeklyReport(goal, tasks, milestones, today);
  const minimizedContext = buildMinimizedChatContext(goal, intelligence, weeklyReport, tasks, today);

  const sanitizedHistory = history
    .slice(-6)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 500) }));

  const controller = new AbortController();
  let didTimeout = false;
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
const API_BASE = (import.meta.env?.VITE_API_BASE_URL || '').replace(/\/$/, '');

    const response = await fetch(`${API_BASE}/api/coach/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: trimmed,
        history: sanitizedHistory,
        context: minimizedContext,
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const err = new Error(payload?.error || `Coach server returned ${response.status}.`);
      err.status = response.status;
      err.code = payload?.code || 'COACH_ERROR';
      throw err;
    }

    if (!payload || typeof payload.reply !== 'string' || !payload.reply.trim()) {
      throw new Error('Coach returned an empty reply.');
    }

    return {
      reply: payload.reply.trim(),
      provider: typeof payload.provider === 'string' ? payload.provider : 'openrouter',
      model: typeof payload.model === 'string' ? payload.model : '',
      isFallback: Boolean(payload.isFallback),
      fallbackMessage: typeof payload.fallbackMessage === 'string' ? payload.fallbackMessage : '',
    };
  } catch (err) {
    if (err.name === 'AbortError' && didTimeout) {
      const deterministicReply = generateDeterministicCoachReply(
        trimmed,
        goal,
        intelligence,
        weeklyReport,
        tasks,
        today
      );
      return {
        reply: deterministicReply,
        provider: 'deterministic',
        model: 'built-in',
        isFallback: true,
        fallbackMessage: 'AI Coach timed out. Showing a deterministic response from your local data.',
      };
    }

    // For invalid key/model config errors, surface the error clearly; for transient/network errors, provide deterministic fallback
    if (err.code === 'AI_INVALID_KEY' || err.code === 'AI_INVALID_MODEL' || err.code === 'INVALID_REQUEST') {
      throw err;
    }

    const deterministicReply = generateDeterministicCoachReply(
      trimmed,
      goal,
      intelligence,
      weeklyReport,
      tasks,
      today
    );
    return {
      reply: deterministicReply,
      provider: 'deterministic',
      model: 'built-in',
      isFallback: true,
      fallbackMessage:
        err.code === 'AI_NOT_CONFIGURED'
          ? 'Server AI key not configured. Showing deterministic guidance from your local data.'
          : 'AI is temporarily unavailable. Showing deterministic guidance from your local data.',
    };
  } finally {
    clearTimeout(timer);
  }
}
