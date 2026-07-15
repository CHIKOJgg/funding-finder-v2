import { Router } from 'express';
import { SUPPORTED_EXCHANGES } from '../exchanges/index.js';
import { getLivePriceBatch } from '../services/priceService.js';
import { scanDebug } from '../services/scanService.js';
import { getWarmupPromise } from '../services/fundingWarmup.js';
import { requireAdmin } from '../middleware/admin.js';
import { getClientLogBuffer } from './log.js';

const router = Router();

/**
 * Admin diagnostics for the "are prices actually live?" question. Probes a
 * single symbol on every supported exchange from THIS host and reports which
 * ones return data. A missing price means the exchange API is unreachable
 * from the server (datacenter IP blocked / DNS / WAF) — the #1 reason live
 * prices/funding look stale in the mini app.
 */
router.get('/price-probe', requireAdmin, async (_req, res) => {
  const symbol = (typeof _req.query.symbol === 'string' && _req.query.symbol) || 'BTC/USDT';
  const results = await Promise.all(
    SUPPORTED_EXCHANGES.map(async (ex) => {
      try {
        const prices = await getLivePriceBatch(ex, [symbol]);
        const price = prices[symbol.toUpperCase()];
        return { exchange: ex, ok: price != null, price: price ?? null };
      } catch (err) {
        return { exchange: ex, ok: false, error: (err as Error).message };
      }
    })
  );
  const okCount = results.filter((r) => r.ok).length;
  res.json({
    ok: true,
    symbol,
    liveCount: okCount,
    total: results.length,
    results,
  });
});

/** Snapshot of scan state: in-flight scans + warm-up status. */
router.get('/scan-state', requireAdmin, (_req, res) => {
  res.json({
    ok: true,
    warmupPending: getWarmupPromise() !== null,
    ...scanDebug(),
  });
});

/** Admin view of the recent client (Mini App) log buffer. */
router.get('/client-logs', requireAdmin, (_req, res) => {
  const entries = getClientLogBuffer();
  res.json({ ok: true, count: entries.length, entries });
});

export default router;
