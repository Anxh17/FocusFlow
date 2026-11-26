import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GeminiProvider,
  DevDeterministicProvider,
  computeBackoffDelayMs,
  parseRetryAfterMs,
} from '../../server/aiProvider.js';

const sampleContext = {
  goal: {
    id: 'g1',
    title: 'Crack Placements',
    category: 'Placements',
    deadline: '2027-06-01',
    availableHoursPerDay: 2,
    skillLevel: 'intermediate',
  },
  milestones: [],
  tasks: {
    completed: [],
    pending: [
      {
        id: 't1',
        title: 'Solve Arrays',
        date: '2026-11-26',
        estimatedMinutes: 45,
        priority: 'high',
        status: 'pending',
        dependencies: [],
      },
    ],
  },
  schedule: {
    today: '2026-11-26',
    daysLeft: 5,
    dailyCapacityMinutes: 120,
    totalPendingMinutes: 45,
    remainingCapacity: 600,
    estimatedRemainingTodayMinutes: 60,
  },
  userInput: {
    explanation: 'Lost time today',
    approach: 'balanced',
  },
};

function makeSuccessResponse(payload) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify(payload) }],
          },
        },
      ],
    }),
  };
}

function makeErrorResponse(status, bodyText = 'Upstream error', headersObj = {}) {
  return {
    ok: false,
    status,
    headers: new Headers(headersObj),
    text: async () => bodyText,
  };
}

const validAiPayload = {
  explanation: 'Recovered schedule cleanly.',
  proposedSchedule: [{ taskId: 't1', date: '2026-11-26' }],
  movedTasks: [],
  unchangedTaskIds: ['t1'],
  unscheduledTasks: [],
  dailyWorkload: [{ date: '2026-11-26', totalMinutes: 45 }],
  warnings: [],
  summary: '1 task scheduled.',
};

