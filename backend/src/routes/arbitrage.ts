import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import {
  createArbitrageAlert,
  getUserArbitrageAlerts,
  deleteArbitrageAlert,
  toggleArbitrageAlert,
  detectArbitrageOpportunities,
  calculateProfit,
  getPersistenceGrade,
} from '../services/arbitrageService.js';
import { getSpotFutures, SF_SUPPORTED_EXCHANGES } from '../services/spotFuturesService.js';
import { getLivePriceBatch } from '../services/priceService.js';
import { getLiveFundingBatch } from '../services/fundingService.js';
import { runScan, getCachedScan } from '../services/scanService.js';
import { getWarmupPromise } from '../services/fundingWarmup.js';
import { getSubscriptionLimits } from '../middleware/subscription.js';
import { SUPPORTED_EXCHANGES } from '../exchanges/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Serve a cached scan instantly (stale-while-revalidate) if one covers the
// requested exchanges. Mirrors the resilient behaviour of POST /scan so the
// Arbitrage tab never blocks on a cold 25-exchange live scan.
const SCAN_STALE_MS = 60_000;

// Cache the LAST computed opportunities per exchange-set. The UI polls this
// endpoint on an interval; returning a cached (or last-good) result means the
// poll is always instant and never surfaces as "can't load opportunities" just
// because a fresh live scan is temporarily slow or unavailable.
const arbOppCache = new Map<string, { opportunities: any[]; metadata: any; ts: number }>();
const ARB_OPP_CACHE_TTL_MS = 60_000;
const ARB_OPP_CACHE_MAX_SIZE = 500;

// Evict stale entries every 5 minutes so the cache never leaks.
setInterval(() => {
  const cutoff = Date.now() - ARB_OPP_CACHE_TTL_MS * 2;
  for (const [k, v] of arbOppCache) {
    if (v.ts < cutoff) arbOppCache.delete(k);
  }
  if (arbOppCache.size > ARB_OPP_CACHE_MAX_SIZE) {
    const sorted = [...arbOppCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < sorted.length - ARB_OPP_CACHE_MAX_SIZE; i++) {
      arbOppCache.delete(sorted[i][0]);
    }
  }
}, 300_000).unref();

function arbOppKey(exchanges: string[]): string {
  return [...new Set(exchanges)].sort().join(',');
}

const createAlertSchema = z.object({
  pair: z.string().min(1),
  exchangeA: z.string().min(1),
  exchangeB: z.string().min(1),
  condition: z.string().optional(),
  threshold: z.number().optional(),
  direction: z.string().optional(),
  cooldown: z.number().optional(),
});

const calculateProfitSchema = z.object({
  opportunity: z.object({
    exchangeA: z.string(),
    exchangeB: z.string(),
    difference: z.number(),
    difference_per_day: z.number(),
    volumeA: z.number(),
    volumeB: z.number(),
    intervalA_hours: z.number(),
    intervalB_hours: z.number(),
    intervalMismatch: z.boolean(),
    percentageDiff: z.number(),
  }),
  capital: z.number().min(100),
});

