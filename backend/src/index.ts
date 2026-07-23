import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { createServer } from 'http';
import rateLimit from 'express-rate-limit';
import { config } from './config/index.js';
import { connectDatabase, disconnectDatabase, checkDatabaseHealth } from './services/prisma.js';
import { logger } from './utils/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestId, requestLogger } from './middleware/requestLogger.js';
import { perUserLimiter, createRateLimitStore } from './middleware/rateLimit.js';
import { authenticate } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import { startAlertEvaluator, stopAlertEvaluator } from './services/alertEvaluator.js';
import { startDailySummary, stopDailySummary } from './services/dailySummary.js';
import { startDataArchival, stopDataArchival } from './services/dataArchival.js';
import { startFundingWarmup, stopFundingWarmup } from './services/fundingWarmup.js';
import { wsManager } from './services/websocket.js';
import { cache } from './utils/exchangeClient.js';
import { setupSwagger } from './utils/swagger.js';
import { featureFlags } from './utils/featureFlags.js';
import { metricsMiddleware, getMetrics, metricsContentType } from './utils/metrics.js';
import { initJobQueues, shutdownJobQueues, getJobStats } from './services/jobQueue.js';
import { getArchiveStats } from './services/dataArchival.js';
import { startTelegramBot, stopTelegramBot } from './services/bot/telegramBot.js';
import { startPublicSignalChannel, stopPublicSignalChannel } from './services/publicSignalChannel.js';
import { startWeeklyReport, stopWeeklyReport } from './services/weeklyReport.js';

// Routes
import scanRoutes from './routes/scan.js';
import aiRoutes from './routes/ai.js';
import alertsRoutes from './routes/alerts.js';
import arbitrageRoutes from './routes/arbitrage.js';
import paymentsRoutes from './routes/payments.js';
import referralsRoutes from './routes/referrals.js';
import historyRoutes from './routes/history.js';
import profileRoutes from './routes/profile.js';
import exportRoutes from './routes/export.js';
import settingsRoutes from './routes/settings.js';
import analyticsRoutes from './routes/analytics.js';
import trialRoutes from './routes/trial.js';
import fundingRoutes from './routes/funding.js';
import watchlistRoutes from './routes/watchlist.js';
import portfolioRoutes from './routes/portfolio.js';
import portfolioLiveRoutes from './routes/portfolioLive.js';
import keysRoutes from './routes/keys.js';
import webhookRoutes from './routes/webhook.js';
import adminRoutes from './routes/admin.js';
import debugRoutes from './routes/debug.js';
import publicRoutes from './routes/public.js';
import { requireAdmin } from './middleware/admin.js';

async function initSentry() {
  if (config.sentry.dsn) {
    try {
      const Sentry = await import('@sentry/node');
      Sentry.init({
        dsn: config.sentry.dsn,
        environment: config.nodeEnv,
        tracesSampleRate: config.isProduction ? 0.1 : 0,
        integrations: [Sentry.expressIntegration()],
      });
      logger.info('Sentry initialized');
      return Sentry;
    } catch (err) {
      logger.warn('Failed to initialize Sentry:', err);
    }
  }
  return null;
}

const app = express();
const server = createServer(app);
void initSentry();

// Trust the reverse proxy (Render/Nginx/etc.) so express-rate-limit and
// req.ip work correctly with the X-Forwarded-For header.
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com', 'https://telegram.org'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com'],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'wss:', 'https:', 'https://accounts.google.com'],
      frameSrc: ["'self'", 'https://accounts.google.com', 'https://web.telegram.org'],
      frameAncestors: ["'self'", 'https://web.telegram.org', 'https://t.me'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
}));

