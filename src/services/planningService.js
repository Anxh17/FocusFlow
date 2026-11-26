import { addDaysLocal, daysUntil, getTodayStr } from '../utils/dateUtils.js';
import { isTaskBlocked, sortTasksForScheduling } from '../utils/schedulingUtils.js';
import { generateMilestones } from './milestoneService.js';
import { loadState, saveState } from './storageService.js';
import {
  buildRecoveryContext,
  requestRecoveryPlan,
  analyzeExecution as analyzeExecutionImpl,
} from './recoveryService.js';

export { generateMilestones };

const CATEGORY_TOPICS = {
  placements: [
    { title: 'Review Data Structures fundamentals', priority: 'high', minutes: 60 },
    { title: 'Practice Array & String problems', priority: 'high', minutes: 45, dependsOnPrev: true },
    { title: 'Study Sorting and Searching algorithms', priority: 'high', minutes: 60 },
    { title: 'Practice Linked List problems', priority: 'medium', minutes: 45 },
    { title: 'Review Tree and Graph concepts', priority: 'high', minutes: 60 },
    { title: 'Solve Dynamic Programming basics', priority: 'medium', minutes: 60 },
    { title: 'Practice SQL queries', priority: 'medium', minutes: 30 },
    { title: 'Review OS fundamentals', priority: 'medium', minutes: 45 },
    { title: 'Study Networking basics', priority: 'low', minutes: 30 },
    { title: 'Mock interview practice', priority: 'high', minutes: 60 },
  ],
  competitive_exam: [
    { title: 'Review core subject fundamentals', priority: 'high', minutes: 60 },
    { title: 'Practice previous year questions', priority: 'high', minutes: 45, dependsOnPrev: true },
    { title: 'Timed mock test session', priority: 'high', minutes: 90 },
    { title: 'Analyze mock test results', priority: 'medium', minutes: 30, dependsOnPrev: true },
    { title: 'Revise formula sheet', priority: 'medium', minutes: 30 },
    { title: 'Weak area focused practice', priority: 'high', minutes: 60 },
    { title: 'Speed building exercises', priority: 'medium', minutes: 45 },
    { title: 'Concept revision notes', priority: 'low', minutes: 30 },
  ],
  technical_interview: [
    { title: 'Solve 2 LeetCode Medium problems', priority: 'high', minutes: 60 },
    { title: 'Review System Design basics', priority: 'high', minutes: 45 },
    { title: 'Practice behavioral questions (STAR method)', priority: 'medium', minutes: 30 },
    { title: 'Study API design principles', priority: 'medium', minutes: 45 },
    { title: 'Review Database concepts', priority: 'medium', minutes: 30 },
    { title: 'Practice whiteboard coding', priority: 'high', minutes: 45 },
    { title: 'Study concurrency concepts', priority: 'medium', minutes: 45 },
    { title: 'Mock technical interview', priority: 'high', minutes: 60 },
  ],
  learning: [
    { title: 'Read chapter / module content', priority: 'high', minutes: 45 },
    { title: 'Take notes and summarize key concepts', priority: 'medium', minutes: 30, dependsOnPrev: true },
    { title: 'Practice exercises / coding challenges', priority: 'high', minutes: 60 },
    { title: 'Build a small project or prototype', priority: 'medium', minutes: 60 },
    { title: 'Review and revise previous material', priority: 'medium', minutes: 30 },
    { title: 'Watch tutorial / lecture video', priority: 'low', minutes: 45 },
    { title: 'Write documentation or blog post', priority: 'low', minutes: 30 },
  ],
  other: [
    { title: "Plan and organize today's priorities", priority: 'high', minutes: 15 },
    { title: 'Deep work session - primary task', priority: 'high', minutes: 60 },
    { title: 'Review progress and adjust plan', priority: 'medium', minutes: 20 },
    { title: 'Skill practice session', priority: 'medium', minutes: 45 },
    { title: 'Research and reading', priority: 'low', minutes: 30 },
    { title: 'Reflect and journal learnings', priority: 'low', minutes: 15 },
  ],
};

