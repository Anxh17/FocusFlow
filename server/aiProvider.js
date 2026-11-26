import { OpenRouterProvider } from './openrouterProvider.js';

const DEFAULT_PRIMARY_MODEL = 'gemini-3.1-flash-lite';
const DEFAULT_FALLBACK_MODEL = 'gemini-3.8-flash';
const DEFAULT_OVERALL_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 60000;
const DEFAULT_ATTEMPT_TIMEOUT_MS = Number(process.env.GEMINI_ATTEMPT_TIMEOUT_MS) || 15000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 2000;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function parseRetryAfterMs(headerValue) {
  if (!headerValue) return null;
  const trimmed = String(headerValue).trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
}

export function computeBackoffDelayMs(attemptIndex, {
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  jitterFn = Math.random,
  retryAfterMs = null,
} = {}) {
  // Exponential backoff: ~2s (attempt 0), ~4s (attempt 1), ~8s (attempt 2)
  const expDelay = baseDelayMs * Math.pow(2, attemptIndex);
  // Small random jitter (0% to +15%) to avoid synchronized retries
  const jitter = Math.round(expDelay * 0.15 * Math.max(0, Math.min(1, jitterFn())));
  const computed = expDelay + jitter;
  if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.max(computed, retryAfterMs);
  }
  return computed;
}

const RECOVERY_JSON_SCHEMA = {
  type: 'OBJECT',
  properties: {
    explanation: { type: 'STRING' },
    proposedSchedule: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          taskId: { type: 'STRING' },
          date: { type: 'STRING' },
        },
        required: ['taskId', 'date'],
      },
    },
    movedTasks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          taskId: { type: 'STRING' },
          fromDate: { type: 'STRING' },
          toDate: { type: 'STRING' },
        },
        required: ['taskId', 'fromDate', 'toDate'],
      },
    },
    unchangedTaskIds: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    unscheduledTasks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          taskId: { type: 'STRING' },
          reason: { type: 'STRING' },
        },
        required: ['taskId', 'reason'],
      },
    },
    dailyWorkload: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          date: { type: 'STRING' },
          totalMinutes: { type: 'NUMBER' },
        },
        required: ['date', 'totalMinutes'],
      },
    },
    warnings: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    summary: { type: 'STRING' },
  },
  required: ['explanation', 'proposedSchedule', 'unscheduledTasks', 'warnings', 'summary'],
};

export function buildPrompt(context) {
  const { goal, milestones, tasks, schedule, userInput } = context;

  return `You are FocusFlow's AI Schedule Recovery planner.
Rebuild a realistic, achievable schedule for the user's remaining pending tasks.

CONSTRAINTS:
1. Today's date is ${schedule.today}. Goal deadline is ${goal.deadline}.
2. Daily capacity is ${schedule.dailyCapacityMinutes} minutes/day (${goal.availableHoursPerDay}h/day). Remaining time today is ~${schedule.estimatedRemainingTodayMinutes} minutes.
3. NEVER include completed tasks in proposedSchedule. Only schedule pending tasks using their exact taskId.
4. Respect task dependencies: a task MUST NOT be scheduled earlier than any incomplete prerequisite.
5. Do NOT schedule tasks after ${goal.deadline}. If a task cannot fit before the deadline, place it in unscheduledTasks with a clear reason.
6. Respect the user's preferred recovery approach: "${userInput.approach}".
   - balanced: distribute evenly across remaining days.
   - deadline: prioritize urgent deadlines and fit as much as possible before ${goal.deadline}.
   - priority: prioritize high-priority tasks; defer low-priority tasks if capacity is tight.
   - light: keep today's workload light and shift non-urgent tasks to later days.
7. User explanation: "${userInput.explanation || 'No explanation provided.'}"

GOAL:
${JSON.stringify(goal)}

MILESTONES:
${JSON.stringify(milestones)}

COMPLETED TASKS (context only, do not reschedule):
${JSON.stringify(tasks.completed.map((t) => ({ id: t.id, title: t.title, date: t.date })))}

PENDING TASKS TO SCHEDULE (include overdue, today, future):
${JSON.stringify(tasks.pending)}

Return ONLY valid JSON matching the required schema.`;
}

/**
 * Real Gemini AI provider using server-side GEMINI_API_KEY.
 */
export class GeminiProvider {
  constructor(
    apiKey,
    model = process.env.GEMINI_MODEL || DEFAULT_PRIMARY_MODEL,
    options = {}
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.fallbackModel = options.fallbackModel !== undefined
      ? options.fallbackModel
      : (process.env.GEMINI_FALLBACK_MODEL ?? DEFAULT_FALLBACK_MODEL);
    this.overallTimeoutMs = options.overallTimeoutMs ?? DEFAULT_OVERALL_TIMEOUT_MS;
    this.attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.sleepFn = options.sleepFn ?? defaultSleep;
    this.jitterFn = options.jitterFn ?? Math.random;
  }

