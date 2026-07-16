import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { validateExchangeList } from '../middleware/auth.js';
import { requireSubscription, getSubscriptionLimits } from '../middleware/subscription.js';
import { runScan, getCachedScan } from '../services/scanService.js';
import { wsManager } from '../services/websocket.js';
import { SUPPORTED_EXCHANGES } from '../exchanges/index.js';
import { logger } from '../utils/logger.js';
import { perUserLimiter } from '../middleware/rateLimit.js';

const router = Router();

// Scan hits many exchange APIs + can trigger AI cost, so cap it per user.
// Mounted here (not at app.use('/api')) so it only counts real /scan hits
// and never bleeds into other /api routes.
router.use(perUserLimiter(300, 15 * 60 * 1000, 'scan'));

// Serve a cached scan instantly (stale-while-revalidate) if one exists.
const SCAN_STALE_MS = 60_000;

const VALID_EXCHANGES = SUPPORTED_EXCHANGES;

const scanSchema = z.object({
  exchanges: z.array(z.enum(SUPPORTED_EXCHANGES as [string, ...string[]])).min(1).max(25).default(['gate']),
});

router.post('/scan', requireSubscription('free'), validate(scanSchema), validateExchangeList, async (req, res) => {
  try {
    const { exchanges } = req.body;
    const userId = (req as any).userId;
    if (userId) {
      const limits = await getSubscriptionLimits(userId);
      if (exchanges.length > limits.maxExchanges) {
        return res.status(403).json({
          ok: false,
          error: `Your ${limits.tier} plan allows max ${limits.maxExchanges} exchanges`,
          requested: exchanges.length,
          maxAllowed: limits.maxExchanges,
        });
      }
    }
    // Stale-while-revalidate: return a cached scan immediately, refresh in background.
    const cached = getCachedScan(exchanges);
    let result;
    if (cached) {
      result = cached.result;
      if (cached.ageMs > SCAN_STALE_MS) {
        runScan(exchanges).catch((err) => logger.warn({ err: (err as Error).message }, 'Background scan refresh failed'));
      }
    } else {
      result = await runScan(exchanges);
    }

    // Broadcast scan results to WebSocket subscribers
    wsManager.broadcast('scan', {
      exchanges,
      scanned: result.scanned,
      highYieldCount: result.highYield.length,
      mediumYieldCount: result.mediumYield.length,
      lowYieldCount: result.lowYield.length,
      topPairs: result.highYield.slice(0, 10).map((r) => ({
        pair: r.contract,
        exchange: r.exchange,
        ratePerHour: r.funding_rate_per_hour,
      })),
    });

    res.json({ ok: true, result, cached: Boolean(cached) });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error, exchanges: req.body.exchanges }, 'Scan endpoint error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

export default router;
