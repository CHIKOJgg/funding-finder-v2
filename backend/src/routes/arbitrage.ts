import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
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
  canonicalPairKey,
} from '../services/arbitrageService.js';
import { getSpotFutures, SF_SUPPORTED_EXCHANGES } from '../services/spotFuturesService.js';
import { getLivePriceBatch } from '../services/priceService.js';
import { getLiveFundingBatch } from '../services/fundingService.js';
import { runScan, getCachedScan } from '../services/scanService.js';
import { getWarmupPromise } from '../services/fundingWarmup.js';
import { getSubscriptionLimits, requireSubscription, planRank } from '../middleware/subscription.js';
import { SUPPORTED_EXCHANGES } from '../exchanges/index.js';
import { prisma } from '../services/prisma.js';
import { logger } from '../utils/logger.js';
import { sendError } from '../middleware/errorHandler.js';

const router = Router();

// Resolve the native fundingHistory key (e.g. "gate:BTC_USDT") for a canonical
// pair ("BTCUSDT"): the scanner stores history under native contract names, so
// we canonicalize the stored keys and match the requested pair.
async function resolveNativeKey(exchange: string, canonical: string): Promise<string | null> {
  const rows = await prisma.fundingHistory.findMany({
    where: { key: { startsWith: `${exchange}:` } },
    select: { key: true },
  });
  for (const { key } of rows) {
    const sep = key.indexOf(':');
    if (sep === -1) continue;
    if (canonicalPairKey(key.slice(sep + 1)) === canonical) return key;
  }
  return null;
}

// Group records by day, taking the latest rate each day per exchange.
function latestPerDay(records: { timestamp: Date; funding: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of records) {
    const d = r.timestamp;
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
    map.set(key, r.funding); // last one wins (sorted asc)
  }
  return map;
}

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
    res.json({ ok: true, alert, message: 'Оповещение создано' });
  } catch (e) {
    sendError(res, 500, 'Failed to create alert', 'ARBITRAGE_ALERT_CREATE_ERROR');
  }
});

router.get('/alerts/arbitrage', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const alerts = await getUserArbitrageAlerts(userId);
    res.json({ ok: true, alerts });
  } catch (e) {
    sendError(res, 500, 'Failed to fetch alerts', 'ARBITRAGE_ALERTS_FETCH_ERROR');
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
    sendError(res, 500, 'Failed to delete alert', 'ARBITRAGE_ALERT_DELETE_ERROR');
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
    sendError(res, 500, 'Failed to toggle alert', 'ARBITRAGE_ALERT_TOGGLE_ERROR');
  }
});

