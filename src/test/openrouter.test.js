import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  OpenRouterProvider,
  OPENROUTER_ENDPOINT,
  isFreeOpenRouterModel,
  resetOpenRouterCircuitBreaker,
  getOpenRouterCircuitState,
} from '../../server/openrouterProvider.js';
import {
  generateRecoveryWithFallback,
  createAIProvider,
  GeminiProvider,
  DevDeterministicProvider,
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
    completed: [
      {
        id: 'c1',
        title: 'Completed Task',
        date: '2026-11-25',
        estimatedMinutes: 30,
        priority: 'high',
        status: 'completed',
        dependencies: [],
      },
    ],
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

const validPayload = {
  explanation: 'OpenRouter recovered schedule.',
  proposedSchedule: [{ taskId: 't1', date: '2026-11-26' }],
  movedTasks: [],
  unchangedTaskIds: ['t1'],
  unscheduledTasks: [],
  dailyWorkload: [{ date: '2026-11-26', totalMinutes: 45 }],
  warnings: [],
  summary: '1 task scheduled.',
};

function mockOpenRouterOk(payload = validPayload) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({
      model: 'openrouter/free',
      choices: [{ message: { content: JSON.stringify(payload) } }],
    }),
  };
}

function mockOpenRouterErr(status, text = 'Error', headers = {}) {
  return {
    ok: false,
    status,
    headers: new Headers(headers),
    text: async () => text,
  };
}

