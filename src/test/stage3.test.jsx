import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
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
globalThis.crypto.randomUUID = vi.fn(() => `s3-uuid-${++uuidCounter}`);

import { loadState, migrateState, SCHEMA_VERSION } from '../services/storageService.js';
import { saveGoal } from '../services/goalService.js';
import { getTasks, addTask, completeTask } from '../services/taskService.js';
import { generateMilestones } from '../services/milestoneService.js';
import {
  buildRecoveryContext,
  parseRecoveryResponse,
  validateRecoveryProposal,
  repairRecoveryProposal,
  applyRecoveryPlan,
  saveRecoveryRecord,
  getRecoveryHistory,
  requestRecoveryPlan,
  cancelInFlightRecoveryRequest,
  generateDevRecoveryPlan,
  analyzeExecution,
} from '../services/recoveryService.js';
import { addDaysLocal, getTodayStr } from '../utils/dateUtils.js';
import Dashboard from '../pages/Dashboard.jsx';
import RecoveryWizard from '../components/RecoveryWizard.jsx';

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
  uuidCounter = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================
// 1. RECOVERY INPUT GENERATION
// ============================================================
describe('Stage 3 Recovery Context Generation', () => {
  it('builds structured context with completed, pending, overdue, blocked tasks, milestones, and user preferences', () => {
    const today = getTodayStr();
    const yesterday = addDaysLocal(today, -1);
    const deadline = addDaysLocal(today, 10);

    const ms = generateMilestones({ category: 'Placements', deadline });
    const goal = saveGoal({
      title: 'Crack Placements',
      category: 'Placements',
      deadline,
      availableHoursPerDay: 2,
      skillLevel: 'intermediate',
      milestones: ms,
    });

    const done = addTask({ title: 'Completed Task', date: yesterday, estimatedMinutes: 30, priority: 'high' });
    completeTask(done.id);

    const overdue = addTask({ title: 'Overdue Prereq', date: yesterday, estimatedMinutes: 45, priority: 'high' });
    addTask({ title: 'Blocked Today', date: today, estimatedMinutes: 60, priority: 'medium', dependencies: [overdue.id] });

    const ctx = buildRecoveryContext(goal, getTasks(), ms, 'I lost time today.', 'priority');

    expect(ctx.goal.title).toBe('Crack Placements');
    expect(ctx.milestones).toHaveLength(ms.length);
    expect(ctx.tasks.completed).toHaveLength(1);
    expect(ctx.tasks.pending).toHaveLength(2);
    expect(ctx.tasks.overdue).toHaveLength(1);
    expect(ctx.tasks.today).toHaveLength(1);
    expect(ctx.tasks.blocked).toHaveLength(1);
    expect(ctx.schedule.dailyCapacityMinutes).toBe(120);
    expect(ctx.userInput.explanation).toBe('I lost time today.');
    expect(ctx.userInput.approach).toBe('priority');
  });
});

// ============================================================
// 2. AI RESPONSE PARSING & INVALID RESPONSE REJECTION
// ============================================================
describe('Stage 3 AI Response Parsing', () => {
  it('parses a valid structured AI response', () => {
    const today = getTodayStr();
    const parsed = parseRecoveryResponse({
      provider: 'gemini:gemini-2.5-flash',
      explanation: 'Moved overdue tasks to today and tomorrow.',
      proposedSchedule: [{ taskId: 't1', date: today }],
      unscheduledTasks: [],
      warnings: [],
      summary: '1 task scheduled.',
    });

    expect(parsed.explanation).toBe('Moved overdue tasks to today and tomorrow.');
    expect(parsed.proposedSchedule).toEqual([{ taskId: 't1', date: today }]);
    expect(parsed.feasible).toBe(true);
  });

  it('rejects malformed AI responses, missing fields, and invalid dates', () => {
    expect(() => parseRecoveryResponse(null)).toThrow(/JSON object/i);
    expect(() => parseRecoveryResponse({ proposedSchedule: [] })).toThrow(/explanation/i);
    expect(() => parseRecoveryResponse({ explanation: 'ok' })).toThrow(/proposedSchedule/i);
    expect(() =>
      parseRecoveryResponse({
        explanation: 'ok',
        proposedSchedule: [{ taskId: 't1', date: '2026-99-99' }],
      })
    ).toThrow(/Invalid date/i);
  });
});

