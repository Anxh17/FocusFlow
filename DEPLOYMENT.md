# FocusFlow Deployment Guide

FocusFlow is a React + Vite frontend paired with an Express API proxy (`server/index.js`) so AI provider credentials remain strictly server-side.

## 1. Environment Variables

Copy `.env.example` to `.env` (never commit `.env` to Git):

| Variable | Side | Purpose | Default |
|---|---|---|---|
| `AI_PROVIDER` | Server | `openrouter`, `gemini`, or `deterministic` | `openrouter` |
| `PORT` | Server | Express HTTP port | `3001` |
| `OPENROUTER_API_KEY` | Server | OpenRouter API key (required when `AI_PROVIDER=openrouter`) | — |
| `OPENROUTER_MODEL` | Server | Free-tier OpenRouter model (`openrouter/free` or `*:free`) | `mistralai/mistral-small-3.1-24b-instruct:free` |
| `OPENROUTER_TIMEOUT_MS` | Server | Overall OpenRouter deadline (ms) | `90000` |
| `OPENROUTER_ATTEMPT_TIMEOUT_MS` | Server | Per-attempt network timeout (ms) | `15000` |
| `GEMINI_API_KEY` | Server | Optional Gemini API key (`AI_PROVIDER=gemini`) | — |
| `GEMINI_MODEL` | Server | Primary Gemini model | `gemini-3.1-flash-lite` |
| `GEMINI_FALLBACK_MODEL` | Server | Gemini 503 fallback model | `gemini-3.8-flash` |
| `CORS_ORIGIN` | Server | Comma-separated allowed origins for split hosting | — |
| `VITE_API_BASE_URL` | Frontend (build-time) | Optional backend origin if hosted separately from `dist/` | `""` (same origin) |

## 2. Option A — Single-Server Deployment (Recommended)

Build the frontend and let `server/index.js` serve both `dist/` (with SPA fallback) and `/api/*`:

```bash
npm install
cd server && npm install && cd ..
npm run build
NODE_ENV=production node --env-file=.env server/index.js
```

Verify health:

```bash
curl http://localhost:3001/api/health
```

## 3. Option B — Split Frontend + Backend Deployment

- **Backend (Render / Railway / Fly.io):**
  - Root directory: project root (install both root/server dependencies or `cd server && npm install`)
  - Start command: `node server/index.js`
  - Env vars: `AI_PROVIDER`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `CORS_ORIGIN=https://your-frontend-domain.com`
- **Frontend (Vercel / Netlify / Cloudflare Pages):**
  - Build command: `npm run build`
  - Output directory: `dist`
  - Env var: `VITE_API_BASE_URL=https://your-backend-domain.com`
  - SPA rewrite: route all non-file paths to `/index.html`.
