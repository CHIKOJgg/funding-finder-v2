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
import { computeWeeklyReport } from '../services/weeklyReport.js';
import { sendWaitlistWelcome } from '../services/emailNotify.js';

const router = Router();

// Self-hosted funnel event ingestion. No auth (landing pages are anonymous and
// served from a separate origin), best-effort and never throws — a tracking
// failure must never break the page that fired it.
const trackSchema = z.object({
  event: z.enum(['landing_view', 'app_open', 'scan_run', 'paywall_view', 'trial_start', 'paid']),
  source: z.string().max(40).optional(),
  variant: z.string().max(20).optional(),
  sessionId: z.string().max(80).optional(),
  userId: z.string().max(80).optional(),
  meta: z.record(z.any()).optional(),
});

/**
 * @swagger
 * /public/track:
 *   post:
 *     tags: [Analytics]
 *     summary: Ingest a funnel event
 *     description: >
 *       Track a client-side funnel event (landing_view, app_open, scan_run, etc.).
 *       No authentication required — landing pages are anonymous and served from
 *       a separate origin. Fire-and-forget: analytics failures never 500 the caller.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [event]
 *             properties:
 *               event:
 *                 type: string
 *                 enum: [landing_view, app_open, scan_run, paywall_view, trial_start, paid]
 *                 description: Funnel event name
 *               source:
 *                 type: string
 *                 maxLength: 40
 *                 description: Event source (e.g., 'landing', 'seo', 'referral')
 *               variant:
 *                 type: string
 *                 maxLength: 20
 *                 description: A/B test variant (e.g., 'A' or 'B')
 *               sessionId:
 *                 type: string
 *                 maxLength: 80
 *                 description: Browser session identifier
 *               userId:
 *                 type: string
 *                 maxLength: 80
 *                 description: Authenticated user ID (if known)
 *               meta:
 *                 type: object
 *                 additionalProperties: true
 *                 description: Arbitrary metadata (max 2000 chars when serialized)
 *     responses:
 *       200:
 *         description: Event accepted (best-effort, never fails)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 */
router.post('/track', validate(trackSchema), async (req, res) => {
  try {
    const { event, source, variant, sessionId, userId, meta } = req.body;
    await prisma.funnelEvent.create({
      data: {
        event,
        source: source ?? null,
        variant: variant ?? null,
        sessionId: sessionId ?? null,
        userId: userId ?? null,
        meta: meta ? JSON.stringify(meta).slice(0, 2000) : null,
      },
    });
  } catch (e) {
    // Swallow: analytics must not 500 the caller.
    logger.warn({ err: (e as Error).message }, 'Funnel track ingest failed');
  }
  return res.json({ ok: true });
});

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

/**
 * @swagger
 * /public/arbitrage:
 *   get:
 *     tags: [Arbitrage]
 *     summary: Top arbitrage opportunities (public)
 *     description: >
 *       Public, no-auth endpoint returning the top 5 cross-exchange arbitrage
 *       opportunities from the cached scan. Powers the marketing landing page
 *       "live arbitrage" widget. Serves cached data (60s TTL) — never triggers
 *       a cold scan. Falls back to stale cache on error.
 *     responses:
 *       200:
 *         description: Arbitrage snapshot
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - type: object
 *                   properties:
 *                     ok:
 *                       type: boolean
 *                       example: true
 *                     opportunities:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           pair:
 *                             type: string
 *                             example: "BTC-USDT"
 *                           exchangeA:
 *                             type: string
 *                             example: "binance"
 *                           exchangeB:
 *                             type: string
 *                             example: "bybit"
 *                           opportunity:
 *                             type: string
 *                           fundingA_per_day:
 *                             type: number
 *                           fundingB_per_day:
 *                             type: number
 *                           difference_per_day:
 *                             type: number
 *                           annualReturn:
 *                             type: number
 *                           netDaily:
 *                             type: number
 *                           riskLevel:
 *                             type: string
 *                     exchangesTracked:
 *                       type: integer
 *                       description: Number of exchanges actively scanned
 *                       example: 23
 *                     pairsTracked:
 *                       type: integer
 *                       description: Number of trading pairs scanned
 *                       example: 500
 *                     generatedAt:
 *                       type: integer
 *                       description: Timestamp (ms) of the underlying scan
 *                     cached:
 *                       type: boolean
 *                       description: True if served from cache (not a fresh scan)
 *                     stale:
 *                       type: boolean
 *                       description: True if served from stale cache after an error
 *                     degraded:
 *                       type: boolean
 *                       description: True if no cache available and returned empty
 */
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