router.get('/arbitrage/opportunities', async (req, res) => {
  const exchangesParam = req.query.exchanges as string;
  let exchanges = exchangesParam
    ? exchangesParam.split(',').filter((e) => SUPPORTED_EXCHANGES.includes(e))
    : SUPPORTED_EXCHANGES;
  if (exchanges.length === 0) exchanges = SUPPORTED_EXCHANGES;

  let isGuest = false;
  const userId = (req as AuthenticatedRequest).userId;
  if (userId) {
    if (userId.startsWith('guest_') || (req as any).user?.authProvider === 'guest') {
      isGuest = true;
    } else {
      try {
        const u = await prisma.user.findUnique({ where: { telegramId: userId }, select: { authProvider: true } });
        if (u?.authProvider === 'guest') {
          isGuest = true;
        }
      } catch {}
    }
  } else {
    isGuest = true;
  }

  // Cap to the user's plan so a free user can never trigger a full 31-exchange
  // live scan (that's what was timing out and surfacing as a network error).
  try {
    if (userId) {
      const limits = await getSubscriptionLimits(userId);
      if (exchanges.length > limits.maxExchanges) {
        exchanges = exchanges.slice(0, limits.maxExchanges);
      }
    }
  } catch {
    // If we can't read plan limits, proceed with the requested set.
  }

  const key = arbOppKey(exchanges);

  // Fast path: return the recently computed opportunities instantly. The UI
  // polls this, so this is what keeps the tab responsive and API-light.
  const cachedOpp = arbOppCache.get(key);
  if (cachedOpp && Date.now() - cachedOpp.ts < ARB_OPP_CACHE_TTL_MS) {
    const opps = isGuest ? cachedOpp.opportunities.slice(0, 1) : cachedOpp.opportunities;
    return res.json({
      ok: true,
      opportunities: opps,
      metadata: cachedOpp.metadata,
      totalOpportunities: cachedOpp.opportunities.length,
      isGuest,
      guestLocked: isGuest,
      cached: true,
    });
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

    const rawOpportunities = detectArbitrageOpportunities(allResults);
    const metadata = {
      scanned: scanResults.scanned,
      intervalDistribution: scanResults.metrics.intervalDistribution,
      averageIntervalHours: scanResults.metrics.averageIntervalHours,
    };
    arbOppCache.set(key, { opportunities: rawOpportunities, metadata, ts: Date.now() });

    const opportunities = isGuest ? rawOpportunities.slice(0, 1) : rawOpportunities;
    return res.json({
      ok: true,
      opportunities,
      metadata,
      totalOpportunities: rawOpportunities.length,
      isGuest,
      guestLocked: isGuest,
    });
  } catch (e) {
    const error = e as Error;
    // Serve the last good opportunities so a transient scan failure never
    // surfaces as "can't load new opportunities" on a routine poll.
    const stale = arbOppCache.get(key);
    if (stale) {
      logger.warn({ err: error.message }, 'Arbitrage opportunities served stale after scan error');
      const opps = isGuest ? stale.opportunities.slice(0, 1) : stale.opportunities;
      return res.json({
        ok: true,
        opportunities: opps,
        metadata: stale.metadata,
        totalOpportunities: stale.opportunities.length,
        isGuest,
        guestLocked: isGuest,
        stale: true,
      });
    }
    // Never return a hard 500 for a routine poll — that is what surfaces as
    // "Failed to load opportunities" in the mini app. Degrade gracefully to an
    // empty list with a flag the client can show as a soft notice.
    logger.error({ err: error }, 'Arbitrage opportunities error (degraded to empty)');
    return res.json({ ok: true, opportunities: [], degraded: true, isGuest, guestLocked: isGuest, reason: error.message || String(error) });
  }
});

router.post('/arbitrage/calculate-profit', requireSubscription('pro'), validate(calculateProfitSchema), async (req, res) => {
  try {
    const { opportunity, capital } = req.body;
    const profit = calculateProfit(opportunity, capital);
    res.json({ ok: true, profit });
  } catch (e) {
    sendError(res, 500, 'Failed to calculate profit', 'ARBITRAGE_PROFIT_CALC_ERROR');
  }
});