// CORS with restricted origins
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || config.cors.origins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked origin: ${origin}`);
      callback(null, false);
    }
  },
  credentials: true,
}));

app.use(express.json({
  limit: '1mb',
  // Retain the raw request body so webhook signature verification (Crypto Pay)
  // can HMAC the exact bytes that were signed.
  verify: (req, _res, buf) => {
    (req as any).rawBody = buf;
  },
}));

// Response compression (skip for small responses)
app.use(compression({
  threshold: 1024,
  level: 6,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
}));

// Request ID, logging, and metrics
app.use(requestId);
app.use(requestLogger);
app.use(metricsMiddleware);

// Paths that must never consume rate-limit quota: automated uptime/health
// checks and monitoring pings would otherwise burn through the budget and
// trip the limiter for real users ("Too many requests").
const UNMETERED_PATHS = new Set([
  '/api/health',
  '/api/ready',
  '/api/metrics',
  '/api/prometheus',
  '/api/log',
]);

// Shared handler so EVERY rate-limit rejection is logged with the route,
// user and IP — this is the single best signal for diagnosing a 429 storm.
function rateLimitHandler(name: string) {
  return (req: any, res: any, _next: any, options: any) => {
    const userId = req.userId || req.user?.id || null;
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    logger.warn(
      { limiter: name, userId, ip, route: req.path, method: req.method },
      `Rate limit hit (${name}): user=${userId} ip=${ip} ${req.method} ${req.path}`
    );
    res.status(options.statusCode).json(options.message);
  };
}

// Rate limiting (generous global cap — the app is request-heavy: each page
// load fires ~10-15 authenticated calls, plus live polling, often across
// multiple tabs). Health/metrics pings are excluded so they don't starve
// real-user quota.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6000,
  limit: 6000,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore('global'),
  skip: (req) => UNMETERED_PATHS.has(req.path),
  message: { ok: false, error: 'Too many requests, please try again later' },
  handler: rateLimitHandler('global'),
});
app.use('/api/', limiter);

// Rate limit for auth-protected app endpoints (scan, arbitrage, profile, etc.)
// Headroom is sized for normal usage (page loads + ~1-2 live polls/min, plus
// multiple tabs). Each distinct route group consumes from this shared pool, so
// keep it high enough that a heavy session never trips a 429 on ordinary calls.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  limit: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore('auth'),
  skip: (req) => UNMETERED_PATHS.has(req.path),
  message: { ok: false, error: 'Too many requests, please try again later' },
  handler: rateLimitHandler('auth'),
});

// Health check (no auth required)
app.get('/api/health', async (req, res) => {
  try {
    const dbHealth = await checkDatabaseHealth();
    const mem = process.memoryUsage();

    if (!dbHealth.ok) {
      return res.status(503).json({
        ok: false,
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        db: { ok: false, latencyMs: dbHealth.latencyMs },
      });
    }

    res.json({
      ok: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      db: { ok: true, latencyMs: dbHealth.latencyMs },
      memory: {
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        rss: Math.round(mem.rss / 1024 / 1024),
      },
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      status: 'unhealthy',
      error: (err as Error).message,
    });
  }
});

// Ready check
app.get('/api/ready', async (req, res) => {
  try {
    const dbHealth = await checkDatabaseHealth();
    if (!dbHealth.ok) {
      return res.status(503).json({ ok: false, status: 'not ready', reason: 'database' });
    }
    res.json({ ok: true, status: 'ready' });
  } catch (err) {
    res.status(503).json({ ok: false, status: 'not ready' });
  }
});

// Metrics endpoint (detailed system info) — admin-only to avoid leaking
// system internals (cache size, job stats, memory) to any authenticated user.
app.get('/api/metrics', authenticate, requireAdmin, async (req, res) => {
  try {
    const dbHealth = await checkDatabaseHealth();
    const mem = process.memoryUsage();
    const wsStats = wsManager.getStats();
    const jobStats = await getJobStats();
    const archiveStats = await getArchiveStats();

    res.json({
      ok: true,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      db: { ok: dbHealth.ok, latencyMs: dbHealth.latencyMs },
      memory: {
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        rss: Math.round(mem.rss / 1024 / 1024),
        external: Math.round(mem.external / 1024 / 1024),
      },
      cache: { size: cache.size },
      websocket: wsStats,
      jobs: jobStats,
      archive: archiveStats,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// Prometheus metrics endpoint
app.get('/api/prometheus', async (req, res) => {
  try {
    res.setHeader('Content-Type', metricsContentType());
    const metrics = await getMetrics();
    res.send(metrics);
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// API Documentation (gated behind feature flag)
if (featureFlags.isEnabled('api_docs')) {
  setupSwagger(app);
  logger.info('Swagger API docs enabled at /docs');
}

// Feature flags endpoint (public)
app.get('/api/feature-flags', (req, res) => {
  const flags = featureFlags.getAllFlags().map((f) => ({
    name: f.name,
    enabled: f.enabled,
    description: f.description,
    minTier: f.minTier,
  }));
  res.json({ ok: true, flags });
});

// Client log ingestion (Mini App has no DevTools). Accepted WITHOUT auth so it
// works even during a pre-login crash. Subject only to the global request
// limiter; logs are batched client-side (~1.5s) so this is low volume.
import logRoutes from './routes/log.js';
app.use('/api', logRoutes);

// Rate limit for public, unauthenticated endpoints (landing page, heatmap).
// Tighter than global to protect the scan cache from anonymous traffic storms.
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore('public'),
  message: { ok: false, error: 'Rate limited' },
  handler: rateLimitHandler('public'),
});

// Public, unauthenticated marketing surfaces (landing live widget). Mounted
// BEFORE the authenticated /api mounts so '/api/public/*' is NOT caught by the
// global `authenticate` middleware. Cross-origin reads are allowed (no auth/
// cookies); the landing page is hosted on a separate frontend origin.
app.use('/api/public', cors({ origin: true }), publicLimiter, publicRoutes);

// Public web-auth routes (wallet SIWE + Google + email). These ESTABLISH a
// session, so they must NOT sit behind the global `authenticate` middleware.
// Mounted BEFORE /api + authenticate so requests to /api/auth/* and
// /api/v1/auth/* are not intercepted by the auth middleware on the catch-all
// /api prefix.
app.use('/api/auth', authLimiter, authRoutes);
import v1Routes from './routes/v1.js';
app.use('/api/v1/auth', authLimiter, authRoutes);
import { qrAuthRouter, qrPublicRouter } from './routes/qrLogin.js';
app.use('/api', qrPublicRouter);             // /api/qr-login/verify (no auth)

// Routes with auth
// Scan hits many exchange APIs and AI calls cost money, so each route group
// carries its own strict per-user cap (defined inside the route files so the
// limit only counts that group's requests).
app.use('/api', authLimiter, authenticate, scanRoutes);
app.use('/api', authLimiter, authenticate, aiRoutes);
app.use('/api', authLimiter, authenticate, historyRoutes);
app.use('/api', authLimiter, authenticate, analyticsRoutes);

// Unified live price+funding snapshot: ONE request per poll tick (all
// exchanges), so it must be allowed far more often than the per-exchange
// /price/batch + /funding/batch it replaced. Cap is sized for ~1 call/10s
// per visible tab with generous headroom. Auth + global limiter still apply.
app.use('/api/live/batch', authLimiter, authenticate, perUserLimiter(200, 15 * 60 * 1000, 'live-batch'));

// Admin routes (require admin role). Mounted under /api/admin so the global
// `requireAdmin` inside admin.ts only guards /api/admin/* and does NOT swallow
// ordinary /api routes (profile, watchlist, trial, funding, …) mounted later.
app.use('/api/admin', authenticate, adminRoutes);

// Debug/diagnostics routes (require admin role)
app.use('/api/debug', authenticate, requireAdmin, debugRoutes);

// Webhook routes (no user auth, webhook token/signature verified inside)
app.use('/api/webhook', webhookRoutes);

// QR Login routes (request/status need auth)
app.use('/api', authLimiter, authenticate, qrAuthRouter); // /api/qr-login/request, /status

// Public, versioned API contract (Block B2). Decouples the consumer-facing
// surface (/api/v1) from the Mini App's internal /api routes.
app.use('/api/v1', authLimiter, authenticate, v1Routes);

// Protected routes (auth required)
app.use('/api/alerts', authLimiter, authenticate, alertsRoutes);
app.use('/api', authLimiter, authenticate, arbitrageRoutes);
app.use('/api', authLimiter, authenticate, paymentsRoutes);
app.use('/api', authLimiter, authenticate, referralsRoutes);
app.use('/api', authLimiter, authenticate, profileRoutes);
app.use('/api', authLimiter, authenticate, exportRoutes);
app.use('/api', authLimiter, authenticate, settingsRoutes);

// Trial + funding calendar + watchlist + portfolio (auth required)
app.use('/api', authLimiter, authenticate, trialRoutes);
app.use('/api', authLimiter, authenticate, fundingRoutes);
app.use('/api', authLimiter, authenticate, keysRoutes);
// Live portfolio + auto-execute places real orders on user exchanges — keep it tightly throttled per user (see portfolioLive.ts).
app.use('/api', authLimiter, authenticate, portfolioLiveRoutes);
app.use('/api', authLimiter, authenticate, watchlistRoutes);
app.use('/api', authLimiter, authenticate, portfolioRoutes);

// Serve frontend in production only if a built frontend exists.
// On Render the frontend is deployed as a separate Static Site, so the
// API service runs without a local frontend/dist — in that case we expose
// a small JSON status page at "/" instead of 404-ing.
const frontendPath = path.join(__dirname, '../../frontend/dist');
const hasFrontend = fs.existsSync(path.join(frontendPath, 'index.html'));

if (config.nodeEnv === 'production' && hasFrontend) {
  app.use(express.static(frontendPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.json({
      ok: true,
      service: 'funding-finder-api',
      status: 'running',
      docs: '/api/health',
    });
  });
}

// Error handling
app.use(errorHandler);

// Sync database schema at startup.
// We use `prisma db push` rather than `migrate deploy` for the running service:
// it is idempotent and safe (never drops data), works over pooled connections
// (Render's DATABASE_URL is pooled, and `migrate deploy` requires a direct one),
// and works whether or not a migration history table exists. This keeps
// deploys reliable across environments. Run `prisma migrate dev` locally if you
// later want managed migrations + rollback history.
function resolvePrismaBin(): string {
  // node_modules may live at the project root rather than inside `backend/`
  // (depends on how the host installs deps). Walk up from this file to find
  // the prisma CLI binary; fall back to `npx prisma` if it isn't found.
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'node_modules', '.bin', 'prisma');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return 'npx prisma';
}

async function syncDatabaseSchema() {
  const prismaCmd = resolvePrismaBin();
  const env = { ...process.env } as NodeJS.ProcessEnv;
  // `db push` needs a direct (non-pooled) connection to create its shadow
  // database. On Render DATABASE_URL is pooled, so reuse the direct URL as the
  // shadow DB connection when available.
  if (env.DIRECT_URL && !env.SHADOW_DATABASE_URL) {
    env.SHADOW_DATABASE_URL = env.DIRECT_URL;
  }
  try {
    execSync(`${prismaCmd} db push --skip-generate --accept-data-loss`, {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'pipe',
      timeout: 120000,
      env,
    });
    logger.info('Database schema synced (db push)');
  } catch (err) {
    const e = err as { stderr?: Buffer; stdout?: Buffer; message?: string; status?: number };
    const stderr = e.stderr?.toString() || '';
    const stdout = e.stdout?.toString() || '';
    const detail = (stderr || stdout || e.message || 'unknown error').slice(0, 2000);
    if (stderr.includes('P3009') || stdout.includes('P3009')) {
      logger.warn('prisma db push lock timeout — migration likely already in progress');
      return;
    }
    logger.error({ status: e.status, detail }, 'Database schema sync failed');
    process.exit(1);
  }
}

// NOWPayments reconciliation loop — the safety net behind the IPN webhook.
// Polls still-open orders every 20s so payments confirm quickly even if a
// webhook is delayed or dropped. Only runs when an API key is configured.
let nowPaymentsPoller: ReturnType<typeof setInterval> | null = null;

async function startNowPaymentsPolling() {
  const { reconcileNowPaymentsOrders } = await import('./services/nowPaymentsService.js');
  if (!config.nowPayments.apiKey) {
    logger.info('NOWPayments polling skipped (no API key configured)');
    return;
  }
  logger.info('NOWPayments reconciliation poller started');
  nowPaymentsPoller = setInterval(async () => {
    try {
      const updated = await reconcileNowPaymentsOrders();
      if (updated > 0) logger.info(`NOWPayments: confirmed ${updated} order(s)`);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'NOWPayments polling error');
    }
  }, 20_000);
}

function stopNowPaymentsPolling() {
  if (nowPaymentsPoller) {
    clearInterval(nowPaymentsPoller);
    nowPaymentsPoller = null;
  }
}

// Self-ping keep-alive for platforms that spin down idle services (e.g. Render
// free tier sleeps after ~15 min of no traffic). Pinging our own /api/health
// every 10 minutes keeps the instance awake. Prefer API_BASE_URL (the public
// URL) so the request actually reaches the running service; fall back to
// localhost when it isn't configured (e.g. local dev, where this is a no-op).
let selfPingTimer: ReturnType<typeof setInterval> | null = null;

async function startSelfPing() {
  const base = config.apiBaseUrl?.replace(/\/$/, '') || `http://localhost:${config.port}`;
  const url = `${base}/api/health`;
  const intervalMs = 10 * 60 * 1000; // 10 minutes — well under the 15 min idle limit
  logger.info(`Self-ping keep-alive enabled → ${url} every ${intervalMs / 60000} min`);
  const ping = async () => {
    try {
      await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Self-ping failed');
    }
  };
  // Immediate first ping so we don't wait a full interval after a cold start.
  await ping();
  selfPingTimer = setInterval(ping, intervalMs);
}

