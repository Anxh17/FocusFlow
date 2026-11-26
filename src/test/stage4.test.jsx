import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
globalThis.crypto.randomUUID = vi.fn(() => `s4-uuid-${++uuidCounter}`);

// Mock Recharts ResponsiveContainer for jsdom
vi.mock('recharts', async () => {
  const actual = await vi.importActual('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => <div style={{ width: 500, height: 220 }}>{children}</div>,
  };
});

import { saveGoal } from '../services/goalService.js';
import { addTask, completeTask } from '../services/taskService.js';
import {
  computeProductivityIntelligence,
  generateWeeklyReport,
  buildMinimizedChatContext,
  generateDeterministicCoachReply,
  askCoachChat,
} from '../services/coachService.js';
import { handleCoachChat } from '../../server/coachHandler.js';
import { addDaysLocal, getTodayStr } from '../utils/dateUtils.js';
import Coach from '../pages/Coach.jsx';

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
  uuidCounter = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================
// 1. PRODUCTIVITY INTELLIGENCE & MISSING DATA
// ============================================================
describe('Stage 4 Productivity Intelligence', () => {
  it('handles missing historical data without fabricating metrics', () => {
    const today = getTodayStr();
    const goal = { id: 'g1', title: 'New Goal', deadline: addDaysLocal(today, 14), availableHoursPerDay: 2 };
    const intel = computeProductivityIntelligence(goal, [], [], today);
    const report = generateWeeklyReport(goal, [], [], today);

    expect(intel.analytics.completion.completionPercentage).toBe(0);
    expect(intel.focus.hasActualData).toBe(false);
    expect(intel.focus.durationAccuracyRatio).toBeNull();
    expect(intel.procrastination.hasFriction).toBe(false);
    expect(report.completionRate).toBeNull();
    expect(report.bestProductivityDay).toBeNull();
  });

  it('detects workload overload, repeated postponements, duration overruns, and deadline warnings', () => {
    const today = getTodayStr();
    const yesterday = addDaysLocal(today, -1);
    const goal = {
      id: 'g1',
      title: 'Placement Prep',
      deadline: addDaysLocal(today, 3), // within 5-day warning window
      availableHoursPerDay: 1, // 60m capacity
    };

    const tasks = [
      {
        id: 't1',
        title: 'Dynamic Programming',
        date: today,
        estimatedMinutes: 90, // > 60m capacity & >= 75m large task
        actualSeconds: 0,
        priority: 'high',
        status: 'pending',
        postponementCount: 3,
        dependencies: [],
      },
      {
        id: 't2',
        title: 'System Design Notes',
        date: yesterday, // overdue
        estimatedMinutes: 30,
        actualSeconds: 3000, // 50m actual vs 30m est (>1.25x)
        priority: 'high',
        status: 'completed',
        completedAt: `${today}T10:00:00.000Z`,
        postponementCount: 0,
        dependencies: [],
      },
    ];

    const intel = computeProductivityIntelligence(goal, tasks, [], today);
    expect(intel.workload.isOverloadedToday).toBe(true);
    expect(intel.workload.workloadUtilizationPct).toBe(150);
    expect(intel.focus.hasActualData).toBe(true);
    expect(intel.focus.durationAccuracyRatio).toBeGreaterThan(1.25);
    expect(intel.procrastination.repeatedlyPostponedTasks).toHaveLength(1);
    expect(intel.procrastination.overrunningTasks).toHaveLength(1);
    expect(intel.deadlineWarnings.length).toBeGreaterThan(0);
    expect(intel.recommendations.every((r) => Boolean(r.why) && Boolean(r.title))).toBe(true);
  });
});