  async _runModelAttempts(modelName, requestBody, overallController, deadlineMs, context, overallTimedOutRef) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    let lastTransientStatus = null;
    let lastUpstreamText = '';
    let lastNetworkError = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const remainingMs = deadlineMs - Date.now();
      if (remainingMs <= 0 || overallTimedOutRef.value || overallController.signal.aborted) {
        const timeoutErr = new Error('Gemini request exceeded the 60s overall deadline.');
        timeoutErr.status = 504;
        timeoutErr.code = 'AI_TIMEOUT';
        throw timeoutErr;
      }

      const perAttemptMs = Math.min(this.attemptTimeoutMs, remainingMs);
      const attemptController = new AbortController();
      let attemptTimedOut = false;
      const attemptTimer = setTimeout(() => {
        attemptTimedOut = true;
        attemptController.abort();
      }, perAttemptMs);
      const onOverallAbort = () => attemptController.abort();
      overallController.signal.addEventListener('abort', onOverallAbort, { once: true });

      const attemptStart = Date.now();
      console.info(`[Recovery] Attempting model: ${modelName} (attempt ${attempt}/${this.maxAttempts}, timeoutMs: ${perAttemptMs})`);

      let res;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: attemptController.signal,
          body: requestBody,
        });
      } catch (fetchErr) {
        const durationMs = Date.now() - attemptStart;
        if (overallTimedOutRef.value || overallController.signal.aborted) {
          console.error(`[Recovery] Overall timeout reached during ${modelName} attempt ${attempt} (${durationMs}ms)`);
          const timeoutErr = new Error('Gemini request exceeded the 60s overall deadline.');
          timeoutErr.status = 504;
          timeoutErr.code = 'AI_TIMEOUT';
          throw timeoutErr;
        }

        const category = attemptTimedOut ? 'attempt_timeout' : 'network_error';
        console.warn(`[Recovery] ${modelName} attempt ${attempt} failed (${category}) in ${durationMs}ms: ${fetchErr.message}`);
        lastNetworkError = fetchErr;
        lastTransientStatus = attemptTimedOut ? 504 : 502;
        lastUpstreamText = attemptTimedOut ? 'Attempt timed out' : 'Transient network error';

        if (attempt >= this.maxAttempts) {
          break;
        }

        const delayMs = computeBackoffDelayMs(attempt - 1, {
          baseDelayMs: this.baseDelayMs,
          jitterFn: this.jitterFn,
        });
        const budgetLeftMs = deadlineMs - Date.now();
        if (delayMs >= budgetLeftMs) {
          const timeoutErr = new Error('Gemini request exceeded the 60s overall deadline while waiting to retry.');
          timeoutErr.status = 504;
          timeoutErr.code = 'AI_TIMEOUT';
          throw timeoutErr;
        }
        await this.sleepFn(delayMs, overallController.signal);
        continue;
      } finally {
        clearTimeout(attemptTimer);
        overallController.signal.removeEventListener('abort', onOverallAbort);
      }

      const durationMs = Date.now() - attemptStart;
      console.info(`[Recovery] ${modelName} attempt ${attempt} responded: HTTP ${res.status} (${durationMs}ms)`);

      if (res.ok) {
        const data = await res.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) {
          const emptyErr = new Error('Gemini API returned an empty response.');
          emptyErr.status = 502;
          emptyErr.code = 'AI_EMPTY_RESPONSE';
          throw emptyErr;
        }

        const parsed = JSON.parse(rawText);
        return {
          ...parsed,
          provider: 'gemini',
          model: modelName,
          isDevProvider: false,
          isFallback: false,
          approach: context.userInput?.approach || 'balanced',
        };
      }

      const rawErrorText = await res.text().catch(() => '');
      const safeText = rawErrorText.replace(/key=[^&\s"']+/gi, 'key=[REDACTED]').slice(0, 200);

      if (!RETRYABLE_STATUS_CODES.has(res.status)) {
        console.error(`[Recovery] Final error category: NON_RETRYABLE_${res.status} (model: ${modelName})`);
        const err = new Error(`Gemini API request failed (${res.status}): ${safeText}`);
        err.status = res.status >= 400 && res.status < 500 ? res.status : 502;
        err.code = 'AI_UPSTREAM_ERROR';
        throw err;
      }

      lastTransientStatus = res.status;
      lastUpstreamText = safeText;
      lastNetworkError = null;

      if (attempt >= this.maxAttempts) {
        break;
      }

      const retryAfterHeader = typeof res.headers?.get === 'function' ? res.headers.get('retry-after') : null;
      const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
      const delayMs = computeBackoffDelayMs(attempt - 1, {
        baseDelayMs: this.baseDelayMs,
        jitterFn: this.jitterFn,
        retryAfterMs,
      });

      const budgetLeftMs = deadlineMs - Date.now();
      if (delayMs >= budgetLeftMs) {
        console.error(`[Recovery] Final error category: AI_TIMEOUT (retry delay ${delayMs}ms >= budget ${budgetLeftMs}ms)`);
        const timeoutErr = new Error('Gemini request exceeded the 60s overall deadline while waiting to retry.');
        timeoutErr.status = 504;
        timeoutErr.code = 'AI_TIMEOUT';
        throw timeoutErr;
      }

      await this.sleepFn(delayMs, overallController.signal);
    }

    if (lastTransientStatus === 503 || lastTransientStatus === 429) {
      const busyErr = new Error('Gemini is temporarily busy. Please try again in a moment.');
      busyErr.status = 503;
      busyErr.code = 'AI_UNAVAILABLE';
      busyErr.upstreamStatus = lastTransientStatus;
      throw busyErr;
    }

    if (lastTransientStatus === 504) {
      const timeoutErr = new Error('Gemini API timed out across all retry attempts.');
      timeoutErr.status = 504;
      timeoutErr.code = 'AI_TIMEOUT';
      throw timeoutErr;
    }

    const detail = lastUpstreamText || lastNetworkError?.message || 'Upstream failure';
    const upstreamErr = new Error(`Gemini API request failed (${lastTransientStatus || 502}): ${detail}`);
    upstreamErr.status = 502;
    upstreamErr.code = 'AI_UPSTREAM_ERROR';
    throw upstreamErr;
  }

  async generateRecovery(context) {
    if (!this.apiKey) {
      const err = new Error('GEMINI_API_KEY is not configured on the server.');
      err.status = 503;
      err.code = 'AI_NOT_CONFIGURED';
      throw err;
    }

    const overallController = new AbortController();
    const overallTimedOutRef = { value: false };
    const overallTimer = setTimeout(() => {
      overallTimedOutRef.value = true;
      overallController.abort();
    }, this.overallTimeoutMs);
    const deadlineMs = Date.now() + this.overallTimeoutMs;

    const requestBody = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: buildPrompt(context) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RECOVERY_JSON_SCHEMA,
        temperature: 0.2,
      },
    });

    console.info(`[Recovery] Provider selected: gemini, primaryModel: ${this.model}, fallbackModel: ${this.fallbackModel || 'none'}, overallTimeoutMs: ${this.overallTimeoutMs}, attemptTimeoutMs: ${this.attemptTimeoutMs}`);

    try {
      try {
        return await this._runModelAttempts(
          this.model,
          requestBody,
          overallController,
          deadlineMs,
          context,
          overallTimedOutRef
        );
      } catch (primaryErr) {
        const shouldFallback =
          primaryErr.upstreamStatus === 503 &&
          this.fallbackModel &&
          this.fallbackModel !== this.model &&
          !overallTimedOutRef.value &&
          deadlineMs - Date.now() > 0;

        if (!shouldFallback) {
          console.error(`[Recovery] Final error category: ${primaryErr.code || 'ERROR'} (model: ${this.model})`);
          throw primaryErr;
        }

        console.warn(`[Recovery] Primary model ${this.model} returned HTTP 503 after ${this.maxAttempts} attempts; falling back to ${this.fallbackModel}`);

        try {
          return await this._runModelAttempts(
            this.fallbackModel,
            requestBody,
            overallController,
            deadlineMs,
            context,
            overallTimedOutRef
          );
        } catch (fallbackErr) {
          console.error(`[Recovery] Fallback model ${this.fallbackModel} also failed (${fallbackErr.code || 'ERROR'}); returning AI_UNAVAILABLE`);
          const unavailableErr = new Error('Gemini is temporarily busy. Please try again in a moment.');
          unavailableErr.status = 503;
          unavailableErr.code = 'AI_UNAVAILABLE';
          throw unavailableErr;
        }
      }
    } catch (err) {
      if (err.name === 'AbortError' || overallTimedOutRef.value) {
        console.error('[Recovery] Final error category: AI_TIMEOUT (aborted)');
        const timeoutErr = new Error('Gemini request timed out.');
        timeoutErr.status = 504;
        timeoutErr.code = 'AI_TIMEOUT';
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(overallTimer);
    }
  }
}