function stopSelfPing() {
  if (selfPingTimer) {
    clearInterval(selfPingTimer);
    selfPingTimer = null;
  }
}

// Start server
async function start() {
  try {
    await connectDatabase();
    await syncDatabaseSchema();

    server.listen(config.port, () => {
      logger.info(`Funding Finder v2 listening at http://localhost:${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
       wsManager.init(server);
       initJobQueues();
       startAlertEvaluator();
       startDailySummary();
       startDataArchival();
       startFundingWarmup();
        startNowPaymentsPolling();
         startTelegramBot();
          startPublicSignalChannel();
          startWeeklyReport();
          void startSelfPing();
      });
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`${signal} received, shutting down...`);
  stopAlertEvaluator();
  stopDailySummary();
  stopDataArchival();
  stopFundingWarmup();
  stopNowPaymentsPolling();
  stopTelegramBot();
  stopPublicSignalChannel();
  stopWeeklyReport();
  stopSelfPing();
  wsManager.close();
  await shutdownJobQueues();
  await disconnectDatabase();
  const { closeRedis } = await import('./utils/redis.js');
  await closeRedis();
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
  // Do NOT exit in production — a single unhandled rejection from a background
  // task (alert evaluator, warm-up scan, etc.) should not kill the entire server.
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
  process.exit(1);
});

start();

export default app;