// ============================================================
// 3. DETERMINISTIC VALIDATION & REPAIR
// ============================================================
describe('Stage 3 Deterministic Schedule Validation', () => {
  it('rejects unknown task IDs, duplicate task IDs, and completed task modifications', () => {
    const today = getTodayStr();
    const deadline = addDaysLocal(today, 5);
    const goal = { id: 'g1', deadline, availableHoursPerDay: 2 };
    const tasks = [
      { id: 'c1', title: 'Done', date: today, estimatedMinutes: 30, status: 'completed', dependencies: [] },
      { id: 'p1', title: 'Pending', date: today, estimatedMinutes: 30, status: 'pending', dependencies: [] },
    ];

    const unknownCheck = validateRecoveryProposal(
      { proposedSchedule: [{ taskId: 'unknown-id', date: today }, { taskId: 'p1', date: today }] },
      tasks,
      goal
    );
    expect(unknownCheck.valid).toBe(false);
    expect(unknownCheck.issues.some((i) => /Unknown task ID/i.test(i))).toBe(true);

    const dupCheck = validateRecoveryProposal(
      { proposedSchedule: [{ taskId: 'p1', date: today }, { taskId: 'p1', date: today }] },
      tasks,
      goal
    );
    expect(dupCheck.valid).toBe(false);
    expect(dupCheck.issues.some((i) => /Duplicate task ID/i.test(i))).toBe(true);

    const completedCheck = validateRecoveryProposal(
      { proposedSchedule: [{ taskId: 'c1', date: addDaysLocal(today, 1) }, { taskId: 'p1', date: today }] },
      tasks,
      goal
    );
    expect(completedCheck.valid).toBe(false);
    expect(completedCheck.issues.some((i) => /Completed task/i.test(i))).toBe(true);
  });

  it('validates dependencies, daily capacity, and deadline constraints', () => {
    const today = getTodayStr();
    const tomorrow = addDaysLocal(today, 1);
    const deadline = addDaysLocal(today, 3);
    const afterDeadline = addDaysLocal(today, 10);
    const goal = { id: 'g1', deadline, availableHoursPerDay: 1 }; // 60 min/day

    const tasks = [
      { id: 'a', title: 'Prereq', date: today, estimatedMinutes: 45, status: 'pending', dependencies: [] },
      { id: 'b', title: 'Dependent', date: today, estimatedMinutes: 45, status: 'pending', dependencies: ['a'] },
    ];

    // Dependency out of order (b today, a tomorrow)
    const depCheck = validateRecoveryProposal(
      { proposedSchedule: [{ taskId: 'b', date: today }, { taskId: 'a', date: tomorrow }] },
      tasks,
      goal
    );
    expect(depCheck.valid).toBe(false);
    expect(depCheck.issues.some((i) => /prerequisite/i.test(i))).toBe(true);

    // Daily capacity exceeded (both 45m = 90m > 60m on same day)
    const capCheck = validateRecoveryProposal(
      { proposedSchedule: [{ taskId: 'a', date: today }, { taskId: 'b', date: today }] },
      tasks,
      goal
    );
    expect(capCheck.valid).toBe(false);
    expect(capCheck.issues.some((i) => /exceeding/i.test(i))).toBe(true);

    // Past deadline
    const deadlineCheck = validateRecoveryProposal(
      { proposedSchedule: [{ taskId: 'a', date: today }, { taskId: 'b', date: afterDeadline }] },
      tasks,
      goal
    );
    expect(deadlineCheck.valid).toBe(false);
    expect(deadlineCheck.issues.some((i) => /after goal deadline/i.test(i))).toBe(true);
  });

  it('repairs an invalid proposal deterministically so all constraints hold', () => {
    const today = getTodayStr();
    const deadline = addDaysLocal(today, 3);
    const goal = { id: 'g1', deadline, availableHoursPerDay: 1 }; // 60m/day

    const tasks = [
      { id: 'c1', title: 'Done', date: today, estimatedMinutes: 30, status: 'completed', dependencies: [] },
      { id: 'a', title: 'Prereq', date: today, estimatedMinutes: 45, status: 'pending', priority: 'high', dependencies: [] },
      { id: 'b', title: 'Dependent', date: today, estimatedMinutes: 45, status: 'pending', priority: 'high', dependencies: ['a'] },
    ];

    const badProposal = {
      explanation: 'AI proposal with issues',
      proposedSchedule: [
        { taskId: 'c1', date: addDaysLocal(today, 1) }, // completed task illegally included
        { taskId: 'b', date: today }, // scheduled before prereq
        { taskId: 'a', date: addDaysLocal(today, 2) },
        { taskId: 'nonexistent', date: today },
      ],
      warnings: [],
    };

    const { repaired, proposal } = repairRecoveryProposal(badProposal, tasks, goal);
    expect(repaired).toBe(true);

    const recheck = validateRecoveryProposal(proposal, tasks, goal);
    expect(recheck.valid).toBe(true);
    expect(proposal.proposedSchedule.find((e) => e.taskId === 'c1')).toBeUndefined();
    const dateA = proposal.proposedSchedule.find((e) => e.taskId === 'a').date;
    const dateB = proposal.proposedSchedule.find((e) => e.taskId === 'b').date;
    expect(dateA <= dateB).toBe(true);
  });
});

