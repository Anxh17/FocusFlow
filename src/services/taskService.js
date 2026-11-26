import { loadState, saveState } from './storageService.js';
import { stopTimer } from './timerService.js';
import {
  validateDependencies,
  isTaskBlocked,
  getBlockingPrerequisites,
} from '../utils/schedulingUtils.js';

export function getTasks() {
  const state = loadState();
  return state.tasks || [];
}

export function getTaskById(id) {
  const tasks = getTasks();
  return tasks.find((t) => t.id === id) || null;
}

export function addTask(task) {
  const state = loadState();
  const newId = task.id || crypto.randomUUID();
  const depCheck = validateDependencies(newId, task.dependencies || [], state.tasks);
  if (!depCheck.valid) {
    throw new Error(depCheck.error);
  }

  const now = new Date().toISOString();
  const newTask = {
    id: newId,
    title: task.title,
    description: task.description || '',
    date: task.date,
    estimatedMinutes: task.estimatedMinutes || 30,
    priority: task.priority || 'medium',
    status: 'pending',
    actualSeconds: 0,
    timeSessions: [],
    dependencies: depCheck.cleanDeps,
    postponementCount: 0,
    postponementHistory: [],
    milestoneId: task.milestoneId || null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  state.tasks.push(newTask);
  saveState(state);
  return newTask;
}

export function updateTask(id, updates) {
  const state = loadState();
  const idx = state.tasks.findIndex((t) => t.id === id);
  if (idx === -1) return null;

  const nextUpdates = { ...updates };
  if (Object.prototype.hasOwnProperty.call(nextUpdates, 'dependencies')) {
    const depCheck = validateDependencies(id, nextUpdates.dependencies, state.tasks);
    if (!depCheck.valid) {
      throw new Error(depCheck.error);
    }
    nextUpdates.dependencies = depCheck.cleanDeps;
  }

  // Ordinary edits never increment postponementCount
  state.tasks[idx] = {
    ...state.tasks[idx],
    ...nextUpdates,
    updatedAt: new Date().toISOString(),
  };
  saveState(state);
  return state.tasks[idx];
}

export function completeTask(id) {
  const state = loadState();
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return null;

  if (isTaskBlocked(task, state.tasks)) {
    const blockers = getBlockingPrerequisites(task, state.tasks).map((b) => b.title);
    throw new Error(
      `Cannot complete "${task.title}" until prerequisite(s) are completed: ${blockers.join(', ')}.`
    );
  }

  // Stop active timer if it belongs to this task before marking complete
  if (state.activeTimer && state.activeTimer.taskId === id) {
    stopTimer();
  }

  return updateTask(id, {
    status: 'completed',
    completedAt: new Date().toISOString(),
  });
}

export function reopenTask(id) {
  return updateTask(id, {
    status: 'pending',
    completedAt: null,
  });
}

export function postponeTask(id, newDate) {
  const state = loadState();
  const idx = state.tasks.findIndex((t) => t.id === id);
  if (idx === -1) return null;

  const existing = state.tasks[idx];
  const now = new Date().toISOString();
  const historyEntry = {
    fromDate: existing.date,
    toDate: newDate,
    postponedAt: now,
  };

  state.tasks[idx] = {
    ...existing,
    date: newDate,
    status: 'pending',
    postponementCount: (existing.postponementCount || 0) + 1,
    postponementHistory: [...(existing.postponementHistory || []), historyEntry],
    updatedAt: now,
  };
  saveState(state);
  return state.tasks[idx];
}

export function deleteTask(id) {
  const state = loadState();
  if (state.activeTimer && state.activeTimer.taskId === id) {
    state.activeTimer = null;
  }
  state.tasks = state.tasks
    .filter((t) => t.id !== id)
    .map((t) => ({
      ...t,
      dependencies: Array.isArray(t.dependencies)
        ? t.dependencies.filter((depId) => depId !== id)
        : [],
    }));
  saveState(state);
}

export function getTasksForDate(dateStr) {
  const tasks = getTasks();
  return tasks.filter((t) => t.date === dateStr);
}

export function getTasksByStatus(status) {
  const tasks = getTasks();
  return tasks.filter((t) => t.status === status);
}

export function getCompletedTasks() {
  return getTasksByStatus('completed');
}

export function getPendingTasks() {
  return getTasksByStatus('pending');
}

export function bulkAddTasks(tasksArray) {
  const state = loadState();
  const now = new Date().toISOString();
  const newTasks = tasksArray.map((task) => ({
    id: task.id || crypto.randomUUID(),
    title: task.title,
    description: task.description || '',
    date: task.date,
    estimatedMinutes: task.estimatedMinutes || 30,
    priority: task.priority || 'medium',
    status: task.status === 'completed' ? 'completed' : 'pending',
    actualSeconds: task.actualSeconds || 0,
    timeSessions: Array.isArray(task.timeSessions) ? task.timeSessions : [],
    dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
    postponementCount: task.postponementCount || 0,
    postponementHistory: Array.isArray(task.postponementHistory) ? task.postponementHistory : [],
    milestoneId: task.milestoneId || null,
    createdAt: now,
    updatedAt: now,
    completedAt: task.completedAt || null,
  }));
  state.tasks = [...state.tasks, ...newTasks];
  saveState(state);
  return newTasks;
}
