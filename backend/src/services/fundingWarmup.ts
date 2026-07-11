import { logger } from '../utils/logger.js';
import { runScan } from './scanService.js';

const ALL_EXCHANGES = ['gate', 'binance', 'bybit', 'mexc', 'okx'];
const WARMUP_INTERVAL_MS = 5 * 60 * 1000; // align with scan cache TTL

let timer: NodeJS.Timeout | null = null;

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
  if (timer) return;

  const run = async () => {
    try {
      await runScan(ALL_EXCHANGES);
      logger.debug('Funding scan warm-up completed');
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Funding scan warm-up failed');
    }
  };

  // Kick off shortly after startup, then on an interval.
  timer = setTimeout(async () => {
    await run();
    timer = setInterval(run, WARMUP_INTERVAL_MS);
  }, 10_000);

  logger.info('Funding scan warm-up scheduled');
}

export function stopFundingWarmup(): void {
  if (timer) {
    clearTimeout(timer);
    clearInterval(timer);
    timer = null;
  }
}
