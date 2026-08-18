# Funding Finder v2

**Funding-rate arbitrage finder** — a full TypeScript rewrite: Node.js/Express + Prisma backend, React 18 + Vite + Tailwind frontend, PostgreSQL database. Runs as a Telegram Mini App and a public website, scanning 24 crypto exchanges for funding-rate arbitrage opportunities in real time.

---

## 📌 Overview

Funding Finder continuously scans perpetual futures across two dozen centralized and decentralized exchanges, computes cross-exchange funding-rate spreads, and surfaces the best risk-adjusted opportunities. Users get:

- **Live arbitrage scanner** — per-pair annualized spread, risk tier, and route details
- **Arbitrage alerts** — threshold-based notifications via Telegram, email, Pushover
- **Spot↔Futures basis** and **funding calendar** views
- **Portfolio simulator & live PnL** — connect exchange API keys for real positions
- **AI analysis** — OpenRouter-powered model commentary on top opportunities
- **Subscriptions & payments** — Crypto Pay (Telegram) and NOWPayments (web)
- **Referral program**, trial mode, funnel analytics, B2B webhooks

---

## 🏗️ Architecture

```
funding-finder-v2/
├── backend/            # Node.js + Express + Prisma + TypeScript
│   ├── src/
│   │   ├── index.ts            # App entrypoint (server, middleware, routes)
│   │   ├── config/             # Zod-validated env config (fail-closed)
│   │   ├── routes/             # 30+ route modules (auth, scan, arbitrage, …)
│   │   ├── services/           # Business logic (scan, alerts, payments, …)
│   │   ├── exchanges/          # 24 exchange scanners (binance, bybit, …)
│   │   ├── middleware/         # auth, rate-limit, request logger, admin
│   │   └── utils/              # prisma, redis, metrics, websocket, sentry
│   ├── prisma/schema.prisma   # 25-model PostgreSQL schema
│   └── Dockerfile
├── frontend/           # React 18 + Vite + Tailwind + TypeScript
│   ├── src/
│   │   ├── pages/             # Main, Arbitrage, Portfolio, Profile, …
│   │   ├── components/        # 40+ UI components (lucide-react icons)
│   │   └── i18n/              # en, ru, tr, vi, hi, es
│   └── Dockerfile
├── docker-compose.yml  # db (pg16) + backend + frontend (nginx)
├── .env.example        # All env vars documented
├── DEPLOYMENT.md       # Step-by-step Render / Docker / Railway / Fly.io guide
├── REDESIGN_PLAN.md    # Frontend visual redesign execution plan (11 phases)
└── package.json        # Root workspace scripts
```

**Stack:**
- Backend: Node 20, Express 4, Prisma 5, Zod, BullMQ (Redis queue), ioredis, pino logging, Sentry
- Frontend: React 18, Vite 5, Tailwind 3, lucide-react, react-router-dom 6, Capacitor (mobile)
- Infra: PostgreSQL 16, Docker Compose, Prometheus metrics, Swagger docs

---

## 🚀 Quick Start

### Local (Docker)

```bash
cp .env.example .env          # fill in real secrets
docker-compose up --build     # db + backend + frontend
```

Then open http://localhost — health check at http://localhost:3000/api/health.

### Local (bare Node)

```bash
npm install
cd backend && npx prisma generate && npx prisma migrate dev
cd ../frontend && npm install && npm run build
cd backend && npm run dev    # backend (tsx watch)
cd ../frontend && npm run dev # frontend (vite)
```

### Cloud (Render — free tier)

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full walkthrough: create a PostgreSQL database, deploy the backend web service and frontend static site, set environment variables, configure the Telegram Mini App, and verify.

```bash
# Health check after deploy
curl https://your-api.onrender.com/api/health
# {"ok":true,"status":"healthy","timestamp":"..."}
```

---

## 📡 API

Base URL configurable via `API_BASE_URL`. All routes return JSON `{ ok: true, ... }` or `{ ok: false, error: ... }`.

### Public (no auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Liveness (db latency, memory, uptime) |
| GET | `/api/ready` | Readiness (db ping) |
| GET | `/api/public/*` | Landing widget, funnel data |
| GET | `/api/market/*` | OI, long/short ratio, liquidations |
| GET | `/api/feature-flags` | Feature flag state |

### Authenticated (Bearer JWT or Telegram init-data)