// ============================================================
// 2. WEEKLY REPORT & PRIVACY MINIMIZATION
// ============================================================
describe('Stage 4 Weekly Report & Privacy Minimization', () => {
  it('computes weekly report and identifies best day only when >= 2 active completion days exist', () => {
    const today = getTodayStr();
    const yesterday = addDaysLocal(today, -1);
    const goal = { id: 'g1', title: 'Exam Prep', deadline: addDaysLocal(today, 10), availableHoursPerDay: 2 };

    const tasks = [
      {
        id: 't1',
        title: 'Day 1 Task A',
        date: yesterday,
        estimatedMinutes: 30,
        actualSeconds: 1800,
        status: 'completed',
        completedAt: `${yesterday}T12:00:00.000Z`,
        postponementCount: 0,
      },
      {
        id: 't2',
        title: 'Day 1 Task B',
        date: yesterday,
        estimatedMinutes: 30,
        actualSeconds: 1800,
        status: 'completed',
        completedAt: `${yesterday}T14:00:00.000Z`,
        postponementCount: 0,
      },
      {
        id: 't3',
        title: 'Day 2 Task',
        date: today,
        estimatedMinutes: 45,
        actualSeconds: 1200,
        status: 'completed',
        completedAt: `${today}T09:00:00.000Z`,
        postponementCount: 1,
        postponementHistory: [{ fromDate: yesterday, toDate: today, postponedAt: `${today}T08:00:00.000Z` }],
      },
    ];

    const report = generateWeeklyReport(goal, tasks, [], today);
    expect(report.tasksCompleted).toBe(3);
    expect(report.completionRate).toBe(100);
    expect(report.focusTimeSeconds).toBe(4800);
    expect(report.postponements).toBe(1);
    expect(report.bestProductivityDay).not.toBeNull();
    expect(report.bestProductivityDay.date).toBe(yesterday);
    expect(report.threeImprovements).toHaveLength(3);
  });

  it('minimizes chat context by stripping raw timestamps, descriptions, and internal IDs', () => {
    const today = getTodayStr();
    const goal = { id: 'secret-goal-id', title: 'Learn Rust', category: 'Learning', deadline: addDaysLocal(today, 10), availableHoursPerDay: 2 };
    const tasks = [
      {
        id: 'secret-task-id',
        title: 'Read Ownership Chapter',
        description: 'Private personal notes that should not be sent',
        date: today,
        estimatedMinutes: 45,
        priority: 'high',
        status: 'pending',
        timeSessions: [{ startedAt: '2026-11-25T10:00:00Z', durationSeconds: 600 }],
        postponementHistory: [{ fromDate: '2026-11-24', toDate: today, postponedAt: '2026-11-24T20:00:00Z' }],
      },
    ];

    const intel = computeProductivityIntelligence(goal, tasks, [], today);
    const report = generateWeeklyReport(goal, tasks, [], today);
    const minimized = buildMinimizedChatContext(goal, intel, report, tasks, today);
    const serialized = JSON.stringify(minimized);

    expect(serialized).not.toContain('secret-goal-id');
    expect(serialized).not.toContain('secret-task-id');
    expect(serialized).not.toContain('Private personal notes');
    expect(serialized).not.toContain('timeSessions');
    expect(serialized).not.toContain('postponementHistory');
    expect(minimized.topActionableTasks[0].title).toBe('Read Ownership Chapter');
  });
});