function getCategoryKey(category) {
  if (!category) return 'other';
  const normalized = category.toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized.includes('placement')) return 'placements';
  if (normalized.includes('competitive') || normalized.includes('exam')) return 'competitive_exam';
  if (normalized.includes('technical') || normalized.includes('interview')) return 'technical_interview';
  if (normalized.includes('learn')) return 'learning';
  return 'other';
}

/**
 * Calculate daily available capacity in minutes for a goal.
 */
export function calculateDailyCapacity(goal, _date) {
  const hours = Number(goal?.availableHoursPerDay) || 2;
  return Math.max(15, Math.round(hours * 60));
}

/**
 * Distribute tasks deterministically across days from today until goal.deadline.
 * Preserves completed tasks and respects capacity, priority, and dependencies.
 */
export function distributeTasks(tasks, goal, { startDate = getTodayStr() } = {}) {
  const deadline = goal?.deadline || addDaysLocal(startDate, 7);
  const totalWindowDays = Math.max(1, daysUntil(deadline) + 1);
  const dailyCapacity = calculateDailyCapacity(goal);

  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const pendingTasks = tasks.filter((t) => t.status !== 'completed');

  // Track minutes already committed on each day (including completed tasks on >= startDate)
  const dayUsedMinutes = new Map();
  for (const ct of completedTasks) {
    if (ct.date >= startDate) {
      dayUsedMinutes.set(ct.date, (dayUsedMinutes.get(ct.date) || 0) + (ct.estimatedMinutes || 30));
    }
  }

  const orderedPending = sortTasksForScheduling(pendingTasks);
  const scheduledDateById = new Map();
  for (const ct of completedTasks) {
    scheduledDateById.set(ct.id, ct.date);
  }

  const scheduledPending = [];
  const unscheduled = [];

  for (const task of orderedPending) {
    const duration = Math.max(5, task.estimatedMinutes || 30);

    // Must not be scheduled earlier than any prerequisite's scheduled date
    let earliestDayOffset = 0;
    if (Array.isArray(task.dependencies)) {
      for (const depId of task.dependencies) {
        const depDate = scheduledDateById.get(depId);
        if (depDate && depDate >= startDate) {
          const diff = Math.round(
            (new Date(depDate + 'T00:00:00') - new Date(startDate + 'T00:00:00')) / (1000 * 60 * 60 * 24)
          );
          if (diff > earliestDayOffset) {
            earliestDayOffset = diff;
          }
        }
      }
    }

    let placedDate = null;
    for (let offset = earliestDayOffset; offset < totalWindowDays; offset++) {
      const candidateDate = addDaysLocal(startDate, offset);
      if (candidateDate > deadline) break;

      const used = dayUsedMinutes.get(candidateDate) || 0;
      if (used + duration <= dailyCapacity) {
        dayUsedMinutes.set(candidateDate, used + duration);
        placedDate = candidateDate;
        break;
      }
    }

    if (placedDate) {
      scheduledDateById.set(task.id, placedDate);
      scheduledPending.push({ ...task, date: placedDate });
    } else {
      unscheduled.push({
        ...task,
        reason: duration > dailyCapacity
          ? `Task duration (${duration}m) exceeds daily capacity (${dailyCapacity}m).`
          : `Insufficient remaining capacity before ${deadline}.`,
      });
    }
  }

  const totalPendingMinutes = pendingTasks.reduce((s, t) => s + (t.estimatedMinutes || 30), 0);
  const totalAvailableCapacity = totalWindowDays * dailyCapacity;
  const unscheduledMinutes = unscheduled.reduce((s, t) => s + (t.estimatedMinutes || 30), 0);
  const shortfallMinutes = Math.max(0, unscheduledMinutes);

  return {
    scheduledTasks: [...completedTasks, ...scheduledPending],
    scheduledPending,
    preservedCompleted: completedTasks,
    unscheduled,
    feasible: unscheduled.length === 0,
    shortfallMinutes,
    totalPendingMinutes,
    totalAvailableCapacity,
    dailyCapacity,
    explanation: unscheduled.length === 0
      ? 'All pending tasks fit within your daily capacity before the deadline.'
      : `${unscheduled.length} task(s) (${unscheduledMinutes}m) could not fit before ${deadline} at ${dailyCapacity}m/day capacity.`,
  };
}

