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
globalThis.crypto.randomUUID = vi.fn(() => `test-uuid-${++uuidCounter}`);

import { loadState } from '../services/storageService.js';
import { saveGoal, getGoal, updateGoal, isOnboardingComplete } from '../services/goalService.js';
import {
  getTasks, addTask, updateTask, completeTask, reopenTask,
  postponeTask, deleteTask, getTasksForDate
} from '../services/taskService.js';
import { validateGoalForm, validateTaskForm } from '../utils/validation.js';
import { formatDateLocal, formatDuration, getTodayStr } from '../utils/dateUtils.js';
import { generateInitialPlan, recoverSchedule, analyzeExecution } from '../services/planningService.js';
import Dashboard from '../pages/Dashboard.jsx';
import Onboarding from '../pages/Onboarding.jsx';

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
  uuidCounter = 0;
});

// 1. Creating and loading a goal
describe('1. Creating and loading a goal', () => {
  it('saves and loads a goal with timestamps and stable ID', () => {
    const goal = saveGoal({
      title: 'Crack Tech Placements',
      category: 'Placements',
      deadline: '2027-06-01',
      availableHoursPerDay: 4,
      skillLevel: 'intermediate',
      description: 'Focus on DSA and System Design',
    });

    expect(goal.id).toBeTruthy();
    expect(goal.title).toBe('Crack Tech Placements');
    expect(goal.createdAt).toBeTruthy();

    const loaded = getGoal();
    expect(loaded).not.toBeNull();
    expect(loaded.title).toBe('Crack Tech Placements');
    expect(loaded.category).toBe('Placements');
    expect(isOnboardingComplete()).toBe(true);
  });

  it('updates goal details without deleting existing tasks', () => {
    saveGoal({
      title: 'Initial Goal',
      category: 'Learning',
      deadline: '2027-06-01',
      availableHoursPerDay: 2,
      skillLevel: 'beginner',
    });
    const t = addTask({ title: 'Existing Task', date: getTodayStr(), estimatedMinutes: 30, priority: 'high' });
    completeTask(t.id);

    const updated = updateGoal({ title: 'Updated Goal', availableHoursPerDay: 3 });
    expect(updated.title).toBe('Updated Goal');
    expect(updated.availableHoursPerDay).toBe(3);

    const tasks = getTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('completed');
  });
});

// 2. Persisting tasks across reloads or storage reloads
describe('2. Persisting tasks across storage reloads', () => {
  it('persists tasks in localStorage and reloads them with stable IDs', () => {
    const t1 = addTask({ title: 'Solve 2 Array Problems', date: '2027-01-15', estimatedMinutes: 45, priority: 'high' });
    const t2 = addTask({ title: 'Review Notes', date: '2027-01-16', estimatedMinutes: 30, priority: 'medium' });

    expect(t1.id).not.toBe(t2.id);

    const reloadedState = loadState();
    expect(reloadedState.tasks).toHaveLength(2);
    expect(reloadedState.tasks[0].id).toBe(t1.id);
    expect(reloadedState.tasks[0].title).toBe('Solve 2 Array Problems');
    expect(reloadedState.tasks[1].id).toBe(t2.id);
  });
});

// 3. Completing and reopening a task
describe('3. Completing and reopening a task', () => {
  it('completes a task while preserving it and allows reopening', () => {
    const task = addTask({ title: 'Complete Me', date: getTodayStr(), priority: 'high', estimatedMinutes: 30 });
    const completed = completeTask(task.id);

    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBeTruthy();
    expect(getTasks().find((t) => t.id === task.id)?.status).toBe('completed');

    const reopened = reopenTask(task.id);
    expect(reopened.status).toBe('pending');
    expect(reopened.completedAt).toBeNull();
    expect(getTasks().find((t) => t.id === task.id)?.status).toBe('pending');
  });
});

// 4. Editing and postponing a task
describe('4. Editing and postponing a task', () => {
  it('edits task fields and preserves unchanged fields', () => {
    const task = addTask({ title: 'Original', date: '2027-01-15', estimatedMinutes: 30, priority: 'medium' });
    const updated = updateTask(task.id, { title: 'Edited Title', estimatedMinutes: 60, priority: 'high' });

    expect(updated.title).toBe('Edited Title');
    expect(updated.estimatedMinutes).toBe(60);
    expect(updated.priority).toBe('high');
    expect(updated.date).toBe('2027-01-15');
  });

  it('postpones a task to another date', () => {
    const task = addTask({ title: 'Postpone Me', date: '2027-01-15', priority: 'high' });
    const postponed = postponeTask(task.id, '2027-01-20');

    expect(postponed.date).toBe('2027-01-20');
    expect(postponed.status).toBe('pending');
    expect(getTasksForDate('2027-01-15')).toHaveLength(0);
    expect(getTasksForDate('2027-01-20')).toHaveLength(1);
  });

  it('deletes a task by ID', () => {
    const t1 = addTask({ title: 'Delete Me', date: '2027-01-15' });
    addTask({ title: 'Keep Me', date: '2027-01-15' });
    deleteTask(t1.id);

    const remaining = getTasks();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].title).toBe('Keep Me');
  });
});