| Path group | Routes |
|---|---|
| `/api/scan` | Multi-exchange funding scan |
| `/api/arbitrage` | Opportunities, alerts, spot-futures, heatmap |
| `/api/ai` | AI analysis + history |
| `/api/alerts` | Create / list / delete alerts |
| `/api/portfolio` | Simulator + live positions + CSV export |
| `/api/profile` | Balance, referral stats, usage |
| `/api/payments` | Crypto Pay + NOWPayments checkout |
| `/api/keys` | Encrypted exchange API key management |
| `/api/trial` | Trial mode |
| `/api/funding` | Funding calendar |
| `/api/watchlist` | Watched pairs |
| `/api/settings` | User preferences |
| `/api/export` | CSV export |
| `/api/history` | Historical funding data |
| `/api/analytics` | Funnel analytics |
| `/api/referrals` | Referral stats + credit |
| `/api/admin` | Admin dashboard (admin role) |
| `/api/debug` | Diagnostics (admin role) |
| `/api/v1` | Versioned public API contract |

WebSocket: `wss://<api>/ws?initData=...` for live funding pushes.

Admin-only: `/api/metrics` (system info), `/api/prometheus` (Prometheus scrape).

Documentation: `/docs` (Swagger UI, gated behind `api_docs` feature flag).

---

## ⚙️ Configuration

Copy `.env.example` → `.env` (repo root for Docker) or `backend/.env` (bare-node). All values are validated with Zod at startup — the server is **fail-closed**: an unset `NODE_ENV` is treated as production, and weak/placeholder secrets (`JWT_SECRET`, `WEBHOOK_SECRET`, `ENCRYPTION_KEY`, min 32 chars) block startup.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` / `DIRECT_URL` | PostgreSQL (pooled + direct) |
| `NODE_ENV` | `production` / `development` / `test` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot (required in prod) |
| `JWT_SECRET` | API signing key (≥32 chars, prod) |
| `WEBHOOK_SECRET` | Webhook HMAC key (≥32 chars, prod) |
| `ENCRYPTION_KEY` | AES-256-GCM key for stored exchange keys (≥32 chars, prod) |
| `OPENROUTER_API_KEY` | AI model provider |
| `CRYPTO_PAY_API_TOKEN` | Telegram Mini App payments |
| `NOWPAYMENTS_API_KEY` / `NOWPAYMENTS_IPN_SECRET` | Web crypto checkout |
| `GOOGLE_CLIENT_ID` | Google OAuth (web) |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `API_BASE_URL` | Public API URL (IPN callbacks, keep-alive) |
| `REDIS_URL` | Optional — enables BullMQ + cross-instance dedupe |
| `PROMETHEUS_PUBLIC` | `1` = public scrape, `0` = admin-only |

Full variable list and generation commands: see [DEPLOYMENT.md §1](DEPLOYMENT.md).

---

## 🧪 Testing & CI

```bash
npm test              # backend (jest) + frontend (vitest)
npm run typecheck     # both workspaces
npm run lint          # both workspaces
npm run build         # both workspaces
```

GitHub Actions (`.github/workflows/ci.yml`) runs backend (typecheck → build → tests → security audit, with a Postgres 16 service container), frontend (typecheck → build → tests → audit), and Docker image builds for both.

---

## 🔐 Security Notes

- **Webhook signature verification** — Crypto Pay HMAC-SHA256 and NOWPayments HMAC-SHA512 are verified against the **raw request body** (`express.json` `verify` hook stores `req.rawBody`). Don't let a proxy/reverse-proxy re-serialize the body.
- **Exchange API keys** are never stored in plaintext — only AES-256-GCM `encPayload`; the secret never reaches the client.
- **Rate limiting** — global (6000/15min), auth (3000/15min), public (300/15min), market data (300/15min), client-log (300/15min). Health/metrics/prometheus paths are unmetered.
- **CORS** is origin-allowlisted; `helmet` CSP is set; `trust proxy` enabled for Render/nginx.
- **Fail-closed secrets** — placeholder values are rejected in production; `NODE_ENV` unset ⇒ production.
- `.env` is in `.gitignore`; only `.env.example` is tracked. `opencode.json` is also gitignored (it contains local dev secrets).

Rotate secrets before any production deploy — see [DEPLOYMENT.md §1](DEPLOYMENT.md).

---

## 📄 License

[MIT](LICENSE) — Copyright (c) 2026 Funding Finder.

---

## 📚 More Documentation

- **[DEPLOYMENT.md](DEPLOYMENT.md)** — Full deployment guide: Render, Docker, Railway, Fly.io, Telegram MiniApp setup, verification checklist, troubleshooting, production hardening.
- **[REDESIGN_PLAN.md](REDESIGN_PLAN.md)** — Frontend visual redesign plan (design tokens, 11 execution phases, spec compliance audit). Backend is out of scope.