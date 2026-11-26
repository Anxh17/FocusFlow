import { addDaysLocal, getTaskCompletionLocalDate, getTodayStr, getWeekDatesLocal } from '../utils/dateUtils.js';
import { isTaskBlocked } from '../utils/schedulingUtils.js';

/**
 * Compute comprehensive Stage 2 execution analytics from real tasks and milestones.
 * Never treats estimated time as actual time, and handles 0-task states safely.
 */
export function computeExecutionAnalytics(tasks = [], milestones = [], today = getTodayStr()) {
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const pendingTasks = tasks.filter((t) => t.status !== 'completed');
  const overdueTasks = pendingTasks.filter((t) => t.date && t.date < today);
  const blockedTasks = pendingTasks.filter((t) => isTaskBlocked(t, tasks));

  const completionPercentage = totalTasks > 0
    ? Math.round((completedTasks.length / totalTasks) * 100)
    : 0;

  // Time intelligence (strictly separate estimated vs actual recorded seconds)
  const totalEstimatedMinutes = tasks.reduce((s, t) => s + (t.estimatedMinutes || 0), 0);
  const totalActualSeconds = tasks.reduce((s, t) => s + (t.actualSeconds || 0), 0);
  const totalActualMinutes = Math.round((totalActualSeconds / 60) * 10) / 10;
  const timeDifferenceMinutes = Math.round((totalActualMinutes - totalEstimatedMinutes) * 10) / 10;

  const completedWithActual = completedTasks.filter((t) => (t.actualSeconds || 0) > 0);
  const avgActualMinutesCompleted = completedWithActual.length > 0
    ? Math.round(
        (completedWithActual.reduce((s, t) => s + t.actualSeconds, 0) / completedWithActual.length / 60) * 10
      ) / 10
    : 0;
  const tasksWithoutActualCount = tasks.filter((t) => !t.actualSeconds || t.actualSeconds <= 0).length;

  // Execution consistency: Monday-to-Sunday weekly overview using local calendar dates
  const completionByDate = new Map();
  const activeDaySet = new Set();

  for (const t of completedTasks) {
    const completedDay = getTaskCompletionLocalDate(t);
    if (completedDay) {
      activeDaySet.add(completedDay);
      completionByDate.set(completedDay, (completionByDate.get(completedDay) || 0) + 1);
    }
  }

  const weekDates = getWeekDatesLocal(today);
  const sevenDayOverview = weekDates.map((dayStr) => {
    const label = new Date(dayStr + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const plannedOnDay = tasks.filter((t) => t.date === dayStr).length;
    const completedOnDay = completionByDate.get(dayStr) || 0;
    return {
      date: dayStr,
      day: label,
      Planned: plannedOnDay,
      Completed: completedOnDay,
    };
  });

  // 30-day productivity trend ending today using local calendar dates
  const thirtyDayTrend = [];
  for (let offset = -29; offset <= 0; offset++) {
    const dayStr = addDaysLocal(today, offset);
    const label = new Date(dayStr + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    thirtyDayTrend.push({
      date: dayStr,
      day: label,
      Planned: tasks.filter((t) => t.date === dayStr).length,
      Completed: completionByDate.get(dayStr) || 0,
    });
  }

  // Postponement analysis
  const totalPostponements = tasks.reduce((s, t) => s + (t.postponementCount || 0), 0);
  const postponedTasks = tasks.filter((t) => (t.postponementCount || 0) > 0);
  const repeatedlyPostponed = tasks.filter((t) => (t.postponementCount || 0) >= 2);
  const postponementsByPriority = {
    high: tasks.filter((t) => t.priority === 'high').reduce((s, t) => s + (t.postponementCount || 0), 0),
    medium: tasks.filter((t) => t.priority === 'medium').reduce((s, t) => s + (t.postponementCount || 0), 0),
    low: tasks.filter((t) => t.priority === 'low').reduce((s, t) => s + (t.postponementCount || 0), 0),
  };

  // Milestone progress
  const totalMilestones = milestones.length;
  const completedMilestones = milestones.filter((m) => m.status === 'completed').length;
  const remainingMilestones = totalMilestones - completedMilestones;
  const milestoneCompletionPct = totalMilestones > 0
    ? Math.round((completedMilestones / totalMilestones) * 100)
    : 0;

  return {
    completion: {
      totalTasks,
      completedCount: completedTasks.length,
      remainingCount: pendingTasks.length,
      overdueCount: overdueTasks.length,
      blockedCount: blockedTasks.length,
      completionPercentage,
    },
    time: {
      totalEstimatedMinutes,
      totalActualSeconds,
      totalActualMinutes,
      timeDifferenceMinutes,
      avgActualMinutesCompleted,
      trackedTaskCount: tasks.length - tasksWithoutActualCount,
      tasksWithoutActualCount,
    },
    consistency: {
      activeDaysCount: activeDaySet.size,
      sevenDayOverview,
      thirtyDayTrend,
    },
    postponements: {
      totalPostponements,
      postponedTaskCount: postponedTasks.length,
      repeatedlyPostponedCount: repeatedlyPostponed.length,
      byPriority: postponementsByPriority,
    },
    milestones: {
      totalMilestones,
      completedMilestones,
      remainingMilestones,
      milestoneCompletionPct,
    },
  };
}