// 5. Handling malformed LocalStorage data safely
describe('5. Handling malformed LocalStorage data safely', () => {
  it('recovers gracefully from invalid JSON, wrong schema version, and corrupted fields', () => {
    localStorageMock.setItem('focusflow_data', '{invalid-json');
    expect(loadState()).toEqual({
      version: 3,
      goal: null,
      tasks: [],
      onboardingComplete: false,
      activeTimer: null,
      recoveryHistory: [],
    });

    localStorageMock.setItem('focusflow_data', JSON.stringify({ version: 99, goal: { title: 'Old' }, tasks: [{}] }));
    expect(loadState()).toEqual({
      version: 3,
      goal: null,
      tasks: [],
      onboardingComplete: false,
      activeTimer: null,
      recoveryHistory: [],
    });

    localStorageMock.setItem('focusflow_data', JSON.stringify({ version: 1, goal: 'bad', tasks: 'not-array', onboardingComplete: 'yes' }));
    const sanitized = loadState();
    expect(sanitized.goal).toBeNull();
    expect(sanitized.tasks).toEqual([]);
    expect(sanitized.onboardingComplete).toBe(false);
  });
});

// 6. Validating onboarding inputs
describe('6. Validating onboarding inputs', () => {
  it('validates required fields, hours, and deadline', () => {
    expect(validateGoalForm({ title: '', category: 'Learning', deadline: '2027-06-01', availableHoursPerDay: '2', skillLevel: 'beginner' }).title).toBeTruthy();
    expect(validateGoalForm({ title: 'Valid Goal', category: '', deadline: '2027-06-01', availableHoursPerDay: '2', skillLevel: 'beginner' }).category).toBeTruthy();
    expect(validateGoalForm({ title: 'Valid Goal', category: 'Learning', deadline: '2020-01-01', availableHoursPerDay: '2', skillLevel: 'beginner' }).deadline).toBeTruthy();
    expect(validateGoalForm({ title: 'Valid Goal', category: 'Learning', deadline: '2027-06-01', availableHoursPerDay: '0', skillLevel: 'beginner' }).availableHoursPerDay).toBeTruthy();
    expect(validateGoalForm({ title: 'Valid Goal', category: 'Learning', deadline: '2027-06-01', availableHoursPerDay: '20', skillLevel: 'beginner' }).availableHoursPerDay).toBeTruthy();
    expect(validateGoalForm({ title: 'Valid Goal', category: 'Learning', deadline: '2027-06-01', availableHoursPerDay: '3', skillLevel: '' }).skillLevel).toBeTruthy();

    const valid = validateGoalForm({ title: 'Valid Goal', category: 'Learning', deadline: '2027-06-01', availableHoursPerDay: '3', skillLevel: 'intermediate' });
    expect(Object.keys(valid)).toHaveLength(0);
  });

  it('shows inline validation errors on Onboarding UI when advancing with blank inputs', () => {
    render(
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    expect(screen.getByText(/Goal title is required/i)).toBeInTheDocument();
    expect(screen.getByText(/Please select a goal category/i)).toBeInTheDocument();
  });
});

// 7. Updating dashboard progress after task completion
describe('7. Updating dashboard progress after task completion', () => {
  it('updates completed counts and time on Dashboard when a task is completed', () => {
    const today = getTodayStr();
    saveGoal({
      title: 'Pass Competitive Exam',
      category: 'Competitive Exam',
      deadline: '2027-06-01',
      availableHoursPerDay: 3,
      skillLevel: 'intermediate',
    });
    addTask({ title: 'Practice Mock Test', date: today, estimatedMinutes: 45, priority: 'high' });
    addTask({ title: 'Revise Formulas', date: today, estimatedMinutes: 30, priority: 'medium' });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    expect(screen.getByText('Pass Competitive Exam')).toBeInTheDocument();
    expect(screen.getAllByText('0% complete')).toHaveLength(2);

    const completeBtn = screen.getByRole('button', { name: 'Complete task: Practice Mock Test' });
    fireEvent.click(completeBtn);

    expect(screen.getAllByText('50% complete')).toHaveLength(2);
  });
});

// 8. Rendering an empty state when no goal exists
describe('8. Rendering an empty state when no goal exists', () => {
  it('renders a helpful empty state on Dashboard when no goal exists', () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    expect(screen.getByText('No goal set yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Set Up My Goal/i })).toBeInTheDocument();
  });
});

// Additional checks for AI boundaries & utils
describe('AI-ready boundaries and utilities', () => {
  it('generates deterministic starter plan and exposes Stage 3 recovery & analysis functions', async () => {
    const plan = generateInitialPlan({
      category: 'Technical Interview',
      deadline: '2027-06-01',
      availableHoursPerDay: 3,
      skillLevel: 'intermediate',
    });
    expect(plan.length).toBeGreaterThan(0);
    expect(typeof recoverSchedule).toBe('function');
    const analysis = await analyzeExecution({ deadline: '2027-06-01', availableHoursPerDay: 3 }, []);
    expect(analysis).toHaveProperty('completionRate');
  });

  it('formats local dates and durations without UTC shift bugs', () => {
    expect(formatDateLocal(new Date(2027, 0, 5))).toBe('2027-01-05');
    expect(formatDuration(90)).toBe('1h 30m');
    expect(validateTaskForm({ title: '', date: '', estimatedMinutes: '0' })).toHaveProperty('title');
  });
});
