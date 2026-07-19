import { Router } from 'express';
import { detectArbitrageOpportunities } from '../services/arbitrageService.js';
import { getCachedScan, runScan } from '../services/scanService.js';
import { getWarmupPromise } from '../services/fundingWarmup.js';
import { SUPPORTED_EXCHANGES } from '../exchanges/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Public (no-auth) live arbitrage snapshot for the marketing landing page.
//
// The full-set scan cache is already kept warm every 5 minutes by
// `fundingWarmup`, so we serve the cached result instantly and never trigger a
// cold live scan from an unauthenticated visitor. This is the cheapest possible
// marketing surface: a real, fresh "best arbitrage right now" widget that loads
// in milliseconds and needs no login.

const PUBLIC_CACHE_TTL_MS = 60_000;
const publicCache = new Map<string, { payload: any; ts: number }>();

// Keep only the fields the landing widget needs. Smaller payload, no internal
// identifiers or per-user data leaked to anonymous visitors.
function publicOpportunity(opp: any) {
  return {
    pair: opp.pair,
    exchangeA: opp.exchangeA,
    exchangeB: opp.exchangeB,
    opportunity: opp.opportunity,
    fundingA_per_day: opp.fundingA_per_day,
    fundingB_per_day: opp.fundingB_per_day,
    difference_per_day: opp.difference_per_day,
    annualReturn: opp.profit?.annualReturn,
    netDaily: opp.profit?.netDaily,
    riskLevel: opp.risk?.level,
  };
}

router.get('/arbitrage', async (_req, res) => {
  const cached = publicCache.get('top');
  if (cached && Date.now() - cached.ts < PUBLIC_CACHE_TTL_MS) {
    return res.json({ ok: true, ...cached.payload, cached: true });
  }

  try {
    // Prefer the warm full-set cache (already covers all supported exchanges).
    let scan = getCachedScan(SUPPORTED_EXCHANGES);
    if (!scan) {
      // Cold start: ride the running warm-up instead of launching our own scan.
      const warm = getWarmupPromise();
      if (warm) {
        await warm;
        scan = getCachedScan(SUPPORTED_EXCHANGES);
      }
    }
    if (!scan) {
      // Last resort: a single full scan (very rare — only before first warm-up).
      const result = await runScan(SUPPORTED_EXCHANGES);
      scan = { result, ts: Date.now(), ageMs: 0 };
    }

    const allResults = [
      ...scan.result.highYield,
      ...scan.result.mediumYield,
      ...scan.result.lowYield,
    ];

    const opportunities = detectArbitrageOpportunities(allResults)
      .slice(0, 5)
      .map(publicOpportunity);

    // Anonymous "social proof" aggregate derived from the cache itself.
    const pairsInScan = scan.result.scanned || 0;
    const payload = {
      opportunities,
      exchangesTracked: SUPPORTED_EXCHANGES.length,
      pairsTracked: pairsInScan,
      generatedAt: scan.ts,
    };

    publicCache.set('top', { payload, ts: Date.now() });
    return res.json({ ok: true, ...payload });
  } catch (e) {
    const error = e as Error;
    const stale = publicCache.get('top');
    if (stale) {
      logger.warn({ err: error.message }, 'Public arbitrage served stale after error');
      return res.json({ ok: true, ...stale.payload, stale: true });
    }
    logger.error({ err: error }, 'Public arbitrage error (degraded to empty)');
    return res.json({
      ok: true,
      opportunities: [],
      exchangesTracked: SUPPORTED_EXCHANGES.length,
      pairsTracked: 0,
      degraded: true,
    });
  }
});

export default router;