describe('OpenRouterProvider & Free-Model Fallback', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    resetOpenRouterCircuitBreaker();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('validates free-only OpenRouter model IDs', () => {
    expect(isFreeOpenRouterModel('openrouter/free')).toBe(true);
    expect(isFreeOpenRouterModel('nvidia/nemotron-3-ultra:free')).toBe(true);
    expect(isFreeOpenRouterModel('openai/gpt-4o')).toBe(false);
    expect(isFreeOpenRouterModel('anthropic/claude-3.5-sonnet')).toBe(false);
  });

  it('calls official OpenRouter endpoint with Bearer authorization and returns openrouter metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(mockOpenRouterOk());
    globalThis.fetch = fetchMock;

    const provider = new OpenRouterProvider('sk-or-test-secret', 'openrouter/free');
    const result = await provider.generateRecovery(sampleContext);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(OPENROUTER_ENDPOINT);
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-or-test-secret');
    expect(JSON.parse(init.body).model).toBe('openrouter/free');
    expect(JSON.parse(init.body).temperature).toBe(0.2);

    expect(result.provider).toBe('openrouter');
    expect(result.model).toBe('openrouter/free');
    expect(result.isFallback).toBe(false);
  });

  it('rejects paid models without calling fetch', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const provider = new OpenRouterProvider('sk-or-test-secret', 'openai/gpt-4o');
    await expect(provider.generateRecovery(sampleContext)).rejects.toMatchObject({
      status: 400,
      code: 'AI_INVALID_MODEL',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('handles 429 rate limits with max 2 attempts and Retry-After, then falls back deterministically', async () => {
    const sleepCalls = [];
    const fetchMock = vi.fn().mockResolvedValue(
      mockOpenRouterErr(429, 'Rate limit exceeded', { 'retry-after': '1' })
    );
    globalThis.fetch = fetchMock;

    const provider = new OpenRouterProvider('sk-or-test-secret', 'openrouter/free', {
      sleepFn: async (ms) => { sleepCalls.push(ms); },
      jitterFn: () => 0,
      baseDelayMs: 500,
    });

    const result = await generateRecoveryWithFallback(sampleContext, provider);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepCalls).toEqual([1000]);
    expect(result.provider).toBe('deterministic');
    expect(result.isFallback).toBe(true);
    expect(result.fallbackReason).toBe('AI_RATE_LIMIT');
    expect(result.fallbackMessage).toBe(
      'AI is temporarily unavailable. FocusFlow created a schedule using its built-in recovery engine instead.'
    );
  });

  it('falls back to deterministic engine on 503 while preserving completed tasks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockOpenRouterErr(503, 'Provider unavailable'));
    globalThis.fetch = fetchMock;

    const provider = new OpenRouterProvider('sk-or-test-secret', 'openrouter/free', {
      sleepFn: async () => {},
    });

    const result = await generateRecoveryWithFallback(sampleContext, provider);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.provider).toBe('deterministic');
    expect(result.isFallback).toBe(true);
    expect(result.proposedSchedule.some((e) => e.taskId === 'c1')).toBe(false);
    expect(result.proposedSchedule.some((e) => e.taskId === 't1')).toBe(true);
  });

  it('does not retry or expose API key on 401 invalid API key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockOpenRouterErr(401, 'Unauthorized sk-or-v1-secret999')
    );
    globalThis.fetch = fetchMock;

    const provider = new OpenRouterProvider('sk-or-v1-secret999', 'openrouter/free');
    let caught;
    try {
      await generateRecoveryWithFallback(sampleContext, provider);
    } catch (err) {
      caught = err;
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(caught.status).toBe(401);
    expect(caught.code).toBe('AI_INVALID_KEY');
    expect(caught.message).not.toContain('sk-or-v1-secret999');
  });

  it('opens circuit breaker after 3 consecutive transient failures to protect free limits', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockOpenRouterErr(503, 'Busy'));
    globalThis.fetch = fetchMock;

    const provider = new OpenRouterProvider('sk-or-test-secret', 'openrouter/free', {
      sleepFn: async () => {},
    });

    await expect(provider.generateRecovery(sampleContext)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    await expect(provider.generateRecovery(sampleContext)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    await expect(provider.generateRecovery(sampleContext)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(6);

    // 4th call short-circuits immediately without hitting fetch
    await expect(provider.generateRecovery(sampleContext)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('selects OpenRouter by default, Gemini when configured, and deterministic when selected', () => {
    delete process.env.AI_PROVIDER;
    expect(createAIProvider()).toBeInstanceOf(OpenRouterProvider);

    process.env.AI_PROVIDER = 'gemini';
    expect(createAIProvider()).toBeInstanceOf(GeminiProvider);

    process.env.AI_PROVIDER = 'deterministic';
    expect(createAIProvider()).toBeInstanceOf(DevDeterministicProvider);
  });

  it('clears attemptTimer once fetch resolves so valid JSON parsing completes without 15s timeout', async () => {
    const fencedContent = '```json\n' + JSON.stringify(validPayload) + '\n```';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            model: 'openrouter/free',
            choices: [{ message: { content: fencedContent } }],
          });
        }, 40);
      }),
    });
    globalThis.fetch = fetchMock;

    const provider = new OpenRouterProvider('sk-or-test-secret', 'openrouter/free', {
      attemptTimeoutMs: 25, // shorter than 40ms json() delay — must NOT abort post-fetch processing
      overallTimeoutMs: 500,
      maxAttempts: 1,
    });

    const result = await provider.generateRecovery(sampleContext, { requestId: 'req-ok-post200' });
    expect(result.provider).toBe('openrouter');
    expect(result.explanation).toBe('OpenRouter recovered schedule.');
  });

  it('reports AI_INVALID_RESPONSE instead of timeout when HTTP 200 contains invalid JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        model: 'openrouter/free',
        choices: [{ message: { content: 'not valid json {' } }],
      }),
    });
    globalThis.fetch = fetchMock;

    const provider = new OpenRouterProvider('sk-or-test-secret', 'openrouter/free', {
      maxAttempts: 1,
    });

    await expect(provider.generateRecovery(sampleContext, { requestId: 'req-bad-json' })).rejects.toMatchObject({
      status: 502,
      code: 'AI_INVALID_RESPONSE',
      fallbackEligible: true,
    });
  });

  it('uses fast free model by default, 90s overall timeout, and keeps openrouter/free configurable', () => {
    const defaultProvider = new OpenRouterProvider('sk-or-test-secret');
    expect(defaultProvider.model).toBe('mistralai/mistral-small-3.1-24b-instruct:free');
    expect(defaultProvider.overallTimeoutMs).toBe(90000);
    expect(defaultProvider.attemptTimeoutMs).toBe(15000);
    expect(defaultProvider.maxAttempts).toBe(2);

    const routerProvider = new OpenRouterProvider('sk-or-test-secret', 'openrouter/free');
    expect(routerProvider.model).toBe('openrouter/free');
  });

  it('triggers deterministic fallback when slow response body exceeds overall deadline', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => new Promise(() => {}), // hangs past overall deadline
    });
    globalThis.fetch = fetchMock;

    const provider = new OpenRouterProvider('sk-or-test-secret', 'mistralai/mistral-small-3.1-24b-instruct:free', {
      attemptTimeoutMs: 20,
      overallTimeoutMs: 50,
      maxAttempts: 1,
    });

    const result = await generateRecoveryWithFallback(sampleContext, provider, { requestId: 'req-slow-body' });
    expect(result.provider).toBe('deterministic');
    expect(result.isFallback).toBe(true);
    expect(result.fallbackReason).toBe('AI_TIMEOUT');
  });

  it('does not count client cancellation as a provider failure or open the circuit breaker', async () => {
    const fetchMock = vi.fn().mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    }));
    globalThis.fetch = fetchMock;

    const provider = new OpenRouterProvider('sk-or-test-secret', 'openrouter/free');

    for (let i = 0; i < 5; i++) {
      const clientController = new AbortController();
      const promise = provider.generateRecovery(sampleContext, {
        requestId: `cancel-${i}`,
        signal: clientController.signal,
      });
      clientController.abort();
      await expect(promise).rejects.toMatchObject({
        status: 499,
        code: 'CLIENT_CANCELLED',
        fallbackEligible: false,
      });
    }

    const state = getOpenRouterCircuitState();
    expect(state.consecutiveFailures).toBe(0);
    expect(state.openedUntil).toBe(0);
  });
});
