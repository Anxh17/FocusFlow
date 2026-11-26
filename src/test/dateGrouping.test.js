import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
globalThis.crypto.randomUUID = vi.fn(() => `dg-uuid-${++uuidCounter}`);

import {
  formatDateLocal,
  getTaskCompletionLocalDate,
  getTodayStr,
  getWeekDatesLocal,
  getWeekStartLocal,
  toLocalDateStr,
} from '../utils/dateUtils.js';
import { addTask, completeTask } from '../services/taskService.js';
import { computeExecutionAnalytics } from '../services/analyticsService.js';
import { generateWeeklyReport } from '../services/coachService.js';

describe('Date Grouping & Monday-to-Sunday Weekly Analytics', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    uuidCounter = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. completing a task today increments today count, not Monday count', () => {
    // Fix "today" to Wednesday 2026-11-25 at 14:00 local time
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 25, 14, 0, 0));

    const today = getTodayStr(); // 2026-11-25 (Wednesday)
    const task = addTask({ title: 'Today Task', date: today, estimatedMinutes: 30 });
    const completed = completeTask(task.id);

    const analytics = computeExecutionAnalytics([completed], [], today);
    const overview = analytics.consistency.sevenDayOverview;

    expect(overview).toHaveLength(7);
    expect(overview[0].date).toBe('2026-11-23'); // Monday
    expect(overview[0].Completed).toBe(0);
    expect(overview[2].date).toBe('2026-11-25'); // Wednesday (today)
    expect(overview[2].Completed).toBe(1);
  });

  it('2. a completion on Wednesday appears under Wednesday', () => {
    const wednesday = '2026-11-25';
    const wedIso = new Date(2026, 10, 25, 16, 30, 0).toISOString();
    const tasks = [
      { id: 't-wed', title: 'Wed Task', date: wednesday, status: 'completed', completedAt: wedIso, estimatedMinutes: 30 },
    ];

    const analytics = computeExecutionAnalytics(tasks, [], '2026-11-27'); // Friday of same week
    const wedBucket = analytics.consistency.sevenDayOverview.find((d) => d.date === wednesday);
    expect(wedBucket).toBeDefined();
    expect(wedBucket.day).toContain('Wed');
    expect(wedBucket.Completed).toBe(1);
    expect(analytics.consistency.sevenDayOverview[0].Completed).toBe(0);
  });

  it('3. a Sunday completion appears under Sunday, not the following Monday', () => {
    const sunday = '2026-11-29';
    const sunIso = new Date(2026, 10, 29, 21, 15, 0).toISOString();
    const tasks = [
      { id: 't-sun', title: 'Sun Task', date: sunday, status: 'completed', completedAt: sunIso, estimatedMinutes: 30 },
    ];

    // Inspecting during the week ending Sunday 2026-11-29
    const thisWeek = computeExecutionAnalytics(tasks, [], sunday);
    expect(thisWeek.consistency.sevenDayOverview[0].date).toBe('2026-11-23'); // Monday
    expect(thisWeek.consistency.sevenDayOverview[6].date).toBe(sunday); // Sunday
    expect(thisWeek.consistency.sevenDayOverview[6].Completed).toBe(1);
    expect(thisWeek.consistency.sevenDayOverview[0].Completed).toBe(0);

    // Inspecting on the following Monday 2026-11-30 — Sunday's task must NOT appear on Monday
    const nextMonday = '2026-11-30';
    const nextWeek = computeExecutionAnalytics(tasks, [], nextMonday);
    expect(nextWeek.consistency.sevenDayOverview[0].date).toBe(nextMonday);
    expect(nextWeek.consistency.sevenDayOverview[0].Completed).toBe(0);
  });

  it('4. handles Monday-to-Sunday boundaries across month and year transitions', () => {
    // 2026-12-31 is Thursday -> week is Mon 2026-12-28 .. Sun 2027-01-03
    expect(getWeekStartLocal('2026-12-31')).toBe('2026-12-28');
    expect(getWeekStartLocal('2027-01-03')).toBe('2026-12-28'); // Sunday belongs to same week
    expect(getWeekDatesLocal('2027-01-01')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
  });

  it('5. groups dates around local midnight using the local calendar date', () => {
    const localAfterMidnight = new Date(2026, 10, 26, 0, 15, 0); // 00:15 local on Thu Nov 26
    const localBeforeMidnight = new Date(2026, 10, 25, 23, 50, 0); // 23:50 local on Wed Nov 25

    expect(toLocalDateStr(localAfterMidnight.toISOString())).toBe(formatDateLocal(localAfterMidnight));
    expect(toLocalDateStr(localBeforeMidnight.toISOString())).toBe(formatDateLocal(localBeforeMidnight));

    const tasks = [
      {
        id: 'after-mid',
        title: 'After Midnight',
        date: '2026-11-26',
        status: 'completed',
        completedAt: localAfterMidnight.toISOString(),
        estimatedMinutes: 20,
      },
      {
        id: 'before-mid',
        title: 'Before Midnight',
        date: '2026-11-25',
        status: 'completed',
        completedAt: localBeforeMidnight.toISOString(),
        estimatedMinutes: 20,
      },
    ];

    const analytics = computeExecutionAnalytics(tasks, [], '2026-11-26');
    const wed = analytics.consistency.sevenDayOverview.find((d) => d.date === '2026-11-25');
    const thu = analytics.consistency.sevenDayOverview.find((d) => d.date === '2026-11-26');
    expect(wed.Completed).toBe(1);
    expect(thu.Completed).toBe(1);
  });

  it('6. interprets existing historical completion timestamps accurately', () => {
    const t1 = {
      id: 'hist-1',
      title: 'Historical',
      date: '2026-11-24',
      status: 'completed',
      completedAt: new Date(2026, 10, 24, 18, 0, 0).toISOString(),
    };
    expect(getTaskCompletionLocalDate(t1)).toBe('2026-11-24');

    const tNoTimestamp = {
      id: 'hist-2',
      title: 'Legacy',
      date: '2026-11-24',
      status: 'completed',
    };
    expect(getTaskCompletionLocalDate(tNoTimestamp)).toBe('2026-11-24');
  });

  it('7. Coach weekly report and Analytics use identical Monday-to-Sunday date grouping', () => {
    const today = '2026-11-26'; // Thursday
    const goal = { id: 'g1', title: 'Goal', deadline: '2026-12-10', availableHoursPerDay: 2 };
    const tasks = [
      {
        id: 'm1',
        title: 'Mon Task',
        date: '2026-11-23',
        status: 'completed',
        completedAt: new Date(2026, 10, 23, 11, 0, 0).toISOString(),
        estimatedMinutes: 30,
      },
      {
        id: 'th1',
        title: 'Thu Task',
        date: '2026-11-26',
        status: 'completed',
        completedAt: new Date(2026, 10, 26, 0, 20, 0).toISOString(),
        estimatedMinutes: 30,
      },
    ];

    const analytics = computeExecutionAnalytics(tasks, [], today);
    const report = generateWeeklyReport(goal, tasks, [], today);

    expect(report.windowStart).toBe('2026-11-23');
    expect(report.windowEnd).toBe('2026-11-29');
    expect(report.dailyTrend.map((d) => ({ date: d.date, Completed: d.Completed }))).toEqual(
      analytics.consistency.sevenDayOverview.map((d) => ({ date: d.date, Completed: d.Completed }))
    );
  });
});
