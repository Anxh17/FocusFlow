import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createAIProvider, generateRecoveryWithFallback } from './aiProvider.js';
import { handleCoachChat } from './coachHandler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const LOCK_STALE_MS = 95000;
let activeRecovery = null; // { requestId, startedAt } | null

// Configurable CORS for split frontend/backend deployments
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.includes('*') || allowedOrigins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Request-Id');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  return next();
});

app.use(express.json({ limit: '512kb' }));

app.get('/api/health', (_req, res) => {
  const providerType = (process.env.AI_PROVIDER || 'openrouter').toLowerCase();
  const configured =
    providerType === 'deterministic' ||
    providerType === 'dev' ||
    (providerType === 'gemini' && Boolean(process.env.GEMINI_API_KEY)) ||
    (providerType === 'openrouter' && Boolean(process.env.OPENROUTER_API_KEY));
  res.json({
    ok: true,
    provider: providerType,
    configured,
  });
});

app.post('/api/recover', async (req, res) => {
  const startTime = Date.now();
  const headerReqId = req.headers['x-request-id'];
  const requestId = typeof headerReqId === 'string' && headerReqId.trim()
    ? headerReqId.trim().slice(0, 32)
    : crypto.randomUUID().slice(0, 8);
  const context = req.body;
  const providerType = (process.env.AI_PROVIDER || 'openrouter').toLowerCase();

  console.info(`[Recovery:${requestId}] Request started (provider: ${providerType})`);

  if (activeRecovery && Date.now() - activeRecovery.startedAt < LOCK_STALE_MS) {
    console.warn(`[Recovery:${requestId}] Rejected duplicate request; active=${activeRecovery.requestId}`);
    return res.status(409).json({
      error: 'A schedule recovery request is already in progress. Please wait for it to finish.',
      code: 'RECOVERY_IN_PROGRESS',
    });
  }

  if (!context || typeof context !== 'object' || !context.goal || !context.tasks || !context.schedule) {
    return res.status(400).json({
      error: 'Invalid recovery request payload. Expected goal, tasks, and schedule.',
      code: 'INVALID_REQUEST',
    });
  }

  if (!Array.isArray(context.tasks.pending)) {
    return res.status(400).json({
      error: 'Invalid recovery request: tasks.pending must be an array.',
      code: 'INVALID_REQUEST',
    });
  }

  const requestController = new AbortController();
  const onResponseClose = () => {
    // Use res.on('close') rather than req.on('close'): req emits 'close' as soon as
    // the POST body finishes reading, whereas res emits 'close' when the HTTP
    // connection closes before res.end() completes.
    if (!res.writableEnded) {
      console.warn(`[Recovery:${requestId}] Client disconnected before response finished; aborting upstream`);
      requestController.abort();
    }
  };
  res.on('close', onResponseClose);

  activeRecovery = { requestId, startedAt: startTime };
  try {
    const provider = createAIProvider();
    const result = await generateRecoveryWithFallback(context, provider, {
      requestId,
      signal: requestController.signal,
    });
    console.info(
      `[Recovery:${requestId}] Backend response sent in ${Date.now() - startTime}ms (provider: ${result.provider}${result.isFallback ? ', fallback' : ''})`
    );
    return res.json(result);
  } catch (err) {
    const status = err.status || 500;
    const code = err.code || 'RECOVERY_FAILED';
    console.error(`[Recovery:${requestId}] Request failed in ${Date.now() - startTime}ms (status: ${status}, code: ${code})`);
    if (res.writableEnded) return undefined;
    return res.status(status).json({
      error: err.message || 'Failed to generate recovery plan.',
      code,
    });
  } finally {
    res.off('close', onResponseClose);
    if (activeRecovery?.requestId === requestId) {
      activeRecovery = null;
    }
  }
});

app.post('/api/coach/chat', async (req, res) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const { question, history, context } = req.body || {};

  if (typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({
      error: 'Question is required.',
      code: 'INVALID_REQUEST',
    });
  }

  try {
    const result = await handleCoachChat({
      question: question.trim(),
      history: Array.isArray(history) ? history : [],
      context: context && typeof context === 'object' ? context : {},
      requestId,
    });
    return res.json(result);
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.message || 'Coach chat failed.',
      code: err.code || 'COACH_ERROR',
    });
  }
});

// Serve built Vite SPA in production when dist/ is present
if (fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  app.use(express.static(DIST_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

app.listen(PORT, () => {
  const providerType = (process.env.AI_PROVIDER || 'openrouter').toLowerCase();
  console.log(`FocusFlow server listening on http://localhost:${PORT} (provider: ${providerType})`);
});