// ─── Public funding heatmap ────────────────────────────────────────────────────
// Read-only heatmap: exchange × pair × funding rate. No auth required.
// Returns top positive and top negative funding rates from the warm cache.
const HEATMAP_CACHE_TTL_MS = 30_000;

router.get('/heatmap', async (_req, res) => {
  const cached = publicCache.get('heatmap');
  if (cached && Date.now() - cached.ts < HEATMAP_CACHE_TTL_MS) {
    return res.json({ ok: true, ...cached.payload, cached: true });
  }

  try {
    let scan = getCachedScan(SUPPORTED_EXCHANGES);
    if (!scan) {
      const warm = getWarmupPromise();
      if (warm) {
        await warm;
        scan = getCachedScan(SUPPORTED_EXCHANGES);
      }
    }
    if (!scan) {
      const result = await runScan(SUPPORTED_EXCHANGES);
      scan = { result, ts: Date.now(), ageMs: 0 };
    }

    const allResults = [
      ...scan.result.highYield,
      ...scan.result.mediumYield,
      ...scan.result.lowYield,
    ];

    const pairs = allResults.map((r) => ({
      exchange: r.exchange,
      contract: r.contract,
      funding_rate_per_hour: r.funding_rate_per_hour,
      annualized_rate: r.annualized_rate,
      mark_price: r.mark_price,
      volume_24h_settle: r.volume_24h_settle,
      funding_interval_hours: r.funding_interval_hours,
    }));

    // Sort by absolute hourly rate descending and take top 40
    pairs.sort((a, b) => Math.abs(b.funding_rate_per_hour) - Math.abs(a.funding_rate_per_hour));
    const top = pairs.slice(0, 40);

    const payload = {
      pairs: top,
      scanned: scan.result.scanned,
      generatedAt: scan.ts,
    };

    publicCache.set('heatmap', { payload, ts: Date.now() });
    return res.json({ ok: true, ...payload });
  } catch (e) {
    const error = e as Error;
    const stale = publicCache.get('heatmap');
    if (stale) {
      logger.warn({ err: error.message }, 'Public heatmap served stale after error');
      return res.json({ ok: true, ...stale.payload, stale: true });
    }
    logger.error({ err: error }, 'Public heatmap error (degraded to empty)');
    return res.json({
      ok: true,
      pairs: [],
      scanned: 0,
      degraded: true,
    });
  }
});

// Social-proof track record: an ILLUSTRATIVE market-neutral funding
// arbitrage paper backtest from real scanned history. Powers the landing-page
// "what you could have earned" proof and is the key trust element for converting
// free visitors into trials. Clearly a ceiling estimate (no fees/slippage).
/**
 * @swagger
 * /public/trackrecord:
 *   get:
 *     tags: [Analytics]
 *     summary: Illustrative track record (public)
 *     description: >
 *       Social-proof backtest: an illustrative market-neutral funding arbitrage
 *       paper backtest from real scanned history. Powers the landing-page
 *       "what you could have earned" proof. Clearly a ceiling estimate
 *       (no fees/slippage). Returns 200 with available=false if not enough
 *       history yet.
 *     responses:
 *       200:
 *         description: Track record (or unavailable)
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   properties:
 *                     ok:
 *                       type: boolean
 *                     available:
 *                       type: boolean
 *                       example: false
 *                     note:
 *                       type: string
 *                 - type: object
 *                   properties:
 *                     ok:
 *                       type: boolean
 *                     illustrative:
 *                       type: boolean
 *                       example: true
 *                     totalReturn:
 *                       type: number
 *                     annualized:
 *                       type: number
 *                     maxDrawdown:
 *                       type: number
 *       500:
 *         description: Server error
 */
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

