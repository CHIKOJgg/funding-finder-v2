import { logger } from '../utils/logger.js';
import { SUPPORTED_EXCHANGES } from '../exchanges/index.js';
import { runScan } from './scanService.js';
import { wsManager } from './websocket.js';

const ALL_EXCHANGES = SUPPORTED_EXCHANGES;
// Funding rates settle every 1-8h, so re-scanning the full set every 5 minutes is
// wasteful AND it saturates the single Node event loop (≈3700 external API calls
// per scan) for ~2.5 min, which made every authenticated request take 3-5s while
// a scan was running. 15 minutes is plenty fresh and cuts the degraded window from
// ~50% of the time to ~17%.
const WARMUP_INTERVAL_MS = 15 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
// Resolves when the FIRST (startup) warm-up scan finishes and the full-set
// cache is populated. Callers (e.g. the arbitrage endpoint on a cold start)
// can await this to ride the warm-up instead of launching their own cold scan.
let warmupPromise: Promise<void> | null = null;

export function getWarmupPromise(): Promise<void> | null {
  return warmupPromise;
}

/**
 * Periodically runs a full scan so the funding calendar, the main scan endpoint
 * and historical APR always have fresh cached data. runScan stores the result
 * in the shared scan cache, so user-facing requests return instantly
 * (stale-while-revalidate) instead of waiting on a live 5-exchange scan.
 *
 * Only the full set is warmed (this is the frontend default selection). Subset
 * selections are served non-blocking and trigger their own background refresh.
 */
export function startFundingWarmup(): void {
  if (process.env.DISABLE_WARMUP === 'true') {
    logger.info('Funding warm-up DISABLED via DISABLE_WARMUP env');
    return;
  }
  if (warmupPromise) return;

  const run = async () => {
    try {
      const scanResult = await runScan(ALL_EXCHANGES);
      logger.debug('Funding scan warm-up completed');

      // Notify connected WebSocket clients subscribed to the `funding` channel
      // that fresh data is available. We send only a freshness ping (not the
      // full opportunity list) — the client already refreshes the complete list
      // on its own polling cadence, so pushing the full set here would risk
      // clobbering the user's filtered view and waste bandwidth.
      try {
        wsManager.broadcast('funding', {
          generatedAt: Date.now(),
          scanned: scanResult.scanned,
        });
      } catch (broadcastErr) {
        logger.debug({ err: (broadcastErr as Error).message }, 'Live funding broadcast failed');
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Funding scan warm-up failed');
    }
  };

  // Kick off the first warm-up immediately (it populates the cache that every
  // cold user request would otherwise trigger its own scan for), then repeat
  // on the interval. Exposing the first-run promise lets the arbitrage
  // endpoint await it on a cold start instead of competing with it.
  warmupPromise = (async () => {
    await run();
    timer = setInterval(run, WARMUP_INTERVAL_MS);
  })();

  logger.info('Funding scan warm-up scheduled');
}

export function stopFundingWarmup(): void {
  if (timer) {
    clearTimeout(timer);
    clearInterval(timer);
    timer = null;
  }
  warmupPromise = null;
}