/**
 * Clearly-labelled Development/Test deterministic provider.
 * Used only when AI_PROVIDER=dev for local testing without credentials.
 */
export class DevDeterministicProvider {
  async generateRecovery(context) {
    const { goal, tasks, schedule, userInput } = context;
    const today = schedule.today;
    const deadline = goal.deadline;
    const approach = userInput?.approach || 'balanced';

    let dailyCapacity = Math.max(15, Math.round((Number(goal.availableHoursPerDay) || 2) * 60));
    if (approach === 'deadline') {
      dailyCapacity = Math.round(dailyCapacity * 1.3);
    }

    const pending = [...(tasks.pending || [])];
    const priorityRank = { high: 0, medium: 1, low: 2 };
    pending.sort((a, b) => {
      const pDiff = (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1);
      if (pDiff !== 0) return pDiff;
      return (a.date || '').localeCompare(b.date || '');
    });

    const filteredPending = approach === 'priority' && schedule.totalPendingMinutes > schedule.remainingCapacity
      ? pending.filter((t) => t.priority !== 'low')
      : pending;

    const dayUsed = new Map();
    const scheduledDateById = new Map();
    for (const c of tasks.completed || []) {
      scheduledDateById.set(c.id, c.date);
    }

    const proposedSchedule = [];
    const movedTasks = [];
    const unchangedTaskIds = [];
    const unscheduledTasks = [];
    const startOffset = approach === 'light' ? 1 : 0;

    for (const task of filteredPending) {
      const mins = Math.max(5, task.estimatedMinutes || 30);
      let placed = null;

      for (let offset = startOffset; offset <= (schedule.daysLeft || 7) + 1; offset++) {
        const d = new Date(today + 'T00:00:00');
        d.setDate(d.getDate() + offset);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (deadline && dateStr > deadline) break;

        // Respect dependencies
        const depsOk = (task.dependencies || []).every((depId) => {
          const depDate = scheduledDateById.get(depId);
          return !depDate || depDate <= dateStr;
        });
        if (!depsOk) continue;

        const used = dayUsed.get(dateStr) || 0;
        const limit = dateStr === today && approach === 'light' ? Math.floor(dailyCapacity * 0.5) : dailyCapacity;
        if (used + mins <= limit) {
          dayUsed.set(dateStr, used + mins);
          placed = dateStr;
          break;
        }
      }

      if (placed) {
        scheduledDateById.set(task.id, placed);
        proposedSchedule.push({ taskId: task.id, date: placed });
        if (placed !== task.date) {
          movedTasks.push({ taskId: task.id, fromDate: task.date, toDate: placed });
        } else {
          unchangedTaskIds.push(task.id);
        }
      } else {
        unscheduledTasks.push({
          taskId: task.id,
          reason: `Could not fit before ${deadline} at ${dailyCapacity}m/day capacity.`,
        });
      }
    }

    const dailyWorkload = [...dayUsed.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, totalMinutes]) => ({ date, totalMinutes }));

    return {
      provider: 'deterministic',
      model: 'built-in',
      isDevProvider: true,
      isFallback: false,
      approach,
      explanation: `Built-in Deterministic Recovery (${approach}): Rebuilt schedule for ${proposedSchedule.length} pending task(s).`,
      proposedSchedule,
      movedTasks,
      unchangedTaskIds,
      unscheduledTasks,
      dailyWorkload,
      warnings: unscheduledTasks.length > 0
        ? [`${unscheduledTasks.length} task(s) could not fit before ${deadline}.`]
        : [],
      summary: `Moved ${movedTasks.length} task(s), kept ${unchangedTaskIds.length} unchanged, ${unscheduledTasks.length} unscheduled.`,
    };
  }
}