router.post('/alerts/arbitrage', validate(createAlertSchema), async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const { pair, exchangeA, exchangeB, condition, threshold, direction, cooldown } = req.body;
    const alert = await createArbitrageAlert(userId, {
      pair,
      exchangeA,
      exchangeB,
      condition,
      threshold,
      direction,
      cooldown,
    });
    logger.info(`Created arbitrage alert for user ${userId}: ${pair} ${exchangeA} vs ${exchangeB}`);
    res.json({ ok: true, alert, message: 'Арбитражное оповещение создано успешно' });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Create arbitrage alert error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

router.get('/alerts/arbitrage', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await getUserArbitrageAlerts(userId, limit, offset);
    res.json({ ok: true, ...result });
  } catch (e) {
    const error = e as Error;
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

router.delete('/alerts/arbitrage/:alertId', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const { alertId } = req.params;
    const success = await deleteArbitrageAlert(userId, alertId);
    if (success) {
      res.json({ ok: true, message: 'Оповещение удалено' });
    } else {
      res.status(404).json({ ok: false, error: 'Оповещение не найдено' });
    }
  } catch (e) {
    const error = e as Error;
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

router.post('/alerts/arbitrage/:alertId/toggle', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const { alertId } = req.params;
    const alert = await toggleArbitrageAlert(userId, alertId);
    if (alert) {
      res.json({ ok: true, alert, message: `Оповещение ${alert.isActive ? 'включено' : 'выключено'}` });
    } else {
      res.status(404).json({ ok: false, error: 'Оповещение не найдено' });
    }
  } catch (e) {
    const error = e as Error;
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

router.get('/arbitrage/opportunities', async (req, res) => {
  const exchangesParam = req.query.exchanges as string;
  let exchanges = exchangesParam
    ? exchangesParam.split(',').filter((e) => SUPPORTED_EXCHANGES.includes(e))
    : SUPPORTED_EXCHANGES;
  if (exchanges.length === 0) exchanges = SUPPORTED_EXCHANGES;

  // Cap to the user's plan so a free user can never trigger a full 25-exchange
  // live scan (that's what was timing out and surfacing as a network error).
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const limits = await getSubscriptionLimits(userId);
    if (exchanges.length > limits.maxExchanges) {
      exchanges = exchanges.slice(0, limits.maxExchanges);
    }
  } catch {
    // If we can't read plan limits, proceed with the requested set.
  }

  const key = arbOppKey(exchanges);

  // Fast path: return the recently computed opportunities instantly. The UI
  // polls this, so this is what keeps the tab responsive and API-light.
  const cachedOpp = arbOppCache.get(key);
  if (cachedOpp && Date.now() - cachedOpp.ts < ARB_OPP_CACHE_TTL_MS) {
    return res.json({ ok: true, opportunities: cachedOpp.opportunities, metadata: cachedOpp.metadata, cached: true });
  }

  try {
    // SWR: return a cached scan immediately if one covers these exchanges
    // (the warm full-set cache counts as a superset), refresh in the background.
    let cached = getCachedScan(exchanges);
    if (!cached) {
      // Cold start: a warm-up scan may already be running (or about to). Ride
      // it instead of firing our own cold live scan — otherwise the user's
      // request and the warm-up would scan concurrently and saturate the box.
      const warm = getWarmupPromise();
      if (warm) {
        await warm;
        cached = getCachedScan(exchanges);
      }
    }

    let scanResults;
    if (cached) {
      scanResults = cached.result;
      if (cached.ageMs > SCAN_STALE_MS) {
        runScan(exchanges).catch((err) =>
          logger.warn({ err: (err as Error).message }, 'Background arbitrage scan refresh failed')
        );
      }
    } else {
      scanResults = await runScan(exchanges);
    }

    const allResults = [
      ...scanResults.highYield,
      ...scanResults.mediumYield,
      ...scanResults.lowYield,
    ];

    const opportunities = await detectArbitrageOpportunities(allResults);
    // Attach persistence grade (A-F) to each opportunity
    for (const opp of opportunities) {
      opp.persistenceGrade = getPersistenceGrade(opp.pair, opp.exchangeA, opp.exchangeB);
    }
    const metadata = {
      scanned: scanResults.scanned,
      intervalDistribution: scanResults.metrics.intervalDistribution,
      averageIntervalHours: scanResults.metrics.averageIntervalHours,
    };
    arbOppCache.set(key, { opportunities, metadata, ts: Date.now() });

    return res.json({ ok: true, opportunities, metadata });
  } catch (e) {
    const error = e as Error;
    // Serve the last good opportunities so a transient scan failure never
    // surfaces as "can't load new opportunities" on a routine poll.
    const stale = arbOppCache.get(key);
    if (stale) {
      logger.warn({ err: error.message }, 'Arbitrage opportunities served stale after scan error');
      return res.json({ ok: true, opportunities: stale.opportunities, metadata: stale.metadata, stale: true });
    }
    // Never return a hard 500 for a routine poll — that is what surfaces as
    // "Failed to load opportunities" in the mini app. Degrade gracefully to an
    // empty list with a flag the client can show as a soft notice.
    logger.error({ err: error }, 'Arbitrage opportunities error (degraded to empty)');
    return res.json({ ok: true, opportunities: [], degraded: true, reason: error.message || String(error) });
  }
});

router.post('/arbitrage/calculate-profit', validate(calculateProfitSchema), async (req, res) => {
  try {
    const { opportunity, capital } = req.body;
    const result = await calculateProfit(opportunity, capital);
    res.json({
      ok: true,
      profit: result.profit,
      risk: result.risk,
      calculation: {
        capital,
        netHourly: result.profit.netHourly,
        netDaily: result.profit.netDaily,
        netAnnual: result.profit.netAnnual,
        hourlyROI: result.profit.hourlyReturn,
        annualROI: result.profit.annualReturn,
      },
    });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Profit calculation error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

// Spot-Futures (cash-and-carry) snapshot for a single pair: spot price, perp
// mark, basis %, funding rate and the annualized yield of longing spot +
// shorting the perp to collect funding.
router.get('/arbitrage/spot-futures', async (req, res) => {
  try {
    const exchange = (req.query.exchange as string) || 'binance';
    const pair = (req.query.pair as string) || 'BTCUSDT';
    const data = await getSpotFutures(exchange, pair);
    res.json({ ok: true, ...data, supportedExchanges: SF_SUPPORTED_EXCHANGES });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Spot-futures error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

// Unified live snapshot: ONE request that resolves the live price AND funding
// rate for every (exchange, symbol) the client is currently showing, across all
// exchanges. This collapses what used to be N separate /price/batch + N
// /funding/batch GETs (one pair per exchange) into a single call per tick —
// the core fix for the 429 storm that previously tripped any per-user budget
// the moment more than a handful of exchanges were selected.
//
// Body: { requests: [{ exchange, symbols: [...] }] }
// Response: {
//   prices:  { "binance:BTCUSDT": 12345.6, ... },
//   funding: { "binance:BTCUSDT": { ratePerHour, intervalHours, rawRate, nextApply }, ... }
// }
// Keys are `${exchange}:${SYMBOL.toUpperCase()}` so the frontend can index
// directly without re-keying per exchange.
const LIVE_BATCH_MAX_EXCHANGES = 30;
const LIVE_BATCH_MAX_SYMBOLS_PER_EXCHANGE = 50;

router.post('/live/batch', async (req, res) => {
  try {
    const requests = req.body?.requests;
    if (!Array.isArray(requests)) {
      return res.status(400).json({ ok: false, error: 'requests array required' });
    }
    const limited = requests.slice(0, LIVE_BATCH_MAX_EXCHANGES);
    const prices: Record<string, number> = {};
    const funding: Record<string, any> = {};

    await Promise.all(
      limited.map(async (r: any) => {
        const exchange = (r?.exchange as string) || '';
        if (!exchange || !SUPPORTED_EXCHANGES.includes(exchange)) return;
        const symbols = Array.isArray(r?.symbols)
          ? r.symbols.map((s: any) => String(s).trim()).filter(Boolean).slice(0, LIVE_BATCH_MAX_SYMBOLS_PER_EXCHANGE)
          : [];
        if (symbols.length === 0) return;

        const [priceMap, fundingMap] = await Promise.all([
          getLivePriceBatch(exchange, symbols),
          getLiveFundingBatch(exchange, symbols),
        ]);
        for (const [s, p] of Object.entries(priceMap as Record<string, number>)) {
          if (typeof p === 'number' && isFinite(p) && p > 0) prices[`${exchange}:${s.toUpperCase()}`] = p;
        }
        for (const [s, f] of Object.entries(fundingMap as Record<string, any>)) {
          if (f && typeof f.ratePerHour === 'number' && isFinite(f.ratePerHour)) {
            funding[`${exchange}:${s.toUpperCase()}`] = f;
          }
        }
      })
    );

    res.json({ ok: true, prices, funding });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Live batch error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

// Batch live perp prices for the symbols the user is currently viewing on the
// Funding list. Keys are the (uppercased) symbols passed in; only visible rows
// are ever requested, so this stays cheap.
router.get('/price/batch', async (req, res) => {
  try {
    const exchange = (req.query.exchange as string) || 'binance';
    const symbolsParam = req.query.symbols as string;
    const symbols = symbolsParam
      ? symbolsParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50)
      : [];
    if (symbols.length === 0) {
      return res.json({ ok: true, prices: {} });
    }
    const prices = await getLivePriceBatch(exchange, symbols);
    const missing = symbols.filter((s) => prices[s.toUpperCase()] == null);
    if (missing.length) {
      // A missing price almost always means the exchange API is unreachable
      // from this host (datacenter IP blocked / DNS / WAF) — not a code bug.
      // Surfacing it makes "prices aren't live" diagnosable at a glance.
      logger.warn({ exchange, missing }, `Live price batch: ${missing.length}/${symbols.length} symbols returned no price`);
    }
    res.json({ ok: true, prices });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Price batch error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

// Batch live funding rates for the symbols the user is currently viewing on the
// Arbitrage cards. Returns { symbol: { ratePerHour, intervalHours, rawRate,
// nextApply } } for every symbol that resolved. Keys are the (uppercased)
// symbols passed in; only visible rows are ever requested, so this stays cheap.
router.get('/funding/batch', async (req, res) => {
  try {
    const exchange = (req.query.exchange as string) || 'binance';
    const symbolsParam = req.query.symbols as string;
    const symbols = symbolsParam
      ? symbolsParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50)
      : [];
    if (symbols.length === 0) {
      return res.json({ ok: true, funding: {} });
    }
    const funding = await getLiveFundingBatch(exchange, symbols);
    const missing = symbols.filter((s) => funding[s.toUpperCase()] == null);
    if (missing.length) {
      logger.warn({ exchange, missing }, `Live funding batch: ${missing.length}/${symbols.length} symbols returned no rate`);
    }
    res.json({ ok: true, funding });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Funding batch error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

export default router;
