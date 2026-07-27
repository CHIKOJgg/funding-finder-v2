import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import {
  getLatestOpenInterest,
  getOpenInterestHistory,
  getLongShortRatioHistory,
  getLiquidationSnapshots,
  getOiWeightedFundingRate,
} from '../services/marketDataService.js';
import { logger } from '../utils/logger.js';
import { sendError } from '../middleware/errorHandler.js';
import { perUserLimiter } from '../middleware/rateLimit.js';

const router = Router();

const marketDataLimiter = perUserLimiter(200, 15 * 60 * 1000, 'market-data');

const querySchema = z.object({
  exchange: z.string().optional().default('binance'),
  contract: z.string().optional().default('BTCUSDT'),
  hours: z.coerce.number().min(1).max(720).optional().default(168),
  limit: z.coerce.number().min(1).max(1000).optional().default(200),
});

const oiWeightedCache = new Map<string, { value: number; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;
const OI_WEIGHTED_CACHE_MAX = 500;

function getCachedOiWeighted(key: string, fetchFn: () => Promise<number>): Promise<number> {
  // Evict stale entries periodically (every 50 calls)
  if (oiWeightedCache.size > OI_WEIGHTED_CACHE_MAX) {
    const now = Date.now();
    for (const [k, v] of oiWeightedCache) {
      if (now >= v.expiresAt) oiWeightedCache.delete(k);
      if (oiWeightedCache.size <= OI_WEIGHTED_CACHE_MAX) break;
    }
  }
  const cached = oiWeightedCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return Promise.resolve(cached.value);
  }
  return fetchFn().then((value) => {
    oiWeightedCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  });
}

router.get('/open-interest/:exchange/:contract', marketDataLimiter, async (req, res) => {
  try {
    const { exchange, contract } = req.params;
    const result = await getLatestOpenInterest(exchange, contract);
    res.json({ ok: true, data: result });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error, exchange: req.params.exchange, contract: req.params.contract }, 'OI lookup failed');
    sendError(res, 500, 'OI lookup failed', 'OI_ERROR');
  }
});

router.get('/open-interest-history', marketDataLimiter, validate(querySchema), async (req, res) => {
  try {
    const { exchange, contract, hours } = req.query as unknown as { exchange: string; contract: string; hours: number };
    const records = await getOpenInterestHistory(exchange, contract, hours);
    res.json({ ok: true, data: records, count: records.length });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'OI history fetch failed');
    sendError(res, 500, 'OI history fetch failed', 'OI_HISTORY_ERROR');
  }
});

router.get('/long-short-ratio/:exchange/:contract', marketDataLimiter, async (req, res) => {
  try {
    const { exchange, contract } = req.params;
    const history = await getLongShortRatioHistory(exchange, contract, 168);
    const latest = history.length > 0 ? history[history.length - 1] : null;
    res.json({ ok: true, latest, history });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error, exchange: req.params.exchange, contract: req.params.contract }, 'LSR lookup failed');
    sendError(res, 500, 'LSR lookup failed', 'LSR_ERROR');
  }
});

router.get('/long-short-ratio-history', marketDataLimiter, validate(querySchema), async (req, res) => {
  try {
    const { exchange, contract, hours } = req.query as unknown as { exchange: string; contract: string; hours: number };
    const records = await getLongShortRatioHistory(exchange, contract, hours);
    res.json({ ok: true, data: records, count: records.length });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'LSR history fetch failed');
    sendError(res, 500, 'LSR history fetch failed', 'LSR_HISTORY_ERROR');
  }
});

router.get('/liquidation-snapshots/:exchange/:contract', marketDataLimiter, async (req, res) => {
  try {
    const { exchange, contract } = req.params;
    const hours = parseInt((req.query as any).hours as string) || 24;
    const snapshots = await getLiquidationSnapshots(exchange, contract, hours);
    res.json({ ok: true, data: snapshots, count: snapshots.length });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error, exchange: req.params.exchange, contract: req.params.contract }, 'Liquidation lookup failed');
    sendError(res, 500, 'Liquidation lookup failed', 'LIQUIDATION_ERROR');
  }
});

const oiWeightedQuerySchema = z.object({
  contract: z.string().min(1),
  exchanges: z.string().min(1),
});

router.get('/oi-weighted-rate', marketDataLimiter, validate(oiWeightedQuerySchema, 'query'), async (req, res) => {
  try {
    const { contract, exchanges: exchangesStr } = req.query as unknown as { contract: string; exchanges: string };
    const exchanges = exchangesStr.split(',').map((e) => e.trim()).filter(Boolean);
    if (exchanges.length < 2 || exchanges.length > 10) {
      return sendError(res, 400, 'Provide 2-10 comma-separated exchanges', 'OI_WEIGHTED_INPUT');
    }
    const exchangeRates = exchanges.map((e) => ({ exchange: e, rate: 0 }));
    const key = `oi-weighted:${contract}:${exchanges.join(',')}`;
    try {
      const result = await getCachedOiWeighted(key, () => getOiWeightedFundingRate(contract, exchangeRates));
      res.json({ ok: true, data: result });
    } catch (_) {
      res.json({ ok: true, data: 0 });
    }
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'OI weighted rate fetch failed');
    sendError(res, 500, 'OI weighted rate fetch failed', 'OI_WEIGHTED_ERROR');
  }
});

export default router;