import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';
import fs from 'fs';
import { createServer } from 'http';
import rateLimit from 'express-rate-limit';
import { config } from './config/index.js';
import { connectDatabase, disconnectDatabase, checkDatabaseHealth } from './services/prisma.js';
import { logger } from './utils/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestId, requestLogger } from './middleware/requestLogger.js';
import { validateTelegramInitData, validateExchangeList, AuthenticatedRequest } from './middleware/auth.js';
import { startAlertEvaluator, stopAlertEvaluator } from './services/alertEvaluator.js';
import { startDailySummary, stopDailySummary } from './services/dailySummary.js';
import { startDataArchival, stopDataArchival } from './services/dataArchival.js';
import { wsManager } from './services/websocket.js';
import { cache, circuitBreaker } from './utils/exchangeClient.js';
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
import webhookRoutes from './routes/webhook.js';

const app = express();
const server = createServer(app);

// Trust the reverse proxy (Render/Nginx/etc.) so express-rate-limit and
// req.ip work correctly with the X-Forwarded-For header.
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
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

app.use(express.json({ limit: '1mb' }));

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

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests, please try again later' },
});
app.use('/api/', limiter);

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many auth requests' },
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
app.get('/api/metrics', validateTelegramInitData, async (req, res) => {
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
app.use('/api', authLimiter, validateTelegramInitData, scanRoutes);
app.use('/api', authLimiter, validateTelegramInitData, aiRoutes);
app.use('/api', authLimiter, validateTelegramInitData, historyRoutes);
app.use('/api', authLimiter, validateTelegramInitData, analyticsRoutes);

// Webhook routes (no user auth, webhook token/signature verified inside)
app.use('/api/webhook', webhookRoutes);

// Protected routes (auth required)
app.use('/api/alerts', authLimiter, validateTelegramInitData, alertsRoutes);
app.use('/api', authLimiter, validateTelegramInitData, arbitrageRoutes);
app.use('/api', authLimiter, validateTelegramInitData, paymentsRoutes);
app.use('/api', authLimiter, validateTelegramInitData, referralsRoutes);
app.use('/api', authLimiter, validateTelegramInitData, profileRoutes);
app.use('/api', authLimiter, validateTelegramInitData, exportRoutes);
app.use('/api', authLimiter, validateTelegramInitData, settingsRoutes);

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

// Start server
async function start() {
  try {
    await connectDatabase();

    server.listen(config.port, () => {
      logger.info(`Funding Finder v2 listening at http://localhost:${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
      wsManager.init(server);
      initJobQueues();
      startAlertEvaluator();
      startDailySummary();
      startDataArchival();
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
