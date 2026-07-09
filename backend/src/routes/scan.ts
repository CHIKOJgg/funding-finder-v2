import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { validateExchangeList } from '../middleware/auth.js';
import { requireSubscription, getSubscriptionLimits } from '../middleware/subscription.js';
import { runScan } from '../services/scanService.js';
import { wsManager } from '../services/websocket.js';
import { logger } from '../utils/logger.js';

const router = Router();

const VALID_EXCHANGES = ['gate', 'binance', 'bybit', 'mexc', 'okx'];

const scanSchema = z.object({
  exchanges: z.array(z.enum(['gate', 'binance', 'bybit', 'mexc', 'okx'])).min(1).max(5).default(['gate']),
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
    const result = await runScan(exchanges);

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

    res.json({ ok: true, result });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error, exchanges: req.body.exchanges }, 'Scan endpoint error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

export default router;
