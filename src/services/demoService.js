import { clearState, loadState, saveState, SCHEMA_VERSION } from './storageService.js';
import { addDaysLocal, getTodayStr } from '../utils/dateUtils.js';

const DEMO_MODE_KEY = 'focusflow_demo_mode';

export function isDemoMode() {
  try {
    return localStorage.getItem(DEMO_MODE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function hasRealUserData() {
  if (isDemoMode()) return false;
  const state = loadState();
  return Boolean(state.goal) || (Array.isArray(state.tasks) && state.tasks.length > 0);
}

/**
 * Build a realistic demonstration workspace anchored to today's local date.
 */
export function buildDemoWorkspaceState(today = getTodayStr()) {
  const yesterday = addDaysLocal(today, -1);
  const twoDaysAgo = addDaysLocal(today, -2);
  const tomorrow = addDaysLocal(today, 1);
  const deadline = addDaysLocal(today, 18);
  const nowIso = new Date().toISOString();

  const ms1Id = 'demo-ms-1';
  const ms2Id = 'demo-ms-2';
  const ms3Id = 'demo-ms-3';

  const t1Id = 'demo-task-1';
  const t2Id = 'demo-task-2';
  const t3Id = 'demo-task-3';
  const t4Id = 'demo-task-4';
  const t5Id = 'demo-task-5';
  const t6Id = 'demo-task-6';
  const t7Id = 'demo-task-7';

  const yesterdayIso = new Date(yesterday + 'T15:30:00').toISOString();
  const twoDaysAgoIso = new Date(twoDaysAgo + 'T11:00:00').toISOString();

  return {
    version: SCHEMA_VERSION,
    onboardingComplete: true,
    activeTimer: null,
    goal: {
      id: 'demo-goal-1',
      title: 'Crack Software Engineering Placements',
      category: 'Placements',
      deadline,
      availableHoursPerDay: 3,
      skillLevel: 'intermediate',
      description: 'Sample demo goal: DSA, System Design, and mock interviews.',
      milestones: [
        {
          id: ms1Id,
          title: 'Core Data Structures & Patterns',
          description: 'Arrays, hashing, two pointers, and recursion.',
          targetDate: addDaysLocal(today, 5),
          status: 'completed',
          createdAt: twoDaysAgoIso,
        },
        {
          id: ms2Id,
          title: 'Trees, Graphs & Dynamic Programming',
          description: 'Master BFS/DFS, shortest paths, and memoization.',
          targetDate: addDaysLocal(today, 12),
          status: 'pending',
          createdAt: twoDaysAgoIso,
        },
        {
          id: ms3Id,
          title: 'Mock Interviews & System Design',
          description: 'Timed interviews and architecture reviews.',
          targetDate: deadline,
          status: 'pending',
          createdAt: twoDaysAgoIso,
        },
      ],
      createdAt: twoDaysAgoIso,
      updatedAt: nowIso,
    },
    tasks: [
      {
        id: t1Id,
        title: 'Review Sliding Window & Hashing Patterns',
        description: 'Sample completed task with tracked timer session.',
        date: twoDaysAgo,
        estimatedMinutes: 45,
        priority: 'high',
        status: 'completed',
        actualSeconds: 2520, // 42m
        timeSessions: [
          {
            startedAt: twoDaysAgoIso,
            endedAt: twoDaysAgoIso,
            durationSeconds: 2520,
          },
        ],
        dependencies: [],
        postponementCount: 0,
        postponementHistory: [],
        milestoneId: ms1Id,
        createdAt: twoDaysAgoIso,
        updatedAt: twoDaysAgoIso,
        completedAt: twoDaysAgoIso,
      },
      {
        id: t2Id,
        title: 'Solve 3 Binary Tree Traversal Problems',
        description: 'Completed yesterday with focus timer.',
        date: yesterday,
        estimatedMinutes: 60,
        priority: 'high',
        status: 'completed',
        actualSeconds: 3900, // 65m
        timeSessions: [
          {
            startedAt: yesterdayIso,
            endedAt: yesterdayIso,
            durationSeconds: 3900,
          },
        ],
        dependencies: [t1Id],
        postponementCount: 0,
        postponementHistory: [],
        milestoneId: ms2Id,
        createdAt: twoDaysAgoIso,
        updatedAt: yesterdayIso,
        completedAt: yesterdayIso,
      },
      {
        id: t3Id,
        title: 'Implement Graph BFS & Shortest Path',
        description: 'Overdue prerequisite task blocking DFS/Topological Sort.',
        date: yesterday,
        estimatedMinutes: 60,
        priority: 'high',
        status: 'pending',
        actualSeconds: 0,
        timeSessions: [],
        dependencies: [],
        postponementCount: 1,
        postponementHistory: [
          { fromDate: twoDaysAgo, toDate: yesterday, postponedAt: twoDaysAgoIso },
        ],
        milestoneId: ms2Id,
        createdAt: twoDaysAgoIso,
        updatedAt: yesterdayIso,
        completedAt: null,
      },
      {
        id: t4Id,
        title: 'Dynamic Programming — Knapsack & Subsequences',
        description: 'Repeatedly postponed task ready for Coach insights.',
        date: yesterday,
        estimatedMinutes: 75,
        priority: 'high',
        status: 'pending',
        actualSeconds: 0,
        timeSessions: [],
        dependencies: [],
        postponementCount: 2,
        postponementHistory: [
          { fromDate: twoDaysAgo, toDate: yesterday, postponedAt: twoDaysAgoIso },
          { fromDate: yesterday, toDate: yesterday, postponedAt: yesterdayIso },
        ],
        milestoneId: ms2Id,
        createdAt: twoDaysAgoIso,
        updatedAt: yesterdayIso,
        completedAt: null,
      },
      {
        id: t5Id,
        title: 'Topological Sort & Cycle Detection Practice',
        description: 'Blocked until Graph BFS & Shortest Path is completed.',
        date: today,
        estimatedMinutes: 45,
        priority: 'medium',
        status: 'pending',
        actualSeconds: 0,
        timeSessions: [],
        dependencies: [t3Id],
        postponementCount: 0,
        postponementHistory: [],
        milestoneId: ms2Id,
        createdAt: yesterdayIso,
        updatedAt: yesterdayIso,
        completedAt: null,
      },
      {
        id: t6Id,
        title: 'Review OS Concurrency & Deadlocks',
        description: 'Ready to start today with the focus timer.',
        date: today,
        estimatedMinutes: 45,
        priority: 'high',
        status: 'pending',
        actualSeconds: 0,
        timeSessions: [],
        dependencies: [],
        postponementCount: 0,
        postponementHistory: [],
        milestoneId: ms3Id,
        createdAt: yesterdayIso,
        updatedAt: yesterdayIso,
        completedAt: null,
      },
      {
        id: t7Id,
        title: 'System Design: URL Shortener & Caching',
        description: 'Scheduled for tomorrow.',
        date: tomorrow,
        estimatedMinutes: 60,
        priority: 'medium',
        status: 'pending',
        actualSeconds: 0,
        timeSessions: [],
        dependencies: [],
        postponementCount: 0,
        postponementHistory: [],
        milestoneId: ms3Id,
        createdAt: yesterdayIso,
        updatedAt: yesterdayIso,
        completedAt: null,
      },
    ],
    recoveryHistory: [
      {
        id: 'demo-rec-1',
        timestamp: yesterdayIso,
        status: 'applied',
        approach: 'balanced',
        userExplanation: 'Unexpected lab assignment took 2 hours.',
        explanation: 'Balanced recovery shifted lower-priority items to keep core DSA on track.',
        provider: 'deterministic',
        originalDates: [],
        proposedDates: [],
        movedCount: 1,
        unchangedCount: 4,
        unscheduledCount: 0,
        summary: 'Moved 1 task; kept 4 unchanged.',
        warnings: [],
      },
    ],
  };
}

/**
 * Load demo workspace only when explicitly triggered by the user.
 * Never silently overwrites real user data.
 */
export function loadDemoWorkspace({ force = false, today = getTodayStr() } = {}) {
  if (!force && hasRealUserData()) {
    return { loaded: false, requiresConfirmation: true };
  }
  const demoState = buildDemoWorkspaceState(today);
  saveState(demoState);
  localStorage.setItem(DEMO_MODE_KEY, 'true');
  return { loaded: true, requiresConfirmation: false, state: demoState };
}

/**
 * Reset the sample demo workspace back to its initial state.
 * Refuses to overwrite non-demo user data unless force=true.
 */
export function resetDemoWorkspace({ force = false, today = getTodayStr() } = {}) {
  if (!force && !isDemoMode() && hasRealUserData()) {
    return { reset: false, requiresConfirmation: true };
  }
  return loadDemoWorkspace({ force: true, today });
}

/**
 * Safely exit demo mode and clear only sample demo data.
 * Never deletes real user data.
 */
export function exitDemoWorkspace() {
  if (!isDemoMode()) {
    return { exited: false };
  }
  clearState();
  return { exited: true };
}

const SAMPLE_GOAL_TEMPLATES = [
  {
    title: 'Crack Software Engineering Placements',
    category: 'Placements',
    description: 'Sample 30-day dataset: DSA, System Design, CS fundamentals, and mock interviews.',
    milestones: [
      'Core Data Structures & Patterns',
      'Trees, Graphs & Dynamic Programming',
      'System Design & Mock Interviews',
    ],
  },
  {
    title: 'GATE CS 2027 Preparation',
    category: 'Competitive Exam',
    description: 'Sample 30-day dataset: Algorithms, OS, DBMS, Computer Networks, and PYQs.',
    milestones: [
      'Algorithms & Discrete Math Revision',
      'OS, DBMS & Computer Networks',
      'Full-Length Mock Tests & Error Analysis',
    ],
  },
  {
    title: 'Senior Frontend & System Design Prep',
    category: 'Technical Interview',
    description: 'Sample 30-day dataset: Coding challenges, UI architecture, and behavioral rounds.',
    milestones: [
      'JavaScript & Browser Internals',
      'DSA & LeetCode Medium Practice',
      'Frontend Architecture & Mock Rounds',
    ],
  },
];

const SAMPLE_TASK_TOPICS = [
  { title: 'Array & Sliding Window Practice', priority: 'high', minutes: 45 },
  { title: 'Binary Search & Two Pointers Drill', priority: 'high', minutes: 45 },
  { title: 'Tree & Graph BFS/DFS Implementation', priority: 'high', minutes: 60 },
  { title: 'Dynamic Programming Memoization Set', priority: 'high', minutes: 75 },
  { title: 'SQL Joins & Indexing Exercises', priority: 'medium', minutes: 35 },
  { title: 'OS Concurrency & Deadlock Notes', priority: 'medium', minutes: 45 },
  { title: 'Computer Networks TCP/HTTP Review', priority: 'low', minutes: 30 },
  { title: 'System Design Case Study', priority: 'medium', minutes: 60 },
  { title: 'Timed Coding Mock Session', priority: 'high', minutes: 60 },
  { title: 'Behavioral STAR Stories Draft', priority: 'low', minutes: 30 },
  { title: 'Review Mistake Log & Flashcards', priority: 'medium', minutes: 30 },
  { title: 'API Rate Limiter Design', priority: 'medium', minutes: 50 },
];

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pickRandom(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Build a realistic, randomized 30-day productivity dataset anchored to today's local date.
 * Guarantees valid local timestamps (<= now), positive durations, and acyclic dependencies.
 */
export function buildRandomizedDemoState({
  today = getTodayStr(),
  rng = Math.random,
  now = new Date(),
} = {}) {
  const template = pickRandom(rng, SAMPLE_GOAL_TEMPLATES);
  const startDay = addDaysLocal(today, -29);
  const deadline = addDaysLocal(today, randInt(rng, 12, 21));
  const hoursPerDay = pickRandom(rng, [2.5, 3, 3.5, 4]);
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  const ms1Id = `demo-ms-${crypto.randomUUID()}`;
  const ms2Id = `demo-ms-${crypto.randomUUID()}`;
  const ms3Id = `demo-ms-${crypto.randomUUID()}`;
  const milestoneIds = [ms1Id, ms2Id, ms3Id];

  const milestones = [
    {
      id: ms1Id,
      title: template.milestones[0],
      description: 'Foundational concepts and core drills.',
      targetDate: addDaysLocal(today, -2),
      status: 'completed',
      createdAt: new Date(startDay + 'T09:00:00').toISOString(),
    },
    {
      id: ms2Id,
      title: template.milestones[1],
      description: 'Intermediate problem solving and timed sets.',
      targetDate: addDaysLocal(today, 6),
      status: 'pending',
      createdAt: new Date(startDay + 'T09:00:00').toISOString(),
    },
    {
      id: ms3Id,
      title: template.milestones[2],
      description: 'Final polish and full-length simulations.',
      targetDate: deadline,
      status: 'pending',
      createdAt: new Date(startDay + 'T09:00:00').toISOString(),
    },
  ];

  const tasks = [];
  let lastCompletedOrPrereqId = null;
  let overdueCreated = 0;
  let postponedCreated = 0;

  // Generate 30 days of historical + today activity (-29 .. 0) plus 2 upcoming days (+1 .. +2)
  for (let offset = -29; offset <= 2; offset++) {
    const dateStr = addDaysLocal(today, offset);

    // Occasional light/rest day (~12% chance on past days)
    if (offset < -3 && rng() < 0.12) {
      continue;
    }

    const tasksTodayCount = offset <= 0 ? randInt(rng, 1, 3) : randInt(rng, 1, 2);

    for (let i = 0; i < tasksTodayCount; i++) {
      const topic = pickRandom(rng, SAMPLE_TASK_TOPICS);
      const id = `demo-task-${crypto.randomUUID()}`;
      const milestoneId = offset < -10
        ? milestoneIds[0]
        : offset <= 0
          ? milestoneIds[1]
          : milestoneIds[2];

      const createdDate = new Date(addDaysLocal(dateStr, -1) + 'T09:00:00');
      const createdIso = createdDate.getTime() <= nowMs
        ? createdDate.toISOString()
        : nowIso;

      // Determine status realistically
      let status = 'pending';
      if (offset < -3) {
        status = rng() < 0.84 ? 'completed' : 'pending';
      } else if (offset < 0) {
        status = rng() < 0.55 ? 'completed' : 'pending';
      } else if (offset === 0) {
        status = i === 0 && rng() < 0.6 ? 'completed' : 'pending';
      }

      // Ensure at least a couple realistic overdue tasks exist for Recovery & Coach
      if (offset >= -3 && offset < 0 && overdueCreated < 2 && i === tasksTodayCount - 1) {
        status = 'pending';
        overdueCreated++;
      }

      let completedAt = null;
      let actualSeconds = 0;
      const timeSessions = [];

      if (status === 'completed') {
        const hour = randInt(rng, 9, 21);
        const minute = randInt(rng, 0, 55);
        const rawCompleted = new Date(
          `${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`
        );
        // Clamp to <= now so completion timestamps are never in the future
        const safeCompleted = rawCompleted.getTime() > nowMs ? new Date(nowMs - 60000) : rawCompleted;
        completedAt = safeCompleted.toISOString();

        // Realistic actual duration: 75% to 140% of estimatedMinutes
        const factor = 0.75 + rng() * 0.65;
        actualSeconds = Math.max(300, Math.round(topic.minutes * 60 * factor));
        const startedDate = new Date(safeCompleted.getTime() - actualSeconds * 1000);
        timeSessions.push({
          startedAt: startedDate.toISOString(),
          endedAt: completedAt,
          durationSeconds: actualSeconds,
        });
      }

      // Realistic postponements on some pending/completed tasks
      let postponementCount = 0;
      const postponementHistory = [];
      if (offset >= -12 && offset <= 0 && (postponedCreated < 3 || rng() < 0.2)) {
        postponementCount = status === 'pending' && postponedCreated < 2 ? randInt(rng, 2, 3) : 1;
        postponedCreated++;
        for (let p = 0; p < postponementCount; p++) {
          const fromD = addDaysLocal(dateStr, -(postponementCount - p));
          const toD = addDaysLocal(fromD, 1);
          const pTime = new Date(fromD + 'T19:00:00');
          postponementHistory.push({
            fromDate: fromD,
            toDate: toD,
            postponedAt: pTime.getTime() <= nowMs ? pTime.toISOString() : nowIso,
          });
        }
      }

      // Add occasional valid acyclic dependency on an earlier pending/completed task
      const dependencies = [];
      if (offset >= -1 && lastCompletedOrPrereqId && rng() < 0.18) {
        dependencies.push(lastCompletedOrPrereqId);
      }

      tasks.push({
        id,
        title: topic.title,
        description: `Sample generated task (${template.category}).`,
        date: dateStr,
        estimatedMinutes: topic.minutes,
        priority: topic.priority,
        status,
        actualSeconds,
        timeSessions,
        dependencies,
        postponementCount,
        postponementHistory,
        milestoneId,
        createdAt: createdIso,
        updatedAt: completedAt || createdIso,
        completedAt,
      });

      if (dependencies.length === 0) {
        lastCompletedOrPrereqId = id;
      }
    }
  }

  const recoveryHistory = [
    {
      id: `demo-rec-${crypto.randomUUID()}`,
      timestamp: new Date(addDaysLocal(today, -5) + 'T18:15:00').toISOString(),
      status: 'applied',
      approach: 'balanced',
      userExplanation: 'Mid-week lab deadline took extra time.',
      explanation: 'Balanced recovery redistributed 2 tasks across the weekend.',
      provider: 'deterministic',
      originalDates: [],
      proposedDates: [],
      movedCount: 2,
      unchangedCount: 5,
      unscheduledCount: 0,
      summary: 'Moved 2 tasks; kept 5 unchanged.',
      warnings: [],
    },
    {
      id: `demo-rec-${crypto.randomUUID()}`,
      timestamp: new Date(addDaysLocal(today, -1) + 'T20:05:00').toISOString(),
      status: 'applied',
      approach: 'priority',
      userExplanation: 'Some DP problems took longer than expected.',
      explanation: 'Priority-focused recovery protected high-priority interview tasks.',
      provider: 'openrouter',
      originalDates: [],
      proposedDates: [],
      movedCount: 1,
      unchangedCount: 4,
      unscheduledCount: 0,
      summary: 'Moved 1 task; kept 4 unchanged.',
      warnings: [],
    },
  ];

  return {
    version: SCHEMA_VERSION,
    onboardingComplete: true,
    activeTimer: null,
    goal: {
      id: `demo-goal-${crypto.randomUUID()}`,
      title: template.title,
      category: template.category,
      deadline,
      availableHoursPerDay: hoursPerDay,
      skillLevel: pickRandom(rng, ['intermediate', 'advanced']),
      description: template.description,
      milestones,
      createdAt: new Date(startDay + 'T09:00:00').toISOString(),
      updatedAt: nowIso,
    },
    tasks,
    recoveryHistory,
  };
}

/**
 * Generate and persist a fresh randomized 30-day sample dataset inside Demo Mode.
 * Never silently overwrites real user data.
 * Calling again in Demo Mode replaces the previous demo dataset safely without duplicating tasks.
 */
export function generateSampleAnalyticsData({
  force = false,
  today = getTodayStr(),
  rng = Math.random,
  now = new Date(),
} = {}) {
  if (!force && hasRealUserData()) {
    return { generated: false, requiresConfirmation: true };
  }

  const demoState = buildRandomizedDemoState({ today, rng, now });
  saveState(demoState);
  localStorage.setItem(DEMO_MODE_KEY, 'true');

  return {
    generated: true,
    requiresConfirmation: false,
    state: demoState,
    dateRange: {
      start: addDaysLocal(today, -29),
      end: today,
    },
    taskCount: demoState.tasks.length,
  };
}