router.get('/arbitrage/backtest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pair = (req.query.pair as string || '').toUpperCase();
    const exchangeA = (req.query.exchangeA as string || '').toLowerCase();
    const exchangeB = (req.query.exchangeB as string || '').toLowerCase();
    const capital = parseFloat(req.query.capital as string) || 1000;
    const days = Math.min(parseInt(req.query.days as string) || 30, 90);

    if (!pair || !exchangeA || !exchangeB) {
      return sendError(res, 400, 'pair, exchangeA, exchangeB required', 'VALIDATION_ERROR');
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [keyA, keyB] = await Promise.all([
      resolveNativeKey(exchangeA, canonicalPairKey(pair)),
      resolveNativeKey(exchangeB, canonicalPairKey(pair)),
    ]);

    const [rowsA, rowsB] = await Promise.all([
      prisma.fundingHistory.findMany({
        where: {
          key: keyA ?? { startsWith: `${exchangeA}:` },
          timestamp: { gte: since },
        },
        orderBy: { timestamp: 'asc' },
      }),
      prisma.fundingHistory.findMany({
        where: {
          key: keyB ?? { startsWith: `${exchangeB}:` },
          timestamp: { gte: since },
        },
        orderBy: { timestamp: 'asc' },
      }),
    ]);

    if (rowsA.length === 0 && rowsB.length === 0) {
      return res.json({
        ok: true,
        pair,
        exchangeA,
        exchangeB,
        days,
        dataPoints: 0,
        totalProfit: 0,
        avgSpreadPercent: 0,
        winRate: 0,
        dailyHistory: [],
        message: 'No historical funding data found for this pair/exchange combination',
      });
    }

    const mapA = latestPerDay(rowsA);
    const mapB = latestPerDay(rowsB);

    const allDays = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort();

    let totalProfit = 0;
    let winningDays = 0;
    let spreadSum = 0;
    let matchedDays = 0;

    const dailyHistory: Array<{
      date: string;
      rateA: number;
      rateB: number;
      spread: number;
      profitUsdt: number;
    }> = [];

    for (const d of allDays) {
      const rateA = mapA.get(d) ?? 0;
      const rateB = mapB.get(d) ?? 0;
      const spread = Math.abs(rateA - rateB);

      if (mapA.has(d) && mapB.has(d)) {
        matchedDays++;
        spreadSum += spread;
      }

      const profitUsdt = capital * spread;
      totalProfit += profitUsdt;
      if (spread > 0) winningDays++;

      dailyHistory.push({
        date: d,
        rateA,
        rateB,
        spread,
        profitUsdt,
      });
    }

    const dataPoints = dailyHistory.length;
    const avgSpreadPercent = matchedDays > 0 ? (spreadSum / matchedDays) * 100 : 0;
    const winRate = dataPoints > 0 ? (winningDays / dataPoints) * 100 : 0;

    return res.json({
      ok: true,
      pair,
      exchangeA,
      exchangeB,
      days,
      capital,
      dataPoints,
      totalProfit: Math.round(totalProfit * 100) / 100,
      avgSpreadPercent: Math.round(avgSpreadPercent * 10000) / 10000,
      winRate: Math.round(winRate * 10) / 10,
      dailyHistory,
    });
  } catch (err) {
    logger.error('Backtest error:', err);
    return sendError(res, 500, 'Failed to compute backtest', 'BACKTEST_ERROR');
  }
});

const SPOT_FUTURES_STALE_MS = 60_000;
let sfCache: { data: any[]; ts: number } | null = null;

router.get('/spot-futures', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawExchanges = req.query.exchanges as string;
    let requestedExchanges: string[] | undefined;

    if (rawExchanges) {
      const requested = rawExchanges.split(',').map((e) => e.trim().toLowerCase());
      const valid = requested.filter((e) => SF_SUPPORTED_EXCHANGES.includes(e));
      if (valid.length === 0) {
        return res.status(400).json({
          ok: false,
          error: `None of the requested exchanges are supported for spot-futures. Supported: ${SF_SUPPORTED_EXCHANGES.join(', ')}`,
        });
      }
      requestedExchanges = valid;
    }

    if (
      !requestedExchanges &&
      sfCache &&
      Date.now() - sfCache.ts < SPOT_FUTURES_STALE_MS
    ) {
      return res.json({ ok: true, basis: sfCache.data, cached: true });
    }

    const opportunities = await getSpotFutures(requestedExchanges);

    if (!requestedExchanges) {
      sfCache = { data: opportunities, ts: Date.now() };
    }

    return res.json({ ok: true, basis: opportunities });
  } catch (err) {
    logger.error('Spot-futures endpoint error:', err);
    if (sfCache) {
      return res.json({ ok: true, basis: sfCache.data, stale: true });
    }
    return sendError(res, 500, 'Failed to fetch spot-futures opportunities', 'SPOT_FUTURES_ERROR');
  }
});

export default router;