/**
 * Validate an existing schedule against goal capacity, deadline, and dependencies.
 */
export function validateSchedule(tasks, goal) {
  const dailyCapacity = calculateDailyCapacity(goal);
  const deadline = goal?.deadline;
  const issues = [];
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const minutesByDay = new Map();

  for (const t of tasks) {
    if (t.status === 'completed') continue;
    const mins = t.estimatedMinutes || 30;
    minutesByDay.set(t.date, (minutesByDay.get(t.date) || 0) + mins);

    if (deadline && t.date > deadline) {
      issues.push({
        type: 'after_deadline',
        taskId: t.id,
        message: `"${t.title}" is scheduled after the deadline (${deadline}).`,
      });
    }

    if (Array.isArray(t.dependencies)) {
      for (const depId of t.dependencies) {
        const prereq = taskMap.get(depId);
        if (prereq && prereq.status !== 'completed' && prereq.date > t.date) {
          issues.push({
            type: 'dependency_order',
            taskId: t.id,
            message: `"${t.title}" is scheduled before prerequisite "${prereq.title}".`,
          });
        }
      }
    }
  }

  for (const [date, mins] of minutesByDay.entries()) {
    if (mins > dailyCapacity) {
      issues.push({
        type: 'overloaded_day',
        date,
        message: `${date} has ${mins}m planned, exceeding ${dailyCapacity}m daily capacity.`,
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Compute a concise summary of the current schedule.
 */
export function getScheduleSummary(tasks, goal) {
  const dailyCapacity = calculateDailyCapacity(goal);
  const pending = tasks.filter((t) => t.status !== 'completed');
  const completed = tasks.filter((t) => t.status === 'completed');
  const totalPendingMinutes = pending.reduce((s, t) => s + (t.estimatedMinutes || 30), 0);
  const validation = validateSchedule(tasks, goal);

  return {
    totalTasks: tasks.length,
    pendingCount: pending.length,
    completedCount: completed.length,
    totalPendingMinutes,
    dailyCapacityMinutes: dailyCapacity,
    valid: validation.valid,
    issueCount: validation.issues.length,
  };
}

/**
 * Generate a deterministic starter plan based on the goal.
 * Associates starter tasks with generated milestones and adds realistic starter dependencies.
 */
export function generateInitialPlan(goal) {
  const { category, deadline, availableHoursPerDay, skillLevel } = goal;
  const catKey = getCategoryKey(category);
  const topics = CATEGORY_TOPICS[catKey] || CATEGORY_TOPICS.other;

  const today = getTodayStr();
  const totalDays = Math.max(1, daysUntil(deadline) + 1);
  const planDays = Math.min(totalDays, 7);
  const dailyMinutes = calculateDailyCapacity({ availableHoursPerDay });

  let tasksPerDay;
  switch (skillLevel) {
    case 'beginner':
      tasksPerDay = 2;
      break;
    case 'advanced':
      tasksPerDay = 4;
      break;
    default:
      tasksPerDay = 3;
  }

  const milestones = Array.isArray(goal.milestones) && goal.milestones.length > 0
    ? goal.milestones
    : generateMilestones(goal);

  const rawTasks = [];
  let topicIndex = 0;
  let previousTaskId = null;

  for (let day = 0; day < planDays; day++) {
    const dateStr = addDaysLocal(today, day);
    let dayMinutes = 0;

    for (let t = 0; t < tasksPerDay; t++) {
      const topic = topics[topicIndex % topics.length];
      const scaledMinutes = Math.max(15, Math.min(topic.minutes, Math.floor(dailyMinutes / tasksPerDay)));
      if (dayMinutes + scaledMinutes > dailyMinutes) break;

      const id = crypto.randomUUID();
      const milestone = milestones.length > 0
        ? milestones[Math.min(milestones.length - 1, Math.floor((day / planDays) * milestones.length))]
        : null;

      const dependencies = topic.dependsOnPrev && previousTaskId ? [previousTaskId] : [];

      rawTasks.push({
        id,
        title: topic.title,
        description: '',
        date: dateStr,
        estimatedMinutes: scaledMinutes,
        priority: topic.priority,
        milestoneId: milestone ? milestone.id : null,
        dependencies,
      });

      previousTaskId = id;
      dayMinutes += scaledMinutes;
      topicIndex++;
    }
  }

  return rawTasks;
}

/**
 * Apply a previewed replan result safely while preserving completed tasks.
 */
export function applyReplan(scheduledTasks) {
  const state = loadState();
  const completedMap = new Map(
    state.tasks.filter((t) => t.status === 'completed').map((t) => [t.id, t])
  );
  const scheduledMap = new Map(scheduledTasks.map((t) => [t.id, t]));

  const nextTasks = state.tasks.map((existing) => {
    if (completedMap.has(existing.id)) {
      return existing;
    }
    const updated = scheduledMap.get(existing.id);
    if (updated) {
      return {
        ...existing,
        date: updated.date,
        updatedAt: new Date().toISOString(),
      };
    }
    return existing;
  });

  state.tasks = nextTasks;
  saveState(state);
  return nextTasks;
}

/**
 * Deterministic next recommended task with transparent reasoning.
 * Rules:
 * 1. Exclude completed tasks
 * 2. Exclude blocked tasks
 * 3. Prioritize overdue tasks
 * 4. Consider priority (high > medium > low)
 * 5. Consider scheduled date (earliest first)
 * 6. Prefer tasks that unlock other dependent tasks
 */
export function getNextRecommendedTask(tasks, today = getTodayStr()) {
  const eligible = tasks.filter(
    (t) => t.status !== 'completed' && !isTaskBlocked(t, tasks)
  );
  if (eligible.length === 0) return null;

  const dependentCounts = new Map();
  for (const t of tasks) {
    if (t.status !== 'completed' && Array.isArray(t.dependencies)) {
      for (const depId of t.dependencies) {
        dependentCounts.set(depId, (dependentCounts.get(depId) || 0) + 1);
      }
    }
  }

  const priorityRank = { high: 0, medium: 1, low: 2 };
  const sorted = [...eligible].sort((a, b) => {
    const aOverdue = a.date < today ? 0 : 1;
    const bOverdue = b.date < today ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;

    const pDiff = (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1);
    if (pDiff !== 0) return pDiff;

    const dDiff = (a.date || '').localeCompare(b.date || '');
    if (dDiff !== 0) return dDiff;

    return (dependentCounts.get(b.id) || 0) - (dependentCounts.get(a.id) || 0);
  });

  const best = sorted[0];
  const reasons = [];
  if (best.date < today) reasons.push('overdue');
  else if (best.date === today) reasons.push('scheduled for today');
  else reasons.push(`upcoming on ${best.date}`);

  if (best.priority === 'high') reasons.push('high priority');
  const unlocks = dependentCounts.get(best.id) || 0;
  if (unlocks > 0) reasons.push(`unlocks ${unlocks} dependent task${unlocks > 1 ? 's' : ''}`);

  return {
    task: best,
    reason: `Recommended because it is ${reasons.join(', ')}.`,
  };
}

/**
 * Stage 3 AI-powered schedule recovery entry point.
 * Builds recovery context and delegates to recoveryService.
 */
export async function recoverSchedule(goal, tasks, { milestones = [], explanation = '', approach = 'balanced' } = {}) {
  const context = buildRecoveryContext(goal, tasks, milestones, explanation, approach);
  return requestRecoveryPlan(context);
}

/**
 * Stage 3 execution analysis entry point.
 */
export function analyzeExecution(goal, tasks) {
  return analyzeExecutionImpl(goal, tasks);
}
