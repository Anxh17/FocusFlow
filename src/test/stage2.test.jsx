import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, val) => { store[key] = String(val); }),
    removeItem: vi.fn((key) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

if (!globalThis.crypto) {
  globalThis.crypto = {};
}
let uuidCounter = 0;
globalThis.crypto.randomUUID = vi.fn(() => `s2-uuid-${++uuidCounter}`);

import { loadState, migrateStateToV2, SCHEMA_VERSION } from '../services/storageService.js';
import { saveGoal, getGoal, updateGoal } from '../services/goalService.js';
import {
  getTasks, addTask, updateTask, completeTask, reopenTask,
  postponeTask, deleteTask
} from '../services/taskService.js';
import {
  generateMilestones, toggleMilestoneStatus
} from '../services/milestoneService.js';
import {
  calculateDailyCapacity, distributeTasks, applyReplan
} from '../services/planningService.js';
import {
  startTimer, pauseTimer, resumeTimer, stopTimer,
  getActiveTimer, getActiveTimerElapsedSeconds
} from '../services/timerService.js';
import { computeExecutionAnalytics } from '../services/analyticsService.js';
import { isTaskBlocked } from '../utils/schedulingUtils.js';
import { addDaysLocal, getTodayStr } from '../utils/dateUtils.js';
import Dashboard from '../pages/Dashboard.jsx';
import Tasks from '../pages/Tasks.jsx';
import Analytics from '../pages/Analytics.jsx';

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
  uuidCounter = 0;
});

