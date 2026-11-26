import { buildPrompt, parseRetryAfterMs, computeBackoffDelayMs } from './aiProvider.js';

export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
export const DEFAULT_OPENROUTER_MODEL = 'mistralai/mistral-small-3.1-24b-instruct:free';
const DEFAULT_OVERALL_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS) || 90000;
const DEFAULT_ATTEMPT_TIMEOUT_MS = Number(process.env.OPENROUTER_ATTEMPT_TIMEOUT_MS) || 15000;
const DEFAULT_MAX_ATTEMPTS = 2; // Protect free-tier limits: max 2 attempts per request
const DEFAULT_BASE_DELAY_MS = 2000;
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

// Circuit breaker state to protect free API limits after repeated failures
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 60000;

let circuitState = {
  consecutiveFailures: 0,
  openedUntil: 0,
};

export function resetOpenRouterCircuitBreaker() {
  circuitState = { consecutiveFailures: 0, openedUntil: 0 };
}

export function getOpenRouterCircuitState() {
  return { ...circuitState };
}

export function isFreeOpenRouterModel(modelId) {
  if (typeof modelId !== 'string') return false;
  const trimmed = modelId.trim();
  return trimmed === 'openrouter/free' || trimmed.endsWith(':free');
}

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

function readBodyWithOverallDeadline(res, overallSignal) {
  return new Promise((resolve, reject) => {
    if (overallSignal?.aborted) {
      const err = new Error('Overall deadline exceeded while reading response body');
      err.name = 'AbortError';
      reject(err);
      return;
    }
    const onAbort = () => {
      const err = new Error('Overall deadline exceeded while reading response body');
      err.name = 'AbortError';
      reject(err);
    };
    overallSignal?.addEventListener('abort', onAbort, { once: true });

    Promise.resolve(res.json()).then(
      (data) => {
        overallSignal?.removeEventListener('abort', onAbort);
        resolve(data);
      },
      (err) => {
        overallSignal?.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

function extractJsonContent(rawContent) {
  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    const err = new Error('OpenRouter returned empty message.content.');
    err.code = 'AI_INVALID_RESPONSE';
    err.status = 502;
    err.fallbackEligible = true;
    throw err;
  }
  const trimmed = rawContent.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonStr = fenceMatch ? fenceMatch[1].trim() : trimmed;
  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.proposedSchedule)) {
      const schemaErr = new Error('OpenRouter JSON is missing required proposedSchedule array.');
      schemaErr.code = 'AI_INVALID_RESPONSE';
      schemaErr.status = 502;
      schemaErr.fallbackEligible = true;
      throw schemaErr;
    }
    return parsed;
  } catch (err) {
    if (err.code === 'AI_INVALID_RESPONSE') throw err;
    const parseErr = new Error(`OpenRouter returned invalid JSON in message.content: ${err.message}`);
    parseErr.code = 'AI_INVALID_RESPONSE';
    parseErr.status = 502;
    parseErr.fallbackEligible = true;
    throw parseErr;
  }
}

export class OpenRouterProvider {
  constructor(
    apiKey = process.env.OPENROUTER_API_KEY || '',
    model = process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
    options = {}
  ) {
    this.apiKey = apiKey;
    this.model = model || DEFAULT_OPENROUTER_MODEL;
    this.overallTimeoutMs = options.overallTimeoutMs ?? DEFAULT_OVERALL_TIMEOUT_MS;
    this.attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.sleepFn = options.sleepFn ?? defaultSleep;
    this.jitterFn = options.jitterFn ?? Math.random;
  }

  async generateRecovery(context, { requestId = 'local', signal: externalSignal = null } = {}) {
    if (!this.apiKey) {
      const err = new Error('OPENROUTER_API_KEY is not configured on the server.');
      err.status = 503;
      err.code = 'AI_NOT_CONFIGURED';
      throw err;
    }

    if (!isFreeOpenRouterModel(this.model)) {
      const err = new Error(
        `Invalid OpenRouter model "${this.model}". Only free models ("openrouter/free" or "*:free") are permitted.`
      );
      err.status = 400;
      err.code = 'AI_INVALID_MODEL';
      throw err;
    }

    if (Date.now() < circuitState.openedUntil) {
      console.warn(`[Recovery:${requestId}] OpenRouter circuit breaker is open; skipping external call`);
      const err = new Error('OpenRouter provider is temporarily unavailable (circuit breaker open).');
      err.status = 503;
      err.code = 'AI_UNAVAILABLE';
      err.fallbackEligible = true;
      throw err;
    }

    const overallController = new AbortController();
    let overallTimedOut = false;
    const overallTimer = setTimeout(() => {
      overallTimedOut = true;
      overallController.abort();
    }, this.overallTimeoutMs);
    const onExternalAbort = () => overallController.abort();
    if (externalSignal) {
      if (externalSignal.aborted) overallController.abort();
      else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
    const deadlineMs = Date.now() + this.overallTimeoutMs;

    const requestBody = JSON.stringify({
      model: this.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are FocusFlow AI Schedule Recovery planner. Respond ONLY with valid JSON containing keys: explanation, proposedSchedule (array of {taskId, date}), movedTasks, unchangedTaskIds, unscheduledTasks (array of {taskId, reason}), dailyWorkload, warnings, summary.',
        },
        {
          role: 'user',
          content: buildPrompt(context),
        },
      ],
    });

    console.info(`[Recovery:${requestId}] Provider selected: openrouter, model: ${this.model}`);

    try {
      let lastError = null;

      for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
        if (externalSignal?.aborted) {
          const cancelErr = new Error('Recovery request was cancelled by the client.');
          cancelErr.status = 499;
          cancelErr.code = 'CLIENT_CANCELLED';
          cancelErr.fallbackEligible = false;
          throw cancelErr;
        }
        const remainingMs = deadlineMs - Date.now();
        if (remainingMs <= 0 || overallTimedOut || overallController.signal.aborted) {
          const timeoutErr = new Error('OpenRouter request timed out.');
          timeoutErr.status = 504;
          timeoutErr.code = 'AI_TIMEOUT';
          timeoutErr.fallbackEligible = true;
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
        console.info(`[Recovery:${requestId}] Attempting OpenRouter model: ${this.model} (attempt ${attempt}/${this.maxAttempts})`);

        try {
          const res = await fetch(OPENROUTER_ENDPOINT, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiKey}`,
              'HTTP-Referer': 'https://focusflow.app',
              'X-Title': 'FocusFlow',
            },
            signal: attemptController.signal,
            body: requestBody,
          });

          // Clear per-attempt network timeout immediately once fetch() resolves
          // so it never aborts response.json() or downstream JSON parsing/validation.
          clearTimeout(attemptTimer);
          overallController.signal.removeEventListener('abort', onOverallAbort);

          const fetchDurationMs = Date.now() - attemptStart;
          console.info(
            `[Recovery:${requestId}] OpenRouter fetch completed: response.status=${res.status} (${fetchDurationMs}ms)`
          );

          if (res.ok) {
            const jsonStart = Date.now();
            let data;
            try {
              data = await readBodyWithOverallDeadline(res, overallController.signal);
            } catch (bodyErr) {
              if (bodyErr.name === 'AbortError' || overallTimedOut || externalSignal?.aborted) {
                throw bodyErr;
              }
              const parseErr = new Error(`Failed to read/parse OpenRouter HTTP 200 JSON body: ${bodyErr.message}`);
              parseErr.code = 'AI_INVALID_RESPONSE';
              parseErr.status = 502;
              parseErr.fallbackEligible = true;
              throw parseErr;
            }
            console.info(`[Recovery:${requestId}] response.json() completed (${Date.now() - jsonStart}ms)`);

            if (overallTimedOut || externalSignal?.aborted) {
              const abortErr = new Error('Aborted after response body');
              abortErr.name = 'AbortError';
              throw abortErr;
            }

            const choicesStart = Date.now();
            const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
            console.info(
              `[Recovery:${requestId}] choices extraction completed (found=${Boolean(choice)}, ${Date.now() - choicesStart}ms)`
            );

            const contentStart = Date.now();
            const content = choice?.message?.content;
            console.info(
              `[Recovery:${requestId}] message.content extraction completed (length=${typeof content === 'string' ? content.length : 0}, ${Date.now() - contentStart}ms)`
            );

            const parseStart = Date.now();
            const parsed = extractJsonContent(content);
            console.info(
              `[Recovery:${requestId}] Model JSON parsing & validation completed (${Date.now() - parseStart}ms)`
            );

            circuitState.consecutiveFailures = 0;
            circuitState.openedUntil = 0;

            const result = {
              ...parsed,
              provider: 'openrouter',
              model: data?.model || this.model,
              isDevProvider: false,
              isFallback: false,
              approach: context.userInput?.approach || 'balanced',
            };
            console.info(
              `[Recovery:${requestId}] Final provider return ready (total=${Date.now() - attemptStart}ms)`
            );
            return result;
          }

          const rawText = await res.text().catch(() => '');
          const safeText = rawText.replace(/sk-or-[^\s"']+/gi, '[REDACTED]').slice(0, 200);

          if (res.status === 401 || res.status === 403) {
            const authErr = new Error('Invalid OpenRouter API key. Check server OPENROUTER_API_KEY.');
            authErr.status = res.status;
            authErr.code = 'AI_INVALID_KEY';
            throw authErr;
          }

          if (res.status === 400 || res.status === 404) {
            const modelErr = new Error(`Invalid OpenRouter request or model (${res.status}): ${safeText}`);
            modelErr.status = res.status;
            modelErr.code = res.status === 404 ? 'AI_INVALID_MODEL' : 'AI_BAD_REQUEST';
            throw modelErr;
          }

          if (!RETRYABLE_STATUS_CODES.has(res.status)) {
            const err = new Error(`OpenRouter request failed (${res.status}): ${safeText}`);
            err.status = 502;
            err.code = 'AI_UPSTREAM_ERROR';
            throw err;
          }

          lastError = new Error(
            res.status === 429
              ? 'OpenRouter rate limit reached.'
              : 'OpenRouter provider is temporarily unavailable.'
          );
          lastError.status = res.status;
          lastError.code = res.status === 429 ? 'AI_RATE_LIMIT' : 'AI_UNAVAILABLE';
          lastError.fallbackEligible = true;

          if (attempt >= this.maxAttempts) break;

          const retryAfterHeader = typeof res.headers?.get === 'function' ? res.headers.get('retry-after') : null;
          const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
          const delayMs = computeBackoffDelayMs(attempt - 1, {
            baseDelayMs: this.baseDelayMs,
            jitterFn: this.jitterFn,
            retryAfterMs,
          });
          if (delayMs >= deadlineMs - Date.now()) {
            lastError.code = 'AI_TIMEOUT';
            lastError.status = 504;
            break;
          }
          await this.sleepFn(delayMs, overallController.signal);
        } catch (attemptErr) {
          if (
            attemptErr.code === 'AI_INVALID_KEY' ||
            attemptErr.code === 'AI_INVALID_MODEL' ||
            attemptErr.code === 'AI_BAD_REQUEST' ||
            attemptErr.code === 'AI_UPSTREAM_ERROR'
          ) {
            throw attemptErr;
          }

          if (attemptErr.code === 'AI_INVALID_RESPONSE') {
            console.warn(`[Recovery:${requestId}] OpenRouter HTTP 200 invalid content: ${attemptErr.message}`);
            throw attemptErr;
          }

          if (externalSignal?.aborted) {
            const cancelErr = new Error('Recovery request was cancelled by the client.');
            cancelErr.status = 499;
            cancelErr.code = 'CLIENT_CANCELLED';
            cancelErr.fallbackEligible = false;
            throw cancelErr;
          }

          const durationMs = Date.now() - attemptStart;
          if (overallTimedOut || overallController.signal.aborted) {
            lastError = new Error('OpenRouter request timed out.');
            lastError.status = 504;
            lastError.code = 'AI_TIMEOUT';
            lastError.fallbackEligible = true;
            break;
          }

          console.warn(
            `[Recovery:${requestId}] OpenRouter attempt ${attempt} failed (${attemptTimedOut ? 'timeout' : 'network_error'}) in ${durationMs}ms`
          );
          lastError = new Error(attemptTimedOut ? 'OpenRouter attempt timed out.' : 'Network failure reaching OpenRouter.');
          lastError.status = attemptTimedOut ? 504 : 502;
          lastError.code = attemptTimedOut ? 'AI_TIMEOUT' : 'AI_NETWORK_ERROR';
          lastError.fallbackEligible = true;

          if (attempt >= this.maxAttempts) break;

          const delayMs = computeBackoffDelayMs(attempt - 1, {
            baseDelayMs: this.baseDelayMs,
            jitterFn: this.jitterFn,
          });
          if (delayMs >= deadlineMs - Date.now()) {
            lastError.code = 'AI_TIMEOUT';
            lastError.status = 504;
            break;
          }
          await this.sleepFn(delayMs, overallController.signal);
        } finally {
          clearTimeout(attemptTimer);
          overallController.signal.removeEventListener('abort', onOverallAbort);
        }
      }

      if (lastError?.fallbackEligible) {
        circuitState.consecutiveFailures += 1;
        if (circuitState.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
          circuitState.openedUntil = Date.now() + CIRCUIT_OPEN_MS;
          console.warn(`[Recovery:${requestId}] OpenRouter circuit breaker opened for ${CIRCUIT_OPEN_MS}ms`);
        }
      }

      throw lastError || new Error('OpenRouter request failed.');
    } catch (err) {
      if (externalSignal?.aborted || err.code === 'CLIENT_CANCELLED') {
        // Client cancellation must never count as a provider failure or trip the circuit breaker
        const cancelErr = new Error('Recovery request was cancelled by the client.');
        cancelErr.status = 499;
        cancelErr.code = 'CLIENT_CANCELLED';
        cancelErr.fallbackEligible = false;
        throw cancelErr;
      }
      if (err.name === 'AbortError' || overallTimedOut) {
        circuitState.consecutiveFailures += 1;
        const timeoutErr = new Error('OpenRouter request timed out.');
        timeoutErr.status = 504;
        timeoutErr.code = 'AI_TIMEOUT';
        timeoutErr.fallbackEligible = true;
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(overallTimer);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  }
}
