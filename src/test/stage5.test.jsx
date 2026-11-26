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
globalThis.crypto.randomUUID = vi.fn(() => `s5-uuid-${++uuidCounter}`);

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
  isDemoMode,
  loadDemoWorkspace,
  resetDemoWorkspace,
  exitDemoWorkspace,
} from '../services/demoService.js';
import { addDaysLocal, getTodayStr } from '../utils/dateUtils.js';
import Dashboard from '../pages/Dashboard.jsx';
import Analytics from '../pages/Analytics.jsx';
import Coach from '../pages/Coach.jsx';

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
  uuidCounter = 0;
});

describe('Stage 5 Demo Mode Safety & Readiness', () => {
  it('loads realistic demo workspace only when explicitly triggered and never silently overwrites real user data', () => {
    // Empty workspace -> demo loads cleanly
    const res = loadDemoWorkspace();
    expect(res.loaded).toBe(true);
    expect(isDemoMode()).toBe(true);
    expect(getGoal().title).toBe('Crack Software Engineering Placements');
    expect(getTasks().length).toBeGreaterThanOrEqual(7);

    // Exit demo clears demo data
    const exited = exitDemoWorkspace();
    expect(exited.exited).toBe(true);
    expect(isDemoMode()).toBe(false);
    expect(getGoal()).toBeNull();

    // Real user creates a goal -> loadDemoWorkspace must NOT overwrite without force
    saveGoal({
      title: 'My Real Exam Goal',
      category: 'Competitive Exam',
      deadline: addDaysLocal(getTodayStr(), 10),
      availableHoursPerDay: 2,
      skillLevel: 'intermediate',
    });
    addTask({ title: 'My Real Task', date: getTodayStr(), estimatedMinutes: 30 });

    const blockedRes = loadDemoWorkspace();
    expect(blockedRes.loaded).toBe(false);
    expect(blockedRes.requiresConfirmation).toBe(true);
    expect(getGoal().title).toBe('My Real Exam Goal');
    expect(getTasks()).toHaveLength(1);

    // exitDemoWorkspace does NOT delete real user data
    expect(exitDemoWorkspace().exited).toBe(false);
    expect(getGoal().title).toBe('My Real Exam Goal');
  });

  it('allows resetting active demo workspace safely', () => {
    loadDemoWorkspace();
    addTask({ title: 'Extra Temporary Task', date: getTodayStr(), estimatedMinutes: 15 });
    expect(getTasks().length).toBe(8);

    resetDemoWorkspace();
    expect(isDemoMode()).toBe(true);
    expect(getTasks().length).toBe(7);
  });

  it('supports loading and resetting interactive demo from Dashboard UI', () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /Load Interactive Demo/i }));
    expect(screen.getByRole('region', { name: 'Sample Demo Workspace' })).toBeInTheDocument();
    expect(screen.getByText('Crack Software Engineering Placements')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Reset Demo/i }));
    expect(screen.getByText('Crack Software Engineering Placements')).toBeInTheDocument();
  });

  it('renders Dashboard, Analytics, and Coach cleanly when task list is empty', () => {
    saveGoal({
      title: 'Empty Tasks Goal',
      category: 'Learning',
      deadline: addDaysLocal(getTodayStr(), 14),
      availableHoursPerDay: 2,
      skillLevel: 'beginner',
    });

    const { unmount: unmountDash } = render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );
    expect(screen.getByText('No tasks scheduled for today')).toBeInTheDocument();
    unmountDash();

    const { unmount: unmountAnalytics } = render(
      <MemoryRouter>
        <Analytics />
      </MemoryRouter>
    );
    expect(screen.getByText('No tasks to analyze yet')).toBeInTheDocument();
    unmountAnalytics();

    render(
      <MemoryRouter>
        <Coach />
      </MemoryRouter>
    );
    expect(screen.getByText('Personalized Recommendations')).toBeInTheDocument();
  });
});
