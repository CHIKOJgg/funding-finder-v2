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
import { perUserLimiter } from './middleware/rateLimit.js';
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
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'wss:', 'https:'],
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
]);

// Rate limiting (generous global cap — the app is request-heavy: each page
// load fires ~10-15 authenticated calls, plus live polling). Health/metrics
// pings are excluded so they don't starve real-user quota.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => UNMETERED_PATHS.has(req.path),
  message: { ok: false, error: 'Too many requests, please try again later' },
});
app.use('/api/', limiter);

// Rate limit for auth-protected app endpoints (scan, arbitrage, profile, etc.)
// Headroom is sized for normal usage (page loads + ~1-2 live polls/min).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => UNMETERED_PATHS.has(req.path),
  message: { ok: false, error: 'Too many requests, please try again later' },
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

// Metrics endpoint (detailed system info)
app.get('/api/metrics', authenticate, async (req, res) => {
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

// Routes with auth
// Scan hits many exchange APIs and AI calls cost money, so add a strict
// per-user cap on top of the global limiter.
app.use('/api', authLimiter, authenticate, perUserLimiter(60, 15 * 60 * 1000), scanRoutes);
app.use('/api', authLimiter, authenticate, perUserLimiter(30, 15 * 60 * 1000), aiRoutes);
app.use('/api', authLimiter, authenticate, historyRoutes);
app.use('/api', authLimiter, authenticate, analyticsRoutes);

// Admin routes (require admin role)
app.use('/api', authenticate, adminRoutes);

// Webhook routes (no user auth, webhook token/signature verified inside)
app.use('/api/webhook', webhookRoutes);

// Public web-auth routes (wallet SIWE + Google). These ESTABLISH a session, so
// they must not sit behind the global `authenticate` middleware.
app.use('/api/auth', authLimiter, authRoutes);

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
// Live portfolio + auto-execute places real orders on user exchanges — keep it tightly throttled per user.
app.use('/api', authLimiter, authenticate, perUserLimiter(20, 15 * 60 * 1000), portfolioLiveRoutes);
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
  wsManager.close();
  await shutdownJobQueues();
  await disconnectDatabase();
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
  if (config.isProduction) {
    process.exit(1);
  }
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
  process.exit(1);
});

start();

export default app;