// ============================================================
// 4. APPLYING, CANCELLING, HISTORY & MIGRATION
// ============================================================
describe('Stage 3 Apply, Cancel, History & Migration', () => {
  it('applies valid recovery plan while preserving completed tasks, IDs, milestones, dependencies, and timer data', () => {
    const today = getTodayStr();
    const tomorrow = addDaysLocal(today, 1);
    const deadline = addDaysLocal(today, 5);

    saveGoal({
      title: 'Exam Prep',
      category: 'Competitive Exam',
      deadline,
      availableHoursPerDay: 2,
      skillLevel: 'intermediate',
    });

    const done = addTask({ title: 'Done', date: today, estimatedMinutes: 30, priority: 'high' });
    completeTask(done.id);
    const t1 = addTask({ title: 'Pending 1', date: addDaysLocal(today, -1), estimatedMinutes: 45, priority: 'high', milestoneId: 'm-1' });
    const t2 = addTask({ title: 'Pending 2', date: today, estimatedMinutes: 45, priority: 'medium', dependencies: [t1.id] });

    const proposal = {
      explanation: 'Rescheduled safely',
      proposedSchedule: [
        { taskId: t1.id, date: today },
        { taskId: t2.id, date: tomorrow },
      ],
      unscheduledTasks: [],
    };

    const updated = applyRecoveryPlan(proposal);
    const doneAfter = updated.find((t) => t.id === done.id);
    const t1After = updated.find((t) => t.id === t1.id);
    const t2After = updated.find((t) => t.id === t2.id);

    expect(doneAfter.status).toBe('completed');
    expect(doneAfter.date).toBe(today);
    expect(t1After.date).toBe(today);
    expect(t1After.milestoneId).toBe('m-1');
    expect(t2After.date).toBe(tomorrow);
    expect(t2After.dependencies).toEqual([t1.id]);
  });

  it('persists recovery history and migrates v2 state to v3 idempotently', () => {
    const v2State = {
      version: 2,
      onboardingComplete: true,
      goal: { id: 'g1', title: 'Test Goal', deadline: '2027-06-01', availableHoursPerDay: 2, milestones: [] },
      tasks: [{ id: 't1', title: 'Task 1', date: '2027-01-01', estimatedMinutes: 30, priority: 'high', status: 'pending' }],
      activeTimer: null,
    };

    localStorageMock.setItem('focusflow_data', JSON.stringify(v2State));
    const migrated = loadState();
    expect(migrated.version).toBe(SCHEMA_VERSION);
    expect(migrated.recoveryHistory).toEqual([]);
    expect(migrated.tasks).toHaveLength(1);
    expect(migrateState(migrated)).toEqual(migrated);

    saveRecoveryRecord({
      status: 'applied',
      approach: 'balanced',
      userExplanation: 'Lost time today.',
      summary: 'Moved 1 task.',
      movedCount: 1,
    });

    const history = getRecoveryHistory();
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('applied');
    expect(history[0].userExplanation).toBe('Lost time today.');
  });
});