// ============================================================
// 3. AI CHAT CLIENT, BACKEND & DETERMINISTIC FALLBACK
// ============================================================
describe('Stage 4 AI Coach Chat & Fallback', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('sends minimized context to /api/coach/chat and falls back deterministically on failure', async () => {
    const today = getTodayStr();
    const goal = { id: 'g1', title: 'Interview Prep', deadline: addDaysLocal(today, 5), availableHoursPerDay: 2 };
    const tasks = [
      { id: 't1', title: 'Solve Graphs', date: today, estimatedMinutes: 45, priority: 'high', status: 'pending' },
    ];

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        reply: 'Focus on "Solve Graphs" first today.',
        provider: 'openrouter',
        model: 'mistralai/mistral-small-3.1-24b-instruct:free',
        isFallback: false,
      }),
    });

    const okRes = await askCoachChat({ question: 'What should I focus on today?', goal, tasks, milestones: [] });
    expect(okRes.provider).toBe('openrouter');
    expect(okRes.reply).toContain('Solve Graphs');

    // Simulated network failure -> deterministic fallback
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('Network down'));
    const fallbackRes = await askCoachChat({ question: 'What should I focus on today?', goal, tasks, milestones: [] });
    expect(fallbackRes.provider).toBe('deterministic');
    expect(fallbackRes.isFallback).toBe(true);
    expect(fallbackRes.reply).toContain('Solve Graphs');
  });

  it('backend handleCoachChat calls OpenRouter securely and falls back on 503', async () => {
    process.env.AI_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'sk-or-secret-test';
    process.env.OPENROUTER_MODEL = 'openrouter/free';

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'openrouter/free',
        choices: [{ message: { content: 'Start with your highest priority task.' } }],
      }),
    });

    const res = await handleCoachChat({
      question: 'What should I focus on today?',
      context: { summary: { pendingCount: 1 } },
    });
    expect(res.provider).toBe('openrouter');
    expect(res.reply).toBe('Start with your highest priority task.');
    expect(globalThis.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-or-secret-test');

    // 503 -> deterministic fallback
    globalThis.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 });
    const fb = await handleCoachChat({
      question: 'How productive was my week?',
      context: { weeklyReport: { tasksCompleted: 4, completionRate: 80, focusTimeFormatted: '2h' } },
    });
    expect(fb.provider).toBe('deterministic');
    expect(fb.isFallback).toBe(true);
    expect(fb.reply).toContain('4 task(s)');
  });

  it('deterministic coach reply answers questions using real metrics', () => {
    const today = getTodayStr();
    const goal = { id: 'g1', title: 'Goal', deadline: addDaysLocal(today, 7), availableHoursPerDay: 2 };
    const tasks = [{ id: 't1', title: 'Mock Interview', date: today, estimatedMinutes: 60, priority: 'high', status: 'pending' }];
    const intel = computeProductivityIntelligence(goal, tasks, [], today);
    const report = generateWeeklyReport(goal, tasks, [], today);

    const reply = generateDeterministicCoachReply('What should I focus on today?', goal, intel, report, tasks, today);
    expect(reply).toContain('Mock Interview');
  });
});

// ============================================================
// 4. COACH PAGE UI INTEGRATION
// ============================================================
describe('Stage 4 Coach Page UI', () => {
  it('renders AI Coach dashboard, weekly report, recommendations, and interactive chat', async () => {
    const today = getTodayStr();
    saveGoal({
      title: 'Crack Tech Placements',
      category: 'Placements',
      deadline: addDaysLocal(today, 10),
      availableHoursPerDay: 2,
      skillLevel: 'intermediate',
    });
    const t1 = addTask({ title: 'Practice Binary Search', date: today, estimatedMinutes: 45, priority: 'high' });
    completeTask(t1.id);
    addTask({ title: 'System Design Primer', date: today, estimatedMinutes: 60, priority: 'medium' });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        reply: 'Next up is "System Design Primer" (60m).',
        provider: 'openrouter',
        model: 'mistralai/mistral-small-3.1-24b-instruct:free',
        isFallback: false,
      }),
    });

    render(
      <MemoryRouter>
        <Coach />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { level: 1, name: /AI Coach/i })).toBeInTheDocument();
    expect(screen.getByText('Personalized Recommendations')).toBeInTheDocument();
    expect(screen.getByText('Weekly Productivity Report')).toBeInTheDocument();
    expect(screen.getByText('Ask Your AI Coach')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'What should I focus on today?' }));

    await waitFor(() => {
      expect(screen.getByText('Next up is "System Design Primer" (60m).')).toBeInTheDocument();
    });
  });
});