export function createAIProvider() {
  const providerType = (process.env.AI_PROVIDER || 'openrouter').toLowerCase();
  if (providerType === 'deterministic' || providerType === 'dev') {
    return new DevDeterministicProvider();
  }
  if (providerType === 'gemini') {
    return new GeminiProvider(process.env.GEMINI_API_KEY || '');
  }
  return new OpenRouterProvider(
    process.env.OPENROUTER_API_KEY || '',
    process.env.OPENROUTER_MODEL || 'mistralai/mistral-small-3.1-24b-instruct:free'
  );
}

/**
 * Execute recovery with automatic deterministic fallback when OpenRouter
 * fails due to transient errors (429, 502, 503, 504, network failure, or timeout).
 */
export async function generateRecoveryWithFallback(
  context,
  provider = createAIProvider(),
  options = {}
) {
  const { requestId = 'local', signal = null } = options;
  try {
    return await provider.generateRecovery(context, { requestId, signal });
  } catch (err) {
    if (err.fallbackEligible && !signal?.aborted) {
      console.warn(`[Recovery:${requestId}] Falling back to deterministic engine (${err.code || 'AI_UNAVAILABLE'})`);
      const fallbackProvider = new DevDeterministicProvider();
      const fallbackResult = await fallbackProvider.generateRecovery(context);
      return {
        ...fallbackResult,
        provider: 'deterministic',
        isFallback: true,
        fallbackReason: err.code || 'AI_UNAVAILABLE',
        fallbackMessage: 'AI is temporarily unavailable. FocusFlow created a schedule using its built-in recovery engine instead.',
      };
    }
    throw err;
  }
}