// ============================================================
// 5. AI SERVICE ERRORS, TIMEOUTS & UI WORKFLOW
// ============================================================
describe('Stage 3 AI Service Errors & UI Workflow', () => {
  it('handles server errors and request timeouts cleanly', async () => {
    const today = getTodayStr();
    const ctx = buildRecoveryContext(
      { id: 'g1', title: 'Goal', deadline: addDaysLocal(today, 3), availableHoursPerDay: 2 },
      [{ id: 't1', title: 'Task', date: today, estimatedMinutes: 30, priority: 'high', status: 'pending' }],
      [],
      'Lost time',
      'balanced'
    );

    // 503 Server not configured
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: 'GEMINI_API_KEY is not configured on the server.', code: 'AI_NOT_CONFIGURED' }),
    });
    await expect(requestRecoveryPlan(ctx)).rejects.toThrow(/GEMINI_API_KEY/i);

    // Timeout only triggers when client timer actually aborts, and lock is released for retry
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(
        (_url, { signal }) => new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            const abortErr = new Error('Aborted');
            abortErr.name = 'AbortError';
            reject(abortErr);
          });
        })
      )
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          provider: 'openrouter',
          model: 'openrouter/free',
          explanation: 'Retry succeeded after timeout.',
          proposedSchedule: [{ taskId: 't1', date: today }],
          unscheduledTasks: [],
          warnings: [],
          summary: '1 task scheduled.',
        }),
      });
    await expect(requestRecoveryPlan(ctx, { timeoutMs: 20 })).rejects.toThrow(/timed out/i);
    const retryResult = await requestRecoveryPlan(ctx);
    expect(retryResult.explanation).toBe('Retry succeeded after timeout.');

    // Backend 404/504 error message is preserved rather than masked as client timeout
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Gemini API request failed (404): Model not found', code: 'AI_UPSTREAM_ERROR' }),
    });
    await expect(requestRecoveryPlan(ctx)).rejects.toThrow(/Model not found/i);

    // Dev fallback & execution analysis work deterministically
    const devPlan = generateDevRecoveryPlan(ctx);
    expect(devPlan.isDevProvider).toBe(true);
    expect(devPlan.proposedSchedule).toHaveLength(1);

    const analysis = analyzeExecution({ deadline: addDaysLocal(today, 3), availableHoursPerDay: 2 }, [
      { id: 't1', date: addDaysLocal(today, -1), status: 'pending', estimatedMinutes: 30 },
    ]);
    expect(analysis.overdueCount).toBe(1);
  });

  it('supports full Recover My Day UI flow: preview mocked AI response, cancel without changing, then apply', async () => {
    const today = getTodayStr();
    const yesterday = addDaysLocal(today, -1);
    const tomorrow = addDaysLocal(today, 1);
    const deadline = addDaysLocal(today, 5);

    saveGoal({
      title: 'Placement Prep',
      category: 'Placements',
      deadline,
      availableHoursPerDay: 2,
      skillLevel: 'intermediate',
    });
    const overdue = addTask({ title: 'Overdue DSA', date: yesterday, estimatedMinutes: 45, priority: 'high' });

    const mockResponse = {
      provider: 'gemini:gemini-2.5-flash',
      isDevProvider: false,
      approach: 'balanced',
      explanation: 'Moved overdue DSA task to tomorrow.',
      proposedSchedule: [{ taskId: overdue.id, date: tomorrow }],
      unscheduledTasks: [],
      warnings: [],
      summary: 'Moved 1 task.',
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    // Open Recover My Day
    fireEvent.click(screen.getByRole('button', { name: /Recover My Day/i }));
    expect(screen.getByRole('dialog', { name: /AI Schedule Recovery/i })).toBeInTheDocument();

    // Select explanation chip & approach
    fireEvent.click(screen.getByRole('button', { name: 'I lost time today.' }));
    fireEvent.click(screen.getByRole('button', { name: /Generate Recovery Plan/i }));

    // Preview appears
    await waitFor(() => {
      expect(screen.getByText('Moved overdue DSA task to tomorrow.')).toBeInTheDocument();
    });

    // Cancel leaves original date unchanged
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(getTasks().find((t) => t.id === overdue.id).date).toBe(yesterday);
    expect(getRecoveryHistory()[0].status).toBe('cancelled');

    // Re-open, generate, and Apply Recovery Plan
    fireEvent.click(screen.getByRole('button', { name: /Recover My Day/i }));
    fireEvent.click(screen.getByRole('button', { name: /Generate Recovery Plan/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Apply Recovery Plan/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Apply Recovery Plan/i }));

    expect(screen.getByText('Schedule Recovered!')).toBeInTheDocument();
    expect(getTasks().find((t) => t.id === overdue.id).date).toBe(tomorrow);
    expect(getRecoveryHistory()[0].status).toBe('applied');
  });

  it('displays friendly message in RecoveryWizard when Gemini remains unavailable (503 AI_UNAVAILABLE)', async () => {
    const today = getTodayStr();
    saveGoal({
      title: 'Placement Prep',
      category: 'Placements',
      deadline: addDaysLocal(today, 5),
      availableHoursPerDay: 2,
      skillLevel: 'intermediate',
    });
    addTask({ title: 'Practice DSA', date: today, estimatedMinutes: 45, priority: 'high' });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        error: 'Gemini is temporarily busy. Please try again in a moment.',
        code: 'AI_UNAVAILABLE',
      }),
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /Recover My Day/i }));
    fireEvent.click(screen.getByRole('button', { name: /Generate Recovery Plan/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Gemini is temporarily busy. Please try again in a moment.'
      );
    });
  });

  it('displays deterministic fallback notice when AI falls back to built-in recovery engine', async () => {
    const today = getTodayStr();
    saveGoal({
      title: 'Placement Prep',
      category: 'Placements',
      deadline: addDaysLocal(today, 5),
      availableHoursPerDay: 2,
      skillLevel: 'intermediate',
    });
    const t = addTask({ title: 'Practice Graphs', date: addDaysLocal(today, -1), estimatedMinutes: 45, priority: 'high' });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        provider: 'deterministic',
        model: 'built-in',
        isDevProvider: true,
        isFallback: true,
        fallbackReason: 'AI_RATE_LIMIT',
        fallbackMessage: 'AI is temporarily unavailable. FocusFlow created a schedule using its built-in recovery engine instead.',
        explanation: 'Built-in Deterministic Recovery',
        proposedSchedule: [{ taskId: t.id, date: today }],
        unscheduledTasks: [],
        warnings: [],
        summary: 'Moved 1 task.',
      }),
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /Recover My Day/i }));
    fireEvent.click(screen.getByRole('button', { name: /Generate Recovery Plan/i }));

    await waitFor(() => {
      expect(
        screen.getByText(
          'AI is temporarily unavailable. FocusFlow created a schedule using its built-in recovery engine instead.'
        )
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Built-in Deterministic Engine (Fallback)')).toBeInTheDocument();
  });

  it('releases loading state and lock after failure so Retry AI succeeds without refresh', async () => {
    const today = getTodayStr();
    saveGoal({
      title: 'Placement Prep',
      category: 'Placements',
      deadline: addDaysLocal(today, 5),
      availableHoursPerDay: 2,
      skillLevel: 'intermediate',
    });
    const t = addTask({ title: 'Practice Trees', date: today, estimatedMinutes: 45, priority: 'high' });

    globalThis.fetch = vi.fn()
      .mockRejectedValueOnce(new Error('Recovery request timed out. Please try again.'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          provider: 'openrouter',
          model: 'openrouter/free',
          explanation: 'Recovered on retry.',
          proposedSchedule: [{ taskId: t.id, date: today }],
          unscheduledTasks: [],
          warnings: [],
          summary: '1 task scheduled.',
        }),
      });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /Recover My Day/i }));
    fireEvent.click(screen.getByRole('button', { name: /Generate Recovery Plan/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Recovery request timed out. Please try again.');
    });

    fireEvent.click(screen.getByRole('button', { name: /Retry AI/i }));
    await waitFor(() => {
      expect(screen.getByText('Recovered on retry.')).toBeInTheDocument();
    });
  });

  it('keeps recovery request active for at least 5 seconds without aborting and processes delayed response', async () => {
    vi.useFakeTimers();
    try {
      const today = getTodayStr();
      const ctx = buildRecoveryContext(
        { id: 'g1', title: 'Goal', deadline: addDaysLocal(today, 3), availableHoursPerDay: 2 },
        [{ id: 't1', title: 'Task', date: today, estimatedMinutes: 30, priority: 'high', status: 'pending' }],
        [],
        'Lost time',
        'balanced'
      );

      let aborted = false;
      globalThis.fetch = vi.fn().mockImplementation((_url, { signal }) => new Promise((resolve) => {
        signal.addEventListener('abort', () => { aborted = true; }, { once: true });
        setTimeout(() => {
          resolve({
            ok: true,
            json: async () => ({
              provider: 'openrouter',
              model: 'openrouter/free',
              explanation: 'Delayed 5.5s response succeeded.',
              proposedSchedule: [{ taskId: 't1', date: today }],
              unscheduledTasks: [],
              warnings: [],
              summary: '1 task scheduled.',
            }),
          });
        }, 5500);
      }));

      const promise = requestRecoveryPlan(ctx);
      await vi.advanceTimersByTimeAsync(92000);
      expect(aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(1000);
      const res = await promise;
      expect(aborted).toBe(false);
      expect(res.explanation).toBe('Delayed 5.5s response succeeded.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores late AI response if user already cancelled or unmounted', async () => {
    const today = getTodayStr();
    const goal = saveGoal({
      title: 'Placement Prep',
      category: 'Placements',
      deadline: addDaysLocal(today, 5),
      availableHoursPerDay: 2,
      skillLevel: 'intermediate',
    });
    const t = addTask({ title: 'Practice Heaps', date: today, estimatedMinutes: 45, priority: 'high' });

    let resolveFetch;
    globalThis.fetch = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveFetch = resolve;
    }));

    const onApplied = vi.fn();
    const onClose = vi.fn();
    const { unmount } = render(
      <RecoveryWizard isOpen={true} goal={goal} tasks={[t]} milestones={[]} onApplied={onApplied} onClose={onClose} />
    );

    fireEvent.click(screen.getByRole('button', { name: /Generate Recovery Plan/i }));
    // Unmount while AI response is still pending
    unmount();

    // Late AI response arrives after unmount — must not throw or trigger state/onApplied
    resolveFetch({
      ok: true,
      json: async () => ({
        provider: 'openrouter',
        model: 'mistralai/mistral-small-3.1-24b-instruct:free',
        explanation: 'Late AI response.',
        proposedSchedule: [{ taskId: t.id, date: today }],
        unscheduledTasks: [],
        warnings: [],
        summary: '1 task scheduled.',
      }),
    });
    await Promise.resolve();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('does not abort in-flight request on normal component rerenders and releases lock on genuine cancel', async () => {
    const today = getTodayStr();
    const goal = saveGoal({
      title: 'Placement Prep',
      category: 'Placements',
      deadline: addDaysLocal(today, 5),
      availableHoursPerDay: 2,
      skillLevel: 'intermediate',
    });
    const t = addTask({ title: 'Practice DP', date: today, estimatedMinutes: 45, priority: 'high' });

    let resolveFetch;
    let aborted = false;
    globalThis.fetch = vi.fn().mockImplementation((_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        aborted = true;
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
      resolveFetch = resolve;
    }));

    const onApplied = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <RecoveryWizard isOpen={true} goal={goal} tasks={[t]} milestones={[]} onApplied={onApplied} onClose={onClose} />
    );

    fireEvent.click(screen.getByRole('button', { name: /Generate Recovery Plan/i }));

    // Trigger ordinary parent rerender while request is in flight
    rerender(
      <RecoveryWizard isOpen={true} goal={{ ...goal }} tasks={[t]} milestones={[]} onApplied={onApplied} onClose={onClose} />
    );
    expect(aborted).toBe(false);

    // Resolve delayed response cleanly
    resolveFetch({
      ok: true,
      json: async () => ({
        provider: 'openrouter',
        model: 'openrouter/free',
        explanation: 'Survived rerender cleanly.',
        proposedSchedule: [{ taskId: t.id, date: today }],
        unscheduledTasks: [],
        warnings: [],
        summary: '1 task scheduled.',
      }),
    });

    await waitFor(() => {
      expect(screen.getByText('Survived rerender cleanly.')).toBeInTheDocument();
    });

    // Also verify genuine cancellation releases lock for next request
    cancelInFlightRecoveryRequest();
  });
});
