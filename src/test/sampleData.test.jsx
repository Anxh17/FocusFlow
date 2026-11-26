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
globalThis.crypto.randomUUID = vi.fn(() => `sample-uuid-${++uuidCounter}`);

vi.mock('recharts', async () => {
  const actual = await vi.importActual('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => <div style={{ width: 500, height: 220 }}>{children}</div>,
  };
});

import { saveGoal, getGoal } from '../services/goalService.js';
import { addTask, getTasks } from '../services/taskService.js';
import {
  buildRandomizedDemoState,
  generateSampleAnalyticsData,
  isDemoMode,
  resetDemoWorkspace,
} from '../services/demoService.js';
import { computeExecutionAnalytics } from '../services/analyticsService.js';
import { computeProductivityIntelligence, generateWeeklyReport } from '../services/coachService.js';
import { validateDependencies } from '../utils/schedulingUtils.js';
import { addDaysLocal, getTodayStr, toLocalDateStr } from '../utils/dateUtils.js';
import Analytics from '../pages/Analytics.jsx';

function makeSeededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
  uuidCounter = 0;
});

describe('Random Sample Analytics Data Generator', () => {
  it('generates realistic 30-day dataset with valid timestamps, positive durations, and valid dependencies', () => {
    const today = getTodayStr();
    const now = new Date();
    const state = buildRandomizedDemoState({ today, rng: makeSeededRng(42), now });

    expect(state.goal).not.toBeNull();
    expect(state.goal.milestones.length).toBe(3);
    expect(state.tasks.length).toBeGreaterThanOrEqual(25);
    expect(state.recoveryHistory.length).toBe(2);

    const startDay = addDaysLocal(today, -29);
    const taskDates = state.tasks.map((t) => t.date);
    expect(taskDates.some((d) => d >= startDay && d <= addDaysLocal(today, -20))).toBe(true);
    expect(taskDates.some((d) => d === today)).toBe(true);

    for (const t of state.tasks) {
      expect(t.estimatedMinutes).toBeGreaterThan(0);
      expect(t.actualSeconds).toBeGreaterThanOrEqual(0);
      if (t.status === 'completed') {
        expect(t.completedAt).toBeTruthy();
        expect(new Date(t.completedAt).getTime()).toBeLessThanOrEqual(now.getTime());
        expect(toLocalDateStr(t.completedAt) <= today).toBe(true);
        expect(t.actualSeconds).toBeGreaterThan(0);
        expect(t.timeSessions.length).toBeGreaterThan(0);
      }
      if (t.dependencies.length > 0) {
        const check = validateDependencies(t.id, t.dependencies, state.tasks);
        expect(check.valid).toBe(true);
      }
    }
  });

  it('produces varied datasets across different generations', () => {
    const today = getTodayStr();
    const s1 = buildRandomizedDemoState({ today, rng: makeSeededRng(1) });
    const s2 = buildRandomizedDemoState({ today, rng: makeSeededRng(999) });

    const sig1 = `${s1.goal.title}|${s1.tasks.length}|${s1.tasks[0]?.title}`;
    const sig2 = `${s2.goal.title}|${s2.tasks.length}|${s2.tasks[0]?.title}`;
    expect(sig1).not.toBe(sig2);
  });

  it('populates Analytics (including 30-day trend) and Coach intelligence accurately', () => {
    const today = getTodayStr();
    const res = generateSampleAnalyticsData({ today, rng: makeSeededRng(77) });
    expect(res.generated).toBe(true);
    expect(isDemoMode()).toBe(true);

    const { goal, tasks } = res.state;
    const analytics = computeExecutionAnalytics(tasks, goal.milestones, today);
    expect(analytics.completion.totalTasks).toBe(tasks.length);
    expect(analytics.completion.completedCount).toBeGreaterThan(0);
    expect(analytics.time.totalActualMinutes).toBeGreaterThan(0);
    expect(analytics.consistency.thirtyDayTrend).toHaveLength(30);

    const intel = computeProductivityIntelligence(goal, tasks, goal.milestones, today);
    const report = generateWeeklyReport(goal, tasks, goal.milestones, today);
    expect(intel.focus.hasActualData).toBe(true);
    expect(intel.recommendations.length).toBeGreaterThan(0);
    expect(report.threeImprovements).toHaveLength(3);
  });

  it('replaces demo dataset on regeneration without duplicating tasks, and resets safely', () => {
    const r1 = generateSampleAnalyticsData({ rng: makeSeededRng(10) });
    const count1 = getTasks().length;
    expect(count1).toBe(r1.taskCount);

    const r2 = generateSampleAnalyticsData({ rng: makeSeededRng(20) });
    const count2 = getTasks().length;
    expect(count2).toBe(r2.taskCount);

    resetDemoWorkspace();
    expect(isDemoMode()).toBe(true);
    expect(getTasks()).toHaveLength(7);
  });

  it('protects real user data unless explicitly confirmed in Analytics UI', () => {
    const today = getTodayStr();
    saveGoal({
      title: 'My Real Goal',
      category: 'Learning',
      deadline: addDaysLocal(today, 10),
      availableHoursPerDay: 2,
      skillLevel: 'beginner',
    });
    addTask({ title: 'My Real Task', date: today, estimatedMinutes: 30 });

    const blocked = generateSampleAnalyticsData();
    expect(blocked.generated).toBe(false);
    expect(blocked.requiresConfirmation).toBe(true);
    expect(getGoal().title).toBe('My Real Goal');

    render(
      <MemoryRouter>
        <Analytics />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /Generate Sample Data/i }));
    expect(screen.getByRole('dialog', { name: 'Enter Demo Workspace' })).toBeInTheDocument();

    // Keeping real data leaves it untouched
    fireEvent.click(screen.getByRole('button', { name: 'Keep My Data' }));
    expect(getGoal().title).toBe('My Real Goal');

    // Confirming enters demo workspace and populates analytics
    fireEvent.click(screen.getByRole('button', { name: /Generate Sample Data/i }));
    fireEvent.click(screen.getByRole('button', { name: /Enter Demo & Generate Data/i }));
    expect(screen.getByText(/Sample dataset generated:/i)).toBeInTheDocument();
    expect(screen.getByText('30-Day Productivity Trend')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Regenerate Sample Data/i })).toBeInTheDocument();
  });
});