describe('GeminiProvider retry and reliability', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('computes exponential backoff (~2s, ~4s, ~8s) with jitter and Retry-After support', () => {
    expect(computeBackoffDelayMs(0, { jitterFn: () => 0 })).toBe(2000);
    expect(computeBackoffDelayMs(1, { jitterFn: () => 0 })).toBe(4000);
    expect(computeBackoffDelayMs(2, { jitterFn: () => 0 })).toBe(8000);
    expect(computeBackoffDelayMs(0, { jitterFn: () => 1 })).toBe(2300);
    expect(computeBackoffDelayMs(0, { jitterFn: () => 0, retryAfterMs: 5000 })).toBe(5000);
    expect(parseRetryAfterMs('5')).toBe(5000);
  });

  it('retries 503 followed by success', async () => {
    const sleepCalls = [];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeErrorResponse(503, 'Service Unavailable'))
      .mockResolvedValueOnce(makeSuccessResponse(validAiPayload));
    globalThis.fetch = fetchMock;

    const provider = new GeminiProvider('secret-api-key', 'gemini-3.8-flash', {
      sleepFn: async (ms) => { sleepCalls.push(ms); },
      jitterFn: () => 0,
    });

    const result = await provider.generateRecovery(sampleContext);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepCalls).toEqual([2000]);
    expect(result.explanation).toBe('Recovered schedule cleanly.');
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-3.8-flash');
  });

  it('has 60s overall timeout, 15s per-attempt timeout, max 3 attempts, and primary/fallback defaults', () => {
    const provider = new GeminiProvider('secret-api-key');
    expect(provider.model).toBe('gemini-3.1-flash-lite');
    expect(provider.fallbackModel).toBe('gemini-3.8-flash');
    expect(provider.overallTimeoutMs).toBe(60000);
    expect(provider.attemptTimeoutMs).toBe(15000);
    expect(provider.maxAttempts).toBe(3);
  });

  it('succeeds on primary model without invoking fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeSuccessResponse(validAiPayload));
    globalThis.fetch = fetchMock;

    const provider = new GeminiProvider('secret-api-key');
    const result = await provider.generateRecovery(sampleContext);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('gemini-3.1-flash-lite');
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-3.1-flash-lite');
  });

  it('falls back to GEMINI_FALLBACK_MODEL when primary returns 503 after all retries', async () => {
    const sleepCalls = [];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeErrorResponse(503, 'UNAVAILABLE: high demand'))
      .mockResolvedValueOnce(makeErrorResponse(503, 'UNAVAILABLE: high demand'))
      .mockResolvedValueOnce(makeErrorResponse(503, 'UNAVAILABLE: high demand'))
      .mockResolvedValueOnce(makeSuccessResponse(validAiPayload));
    globalThis.fetch = fetchMock;

    const provider = new GeminiProvider('secret-api-key', 'gemini-3.1-flash-lite', {
      fallbackModel: 'gemini-3.8-flash',
      sleepFn: async (ms) => { sleepCalls.push(ms); },
      jitterFn: () => 0,
    });

    const result = await provider.generateRecovery(sampleContext);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0][0]).toContain('gemini-3.1-flash-lite');
    expect(fetchMock.mock.calls[1][0]).toContain('gemini-3.1-flash-lite');
    expect(fetchMock.mock.calls[2][0]).toContain('gemini-3.1-flash-lite');
    expect(fetchMock.mock.calls[3][0]).toContain('gemini-3.8-flash');
    expect(sleepCalls).toEqual([2000, 4000]);
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-3.8-flash');
  });

  it('returns AI_UNAVAILABLE when both primary and fallback models fail after 503', async () => {
    const sleepCalls = [];
    const fetchMock = vi.fn().mockResolvedValue(
      makeErrorResponse(503, 'UNAVAILABLE: high demand')
    );
    globalThis.fetch = fetchMock;

    const provider = new GeminiProvider('secret-api-key', 'gemini-3.1-flash-lite', {
      fallbackModel: 'gemini-3.8-flash',
      sleepFn: async (ms) => { sleepCalls.push(ms); },
      jitterFn: () => 0,
    });

    await expect(provider.generateRecovery(sampleContext)).rejects.toMatchObject({
      message: 'Gemini is temporarily busy. Please try again in a moment.',
      status: 503,
      code: 'AI_UNAVAILABLE',
    });

    // 3 attempts on primary + 3 attempts on fallback = 6 calls
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(sleepCalls).toEqual([2000, 4000, 2000, 4000]);
  });

  it('respects max 3 attempts on 503 when fallback is disabled and returns friendly busy message', async () => {
    const sleepCalls = [];
    const fetchMock = vi.fn().mockResolvedValue(
      makeErrorResponse(503, 'UNAVAILABLE: high demand')
    );
    globalThis.fetch = fetchMock;

    const provider = new GeminiProvider('secret-api-key', 'gemini-3.1-flash-lite', {
      fallbackModel: '',
      sleepFn: async (ms) => { sleepCalls.push(ms); },
      jitterFn: () => 0,
    });

    await expect(provider.generateRecovery(sampleContext)).rejects.toMatchObject({
      message: 'Gemini is temporarily busy. Please try again in a moment.',
      status: 503,
      code: 'AI_UNAVAILABLE',
    });

    // Max 3 attempts total, with 2 backoff waits (2s, 4s)
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleepCalls).toEqual([2000, 4000]);
  });

  it('retries transient network errors followed by success', async () => {
    const sleepCalls = [];
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('network reset'))
      .mockResolvedValueOnce(makeSuccessResponse(validAiPayload));
    globalThis.fetch = fetchMock;

    const provider = new GeminiProvider('secret-api-key', 'gemini-3.8-flash', {
      sleepFn: async (ms) => { sleepCalls.push(ms); },
      jitterFn: () => 0,
    });

    const result = await provider.generateRecovery(sampleContext);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepCalls).toEqual([2000]);
    expect(result.explanation).toBe('Recovered schedule cleanly.');
  });

  it('retries a timed-out single attempt when overall budget remains', async () => {
    const sleepCalls = [];
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }))
      .mockResolvedValueOnce(makeSuccessResponse(validAiPayload));
    globalThis.fetch = fetchMock;

    const provider = new GeminiProvider('secret-api-key', 'gemini-3.8-flash', {
      overallTimeoutMs: 5000,
      attemptTimeoutMs: 30,
      baseDelayMs: 10,
      sleepFn: async (ms) => { sleepCalls.push(ms); },
      jitterFn: () => 0,
    });

    const result = await provider.generateRecovery(sampleContext);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepCalls).toEqual([10]);
    expect(result.explanation).toBe('Recovered schedule cleanly.');
  });

  it('retries 429 with Retry-After header followed by success', async () => {
    const sleepCalls = [];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeErrorResponse(429, 'Rate limited', { 'retry-after': '3' }))
      .mockResolvedValueOnce(makeSuccessResponse(validAiPayload));
    globalThis.fetch = fetchMock;

    const provider = new GeminiProvider('secret-api-key', 'gemini-3.8-flash', {
      sleepFn: async (ms) => { sleepCalls.push(ms); },
      jitterFn: () => 0,
    });

    const result = await provider.generateRecovery(sampleContext);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepCalls).toEqual([3000]);
    expect(result.proposedSchedule).toHaveLength(1);
  });

  it('does not retry permanent 400 or 404 errors and never exposes API key', async () => {
    const sleepCalls = [];
    const fetchMock = vi.fn().mockResolvedValue(
      makeErrorResponse(400, 'Bad request for key=secret-api-key-123')
    );
    globalThis.fetch = fetchMock;

    const provider = new GeminiProvider('secret-api-key-123', 'gemini-3.8-flash', {
      sleepFn: async (ms) => { sleepCalls.push(ms); },
    });

    let caught;
    try {
      await provider.generateRecovery(sampleContext);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.status).toBe(400);
    expect(caught.message).not.toContain('secret-api-key-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleepCalls).toHaveLength(0);

    // 404 should also fail immediately without retrying
    const fetch404 = vi.fn().mockResolvedValue(makeErrorResponse(404, 'Model not found'));
    globalThis.fetch = fetch404;
    await expect(provider.generateRecovery(sampleContext)).rejects.toMatchObject({ status: 404 });
    expect(fetch404).toHaveBeenCalledTimes(1);
  });

  it('enforces overall timeout budget so retries never exceed overall timeout', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeErrorResponse(503, 'Busy')
    );
    globalThis.fetch = fetchMock;

    // Overall timeout 100ms is smaller than first 2000ms backoff delay -> aborts before sleeping past budget
    const provider = new GeminiProvider('secret-api-key', 'gemini-3.8-flash', {
      overallTimeoutMs: 100,
      baseDelayMs: 2000,
    });

    await expect(provider.generateRecovery(sampleContext)).rejects.toMatchObject({
      status: 504,
      code: 'AI_TIMEOUT',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps DevDeterministicProvider working', async () => {
    const dev = new DevDeterministicProvider();
    const res = await dev.generateRecovery(sampleContext);
    expect(res.isDevProvider).toBe(true);
    expect(res.provider).toBe('deterministic');
    expect(res.proposedSchedule).toHaveLength(1);
  });
});
