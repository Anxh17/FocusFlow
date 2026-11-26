import { OPENROUTER_ENDPOINT, DEFAULT_OPENROUTER_MODEL, isFreeOpenRouterModel } from './openrouterProvider.js';

const COACH_TIMEOUT_MS = 25000;

function buildCoachSystemPrompt(context) {
  return `You are FocusFlow's supportive, practical AI Productivity Coach.
Rules:
- Base every observation strictly on the provided JSON productivity context. Never invent metrics or tasks.
- Use supportive, non-judgmental language.
- Provide concise, actionable advice (2–4 sentences or short bullet points).
- You cannot directly modify or delete tasks; if schedule changes are needed, suggest the user run "Recover My Day" or adjust tasks themselves.

USER PRODUCTIVITY CONTEXT:
${JSON.stringify(context)}`;
}

function buildDeterministicServerReply(question, context) {
  const q = (question || '').toLowerCase();
  const s = context?.summary || {};
  const w = context?.weeklyReport || {};
  const top = Array.isArray(context?.topActionableTasks) ? context.topActionableTasks[0] : null;

  if (q.includes('focus') || q.includes('prioritize') || q.includes('today')) {
    return top
      ? `Focus next on "${top.title}" (${top.estimatedMinutes}m, ${top.priority} priority). Today has ${s.todayPlannedMinutes || 0}m planned against ${s.dailyCapacityMinutes || 120}m daily capacity.`
      : `You currently have ${s.pendingCount || 0} pending task(s) and ${s.overdueCount || 0} overdue task(s).`;
  }
  if (q.includes('week') || q.includes('productive')) {
    return `This week you completed ${w.tasksCompleted || 0} task(s) (${w.completionRate ?? 'N/A'}% completion), logged ${w.focusTimeFormatted || '0m'} of focus time, and had ${w.postponements || 0} postponement(s). Main obstacle: ${w.mainObstacle || 'None detected.'}`;
  }
  return `You are at ${s.completionPct ?? 0}% completion with ${s.overdueCount ?? 0} overdue task(s) and ${s.totalPostponements ?? 0} postponement(s). ${w.mainObstacle || ''}`.trim();
}

export async function handleCoachChat({ question, history = [], context = {}, requestId = 'coach' }) {
  const providerType = (process.env.AI_PROVIDER || 'openrouter').toLowerCase();

  if (providerType === 'deterministic' || providerType === 'dev') {
    return {
      reply: buildDeterministicServerReply(question, context),
      provider: 'deterministic',
      model: 'built-in',
      isFallback: false,
    };
  }

  const messages = [
    { role: 'system', content: buildCoachSystemPrompt(context) },
    ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: question },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COACH_TIMEOUT_MS);

  try {
    if (providerType === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY || '';
      const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
      if (!apiKey) {
        const err = new Error('GEMINI_API_KEY is not configured on the server.');
        err.status = 503;
        err.code = 'AI_NOT_CONFIGURED';
        throw err;
      }

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: `${buildCoachSystemPrompt(context)}\n\nUser question: ${question}` }],
            },
          ],
          generationConfig: { temperature: 0.3 },
        }),
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          const authErr = new Error('Invalid Gemini API key.');
          authErr.status = res.status;
          authErr.code = 'AI_INVALID_KEY';
          throw authErr;
        }
        throw Object.assign(new Error(`Gemini returned ${res.status}`), { fallbackEligible: true });
      }

      const data = await res.json();
      const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!reply) throw Object.assign(new Error('Empty Gemini reply'), { fallbackEligible: true });

      return { reply, provider: 'gemini', model, isFallback: false };
    }

    // Primary: OpenRouter (free models only)
    const apiKey = process.env.OPENROUTER_API_KEY || '';
    const model = process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;

    if (!apiKey) {
      const err = new Error('OPENROUTER_API_KEY is not configured on the server.');
      err.status = 503;
      err.code = 'AI_NOT_CONFIGURED';
      throw err;
    }

    if (!isFreeOpenRouterModel(model)) {
      const err = new Error(`Invalid OpenRouter model "${model}". Only free models are permitted.`);
      err.status = 400;
      err.code = 'AI_INVALID_MODEL';
      throw err;
    }

    console.info(`[Coach:${requestId}] Calling OpenRouter model: ${model}`);
    const res = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://focusflow.app',
        'X-Title': 'FocusFlow',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages,
      }),
    });

    if (res.status === 401 || res.status === 403) {
      const authErr = new Error('Invalid OpenRouter API key.');
      authErr.status = res.status;
      authErr.code = 'AI_INVALID_KEY';
      throw authErr;
    }

    if (res.status === 400 || res.status === 404) {
      const modelErr = new Error(`Invalid OpenRouter model or request (${res.status}).`);
      modelErr.status = res.status;
      modelErr.code = res.status === 404 ? 'AI_INVALID_MODEL' : 'AI_BAD_REQUEST';
      throw modelErr;
    }

    if (!res.ok) {
      throw Object.assign(new Error(`OpenRouter returned ${res.status}`), { fallbackEligible: true });
    }

    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      throw Object.assign(new Error('Empty OpenRouter reply'), { fallbackEligible: true });
    }

    return {
      reply,
      provider: 'openrouter',
      model: data?.model || model,
      isFallback: false,
    };
  } catch (err) {
    if (err.code === 'AI_INVALID_KEY' || err.code === 'AI_INVALID_MODEL' || err.code === 'AI_BAD_REQUEST' || err.code === 'AI_NOT_CONFIGURED') {
      throw err;
    }
    console.warn(`[Coach:${requestId}] Falling back to deterministic reply (${err.message})`);
    return {
      reply: buildDeterministicServerReply(question, context),
      provider: 'deterministic',
      model: 'built-in',
      isFallback: true,
      fallbackMessage: 'AI is temporarily unavailable. Showing deterministic guidance from your local data.',
    };
  } finally {
    clearTimeout(timer);
  }
}
