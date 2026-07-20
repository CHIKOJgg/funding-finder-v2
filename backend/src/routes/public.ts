import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { detectArbitrageOpportunities } from '../services/arbitrageService.js';
import { getCachedScan, runScan } from '../services/scanService.js';
import { getWarmupPromise } from '../services/fundingWarmup.js';
import { SUPPORTED_EXCHANGES } from '../exchanges/index.js';
import { prisma } from '../services/prisma.js';
import { logger } from '../utils/logger.js';
import { computeTrackRecord } from '../services/trackRecordService.js';

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

// Social-proof track record: an ILLUSTRATIVE market-neutral funding
// arbitrage paper backtest from real scanned history. Powers the landing-page
// "what you could have earned" proof and is the key trust element for converting
// free visitors into trials. Clearly a ceiling estimate (no fees/slippage).
router.get('/trackrecord', async (_req, res) => {
  try {
    const rec = await computeTrackRecord();
    if (!rec.available) {
      return res.json({ ok: true, available: false, note: 'Not enough history yet' });
    }
    return res.json({ ...rec, illustrative: true });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Public track record error');
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Lead magnet: capture interested visitors who aren't ready to pay yet, so they
// can be re-engaged by email/newsletter. No auth required.
const waitlistSchema = z.object({
  email: z.string().email().optional(),
  telegram: z.string().optional(),
  lang: z.string().optional(),
  source: z.string().optional(),
  interest: z.enum(['passive', 'arbitrage']).optional(),
}).refine((d) => d.email || d.telegram, {
  message: 'email or telegram is required',
});

router.post('/waitlist', validate(waitlistSchema), async (req, res) => {
  try {
    const { email, telegram, lang, source, interest } = req.body;
    // Dedupe by email when provided; never throw on a repeat signup.
    if (email) {
      const existing = await prisma.waitlist.findUnique({ where: { email } });
      if (existing) {
        return res.json({ ok: true, already: true, message: 'Already on the list' });
      }
    }
    await prisma.waitlist.create({
      data: {
        email: email ?? null,
        telegram: telegram ?? null,
        lang: lang ?? null,
        source: source ?? null,
        interest: interest ?? null,
      },
    });
    logger.info({ email, telegram, source, interest }, 'Waitlist signup');
    return res.json({ ok: true, message: 'Subscribed' });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Waitlist signup error');
    return res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;