// ============================================================
// LOCALSTORAGE MIGRATION (1 - 6)
// ============================================================
describe('Stage 2 LocalStorage Migration (v1 -> v2)', () => {
  it('1-4. migrates v1 state to v2 preserving goal, tasks, and completed tasks', () => {
    const v1State = {
      version: 1,
      onboardingComplete: true,
      goal: {
        id: 'g-1',
        title: 'Crack Placements',
        category: 'Placements',
        deadline: '2027-06-01',
        availableHoursPerDay: 3,
        skillLevel: 'intermediate',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      tasks: [
        {
          id: 't-1',
          title: 'Done Task',
          description: 'Keep me',
          date: '2026-11-25',
          estimatedMinutes: 45,
          priority: 'high',
          status: 'completed',
          completedAt: '2026-11-25T10:00:00.000Z',
        },
        {
          id: 't-2',
          title: 'Pending Task',
          date: '2026-11-26',
          estimatedMinutes: 30,
          priority: 'medium',
          status: 'pending',
          completedAt: null,
        },
      ],
    };

    localStorageMock.setItem('focusflow_data', JSON.stringify(v1State));
    const loaded = loadState();

    expect(loaded.version).toBe(SCHEMA_VERSION);
    expect(loaded.onboardingComplete).toBe(true);
    expect(loaded.goal.id).toBe('g-1');
    expect(loaded.goal.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(loaded.goal.milestones).toEqual([]);
    expect(loaded.activeTimer).toBeNull();

    expect(loaded.tasks).toHaveLength(2);
    expect(loaded.tasks[0].id).toBe('t-1');
    expect(loaded.tasks[0].status).toBe('completed');
    expect(loaded.tasks[0].completedAt).toBe('2026-11-25T10:00:00.000Z');
    expect(loaded.tasks[0].actualSeconds).toBe(0);
    expect(loaded.tasks[0].timeSessions).toEqual([]);
    expect(loaded.tasks[0].dependencies).toEqual([]);
    expect(loaded.tasks[0].postponementCount).toBe(0);
    expect(loaded.tasks[0].postponementHistory).toEqual([]);
    expect(loaded.tasks[0].milestoneId).toBeNull();

    // Idempotent second migration
    const secondPass = migrateStateToV2(loaded);
    expect(secondPass).toEqual(loaded);
  });

  it('5-6. handles malformed storage and missing new fields safely', () => {
    localStorageMock.setItem('focusflow_data', 'broken-json{{{');
    const fallback = loadState();
    expect(fallback.version).toBe(SCHEMA_VERSION);
    expect(fallback.tasks).toEqual([]);
    expect(fallback.goal).toBeNull();
    expect(fallback.activeTimer).toBeNull();

    // Missing new fields in v2 object
    const partialV2 = {
      version: 2,
      goal: { id: 'g2', title: 'Test' },
      tasks: [{ id: 't1', title: 'Task 1' }, { bad: true }],
    };
    localStorageMock.setItem('focusflow_data', JSON.stringify(partialV2));
    const sanitized = loadState();
    expect(sanitized.tasks).toHaveLength(1);
    expect(sanitized.tasks[0].actualSeconds).toBe(0);
    expect(sanitized.tasks[0].postponementCount).toBe(0);
    expect(sanitized.goal.milestones).toEqual([]);
  });
});

// ============================================================
// GOAL & MILESTONES (7 - 10)
// ============================================================
describe('Stage 2 Goal & Milestones', () => {
  it('7-8. generates category milestones with realistic date distribution', () => {
    const today = getTodayStr();
    const deadline = addDaysLocal(today, 30);
    const milestones = generateMilestones({ category: 'Placements', deadline });

    expect(milestones.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < milestones.length; i++) {
      expect(milestones[i].id).toBeTruthy();
      expect(milestones[i].targetDate >= today).toBe(true);
      expect(milestones[i].targetDate <= deadline).toBe(true);
      if (i > 0) {
        expect(milestones[i].targetDate >= milestones[i - 1].targetDate).toBe(true);
      }
    }
  });

  it('9-10. toggles milestone completion and edits goal without deleting tasks', () => {
    const today = getTodayStr();
    const deadline = addDaysLocal(today, 20);
    const ms = generateMilestones({ category: 'Learning', deadline });
    saveGoal({
      title: 'Learn Rust',
      category: 'Learning',
      deadline,
      availableHoursPerDay: 2,
      skillLevel: 'beginner',
      milestones: ms,
    });
    addTask({ title: 'Read Chapter 1', date: today, estimatedMinutes: 45, milestoneId: ms[0].id });

    const toggled = toggleMilestoneStatus(ms[0].id);
    expect(toggled.status).toBe('completed');

    updateGoal({ title: 'Master Rust', availableHoursPerDay: 4 });
    expect(getGoal().title).toBe('Master Rust');
    expect(getTasks()).toHaveLength(1);
  });
});

// ============================================================
// SMARTER DAILY SCHEDULING (11 - 16)
// ============================================================
describe('Stage 2 Smarter Daily Scheduling', () => {
  it('11-14. enforces daily capacity, deadline, priority, and dependency order', () => {
    const today = getTodayStr();
    const deadline = addDaysLocal(today, 3);
    const goal = {
      title: 'Test Schedule',
      deadline,
      availableHoursPerDay: 1, // 60 min/day
    };

    expect(calculateDailyCapacity(goal, today)).toBe(60);

    const t1 = { id: 'a', title: 'Prereq', date: today, estimatedMinutes: 45, priority: 'medium', status: 'pending', dependencies: [] };
    const t2 = { id: 'b', title: 'Dependent', date: today, estimatedMinutes: 45, priority: 'high', status: 'pending', dependencies: ['a'] };
    const t3 = { id: 'c', title: 'Independent High', date: today, estimatedMinutes: 60, priority: 'high', status: 'pending', dependencies: [] };

    const result = distributeTasks([t2, t3, t1], goal, { startDate: today });
    expect(result.feasible).toBe(true);

    const map = new Map(result.scheduledTasks.map((t) => [t.id, t]));
    // Prereq 'a' must not be scheduled after dependent 'b'
    expect(map.get('a').date <= map.get('b').date).toBe(true);
    // No day exceeds 60 minutes
    const byDay = new Map();
    for (const t of result.scheduledTasks) {
      byDay.set(t.date, (byDay.get(t.date) || 0) + t.estimatedMinutes);
    }
    for (const mins of byDay.values()) {
      expect(mins).toBeLessThanOrEqual(60);
    }
  });

  it('15-16. detects infeasible schedules and preserves completed tasks on replan', () => {
    const today = getTodayStr();
    const goal = saveGoal({
      title: 'Tight Goal',
      category: 'Other',
      deadline: today, // 1 day only
      availableHoursPerDay: 1, // 60 min total capacity
      skillLevel: 'beginner',
    });

    const done = addTask({ title: 'Completed', date: today, estimatedMinutes: 30, priority: 'high' });
    completeTask(done.id);
    addTask({ title: 'Fits', date: today, estimatedMinutes: 30, priority: 'high' });
    addTask({ title: 'Overflow', date: today, estimatedMinutes: 45, priority: 'low' });

    const preview = distributeTasks(getTasks(), goal, { startDate: today });
    expect(preview.feasible).toBe(false);
    expect(preview.unscheduled).toHaveLength(1);
    expect(preview.unscheduled[0].title).toBe('Overflow');
    expect(preview.shortfallMinutes).toBe(45);

    const applied = applyReplan(preview.scheduledTasks);
    expect(applied.find((t) => t.id === done.id)?.status).toBe('completed');
  });
});

// ============================================================
// TASK EXECUTION TIMER (17 - 23)
// ============================================================
describe('Stage 2 Task Execution Timer', () => {
  it('17-22. starts, pauses, resumes, stops, persists across reloads, and prevents simultaneous timers', () => {
    const today = getTodayStr();
    const t1 = addTask({ title: 'Task 1', date: today, estimatedMinutes: 30 });
    const t2 = addTask({ title: 'Task 2', date: today, estimatedMinutes: 30 });

    const t0 = new Date('2026-11-25T10:00:00.000Z');
    const startRes = startTimer(t1.id, { now: t0 });
    expect(startRes.conflict).toBe(false);

    // Attempting to start another timer returns conflict
    const conflictRes = startTimer(t2.id, { now: new Date('2026-11-25T10:01:00.000Z') });
    expect(conflictRes.conflict).toBe(true);
    expect(getActiveTimer().taskId).toBe(t1.id);

    // Pause after 5 minutes (300s)
    const paused = pauseTimer({ now: new Date('2026-11-25T10:05:00.000Z') });
    expect(paused.status).toBe('paused');
    expect(paused.elapsedBeforePauseSeconds).toBe(300);

    // Reload state simulates browser refresh while paused
    const reloaded = loadState();
    expect(reloaded.activeTimer.taskId).toBe(t1.id);
    expect(getActiveTimerElapsedSeconds(reloaded.activeTimer)).toBe(300);

    // Resume at 10:10, stop at 10:12 (another 120s -> total 420s)
    resumeTimer({ now: new Date('2026-11-25T10:10:00.000Z') });
    const stopRes = stopTimer({ now: new Date('2026-11-25T10:12:00.000Z') });
    expect(stopRes.durationSeconds).toBe(420);
    expect(getActiveTimer()).toBeNull();

    const updatedT1 = getTasks().find((t) => t.id === t1.id);
    expect(updatedT1.actualSeconds).toBe(420);
    expect(updatedT1.timeSessions).toHaveLength(1);
    expect(updatedT1.timeSessions[0].durationSeconds).toBe(420);
  });

  it('23. stops and saves active timer session when completing a task', () => {
    const today = getTodayStr();
    const t = addTask({ title: 'Timed Task', date: today, estimatedMinutes: 30 });
    startTimer(t.id, { now: new Date(Date.now() - 10000) });

    const completed = completeTask(t.id);
    expect(completed.status).toBe('completed');
    expect(completed.actualSeconds).toBeGreaterThanOrEqual(9);
    expect(completed.timeSessions).toHaveLength(1);
    expect(getActiveTimer()).toBeNull();
  });
});

// ============================================================
// TASK DEPENDENCIES (24 - 29)
// ============================================================
describe('Stage 2 Task Dependencies', () => {
  it('24-29. validates dependencies, blocks incomplete prereqs, unlocks on completion, and cleans up deleted prereqs', () => {
    const today = getTodayStr();
    const a = addTask({ title: 'Learn Arrays', date: today });
    const b = addTask({ title: 'Practice Arrays', date: today, dependencies: [a.id] });

    // Self-dependency rejected
    expect(() => updateTask(a.id, { dependencies: [a.id] })).toThrow(/itself/i);

    // Circular dependency rejected (a -> b -> a)
    expect(() => updateTask(a.id, { dependencies: [b.id] })).toThrow(/Circular/i);

    // Blocked while A is pending
    expect(isTaskBlocked(b, getTasks())).toBe(true);
    expect(() => completeTask(b.id)).toThrow(/prerequisite/i);

    // Completing A unlocks B
    completeTask(a.id);
    expect(isTaskBlocked(b, getTasks())).toBe(false);
    const completedB = completeTask(b.id);
    expect(completedB.status).toBe('completed');

    // Reopening A re-blocks pending dependent
    reopenTask(b.id);
    reopenTask(a.id);
    expect(isTaskBlocked(b, getTasks())).toBe(true);

    // Deleting A cleans up B's dependency reference
    deleteTask(a.id);
    const refreshedB = getTasks().find((t) => t.id === b.id);
    expect(refreshedB.dependencies).toEqual([]);
    expect(isTaskBlocked(refreshedB, getTasks())).toBe(false);
  });
});

// ============================================================
// ANALYTICS (30 - 34)
// ============================================================
describe('Stage 2 Execution Analytics', () => {
  it('30-34. computes actual time, postponements, completion %, and handles empty data', () => {
    const empty = computeExecutionAnalytics([], []);
    expect(empty.completion.completionPercentage).toBe(0);
    expect(empty.time.totalActualMinutes).toBe(0);
    expect(empty.milestones.milestoneCompletionPct).toBe(0);

    const today = getTodayStr();
    const t1 = addTask({ title: 'T1', date: today, estimatedMinutes: 60, priority: 'high' });
    const t2 = addTask({ title: 'T2', date: today, estimatedMinutes: 30, priority: 'medium' });

    startTimer(t1.id, { now: new Date(Date.now() - 120000) }); // ~2m
    stopTimer();
    completeTask(t1.id);
    postponeTask(t2.id, addDaysLocal(today, 1));

    const result = computeExecutionAnalytics(getTasks(), [{ id: 'm1', status: 'completed' }], today);
    expect(result.completion.completedCount).toBe(1);
    expect(result.completion.remainingCount).toBe(1);
    expect(result.completion.completionPercentage).toBe(50);
    expect(result.time.totalEstimatedMinutes).toBe(90);
    expect(result.time.totalActualMinutes).toBeGreaterThan(0);
    expect(result.time.tasksWithoutActualCount).toBe(1);
    expect(result.postponements.totalPostponements).toBe(1);
    expect(result.milestones.milestoneCompletionPct).toBe(100);
  });
});

// ============================================================
// UI INTEGRATION TESTS (35 - 38)
// ============================================================
describe('Stage 2 UI Integration', () => {
  it('35. Dashboard renders milestone progress, next recommendation, and estimated vs actual', () => {
    const today = getTodayStr();
    const deadline = addDaysLocal(today, 10);
    const ms = generateMilestones({ category: 'Placements', deadline });
    saveGoal({
      title: 'Placement Prep',
      category: 'Placements',
      deadline,
      availableHoursPerDay: 3,
      skillLevel: 'intermediate',
      milestones: ms,
    });
    addTask({ title: 'Solve Graphs', date: today, estimatedMinutes: 45, priority: 'high', milestoneId: ms[0].id });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    expect(screen.getByText(/Next Recommended Task \(Rule-Based\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Milestones & Health/i)).toBeInTheDocument();
    expect(screen.getByText(/Estimated vs Actual/i)).toBeInTheDocument();
  });

  it('36-37. Tasks page supports timer controls and enforces dependency blocking', () => {
    const today = getTodayStr();
    const prereq = addTask({ title: 'Prereq Task', date: today, estimatedMinutes: 30, priority: 'high' });
    addTask({ title: 'Blocked Task', date: today, estimatedMinutes: 30, priority: 'medium', dependencies: [prereq.id] });

    render(
      <MemoryRouter>
        <Tasks />
      </MemoryRouter>
    );

    expect(screen.getByText('Blocked', { selector: '.badge-blocked' })).toBeInTheDocument();

    // Start timer on Prereq Task
    fireEvent.click(screen.getByRole('button', { name: 'Start timer for Prereq Task' }));
    expect(screen.getByRole('region', { name: 'Active task timer' })).toBeInTheDocument();

    // Trying to complete Blocked Task shows error
    fireEvent.click(screen.getByRole('button', { name: 'Blocked task: Blocked Task' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Cannot complete/i);
  });

  it('38. Analytics page displays real execution metrics', () => {
    const today = getTodayStr();
    saveGoal({
      title: 'Interview Prep',
      category: 'Technical Interview',
      deadline: addDaysLocal(today, 14),
      availableHoursPerDay: 2,
      skillLevel: 'intermediate',
      milestones: [{ id: 'm1', title: 'Coding', targetDate: today, status: 'completed' }],
    });
    const t = addTask({ title: 'Task A', date: today, estimatedMinutes: 40 });
    completeTask(t.id);

    render(
      <MemoryRouter>
        <Analytics />
      </MemoryRouter>
    );

    expect(screen.getByText('Task Completion')).toBeInTheDocument();
    expect(screen.getByText('Time Intelligence')).toBeInTheDocument();
    expect(screen.getAllByText('100%').length).toBeGreaterThanOrEqual(1);
  });
});