// Weekly Funding Report (public JSON). Same numbers the bot posts to the
// public channel — reusable by the landing page and the email newsletter.
/**
 * @swagger
 * /public/weekly-report:
 *   get:
 *     tags: [Analytics]
 *     summary: Weekly funding report (public)
 *     description: >
 *       Public JSON of the weekly funding report. Same numbers the bot posts to
 *       the public Telegram channel — reusable by the landing page and the email
 *       newsletter. No authentication required.
 *     responses:
 *       200:
 *         description: Weekly report data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 generatedAt:
 *                   type: integer
 *                   description: Timestamp (ms)
 *                 exchangesScanned:
 *                   type: integer
 *                 pairsWithPositiveFunding:
 *                   type: integer
 *                 avgFundingRate:
 *                   type: number
 *                 topOpportunities:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Server error
 */
router.get('/weekly-report', async (_req, res) => {
  try {
    const report = await computeWeeklyReport();
    return res.json({ ok: true, ...report });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Public weekly report error');
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

/**
 * @swagger
 * /public/waitlist:
 *   post:
 *     tags: [Lead Capture]
 *     summary: Join the waitlist
 *     description: >
 *       Capture interested visitors who aren't ready to pay yet. No auth required.
 *       Deduplicates by email — repeat signups return ok:true with already=true.
 *       Triggers a welcome email (best-effort, fire-and-forget).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email address (provide email or telegram)
 *               telegram:
 *                 type: string
 *                 description: Telegram username (provide email or telegram)
 *               lang:
 *                 type: string
 *                 description: UI language of the visitor
 *               source:
 *                 type: string
 *                 description: Traffic source (e.g., 'seo', 'landing', 'b2b-form')
 *               interest:
 *                 type: string
 *                 enum: [passive, arbitrage]
 *                 description: User's primary interest
 *           required: []
 *     responses:
 *       200:
 *         description: Subscribed (or already on the list)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 already:
 *                   type: boolean
 *                   description: True if email was already registered
 *                 message:
 *                   type: string
 *       500:
 *         description: Server error
 */
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
    // Fire-and-forget welcome email (best effort; never blocks the signup).
    if (email) {
      void sendWaitlistWelcome(email, lang).then((ok) => {
        if (ok) {
          prisma.waitlist.update({ where: { email }, data: { welcomeSent: true } }).catch(() => {});
        }
      });
    }
    return res.json({ ok: true, message: 'Subscribed' });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Waitlist signup error');
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// A/B headline winner: the landing page fetches this on load. If a winner has
// been promoted by the admin, all visitors see that variant (no random split).
// Returns `{ ok: true, winner: 'A' | 'B' | null }`.
let abWinner: string | null = null;

export function setAbWinner(variant: string | null) {
  abWinner = variant;
}

export function getAbWinner(): string | null {
  return abWinner;
}

/**
 * @swagger
 * /public/ab-winner:
 *   get:
 *     tags: [A/B Testing]
 *     summary: Get promoted A/B winner
 *     description: >
 *       Returns the currently promoted A/B headline variant. The landing page
 *       fetches this on load — if a winner has been promoted by the admin, all
 *       visitors see that variant (no random split). Returns winner=null when
 *       no winner has been promoted (random assignment applies).
 *     responses:
 *       200:
 *         description: Current A/B winner
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 winner:
 *                   type: string
 *                   enum: [A, B]
 *                   nullable: true
 *                   description: Promoted variant (null = no winner, random split)
 */
router.get('/ab-winner', (_req, res) => {
  res.json({ ok: true, winner: abWinner });
});

// Ultra-lightweight keep-alive ping. Returns instantly with no DB hit so it
// can be called every few minutes by the frontend SPA or an external cron
// (cron-job.org / UptimeRobot) to prevent Render free-tier sleep.
/**
 * @swagger
 * /public/ping:
 *   get:
 *     tags: [Health]
 *     summary: Keep-alive ping
 *     description: >
 *       Ultra-lightweight health check. No DB hit — returns instantly.
 *       Used by the frontend SPA (every 10 min) and external cron jobs
 *       (cron-job.org / UptimeRobot) to prevent Render free-tier sleep.
 *     responses:
 *       200:
 *         description: Pong
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 t:
 *                   type: integer
 *                   description: Server timestamp (ms)
 *                   example: 1700000000000
 */
router.get('/ping', (_req, res) => {
  res.json({ ok: true, t: Date.now() });
});

export default router;
