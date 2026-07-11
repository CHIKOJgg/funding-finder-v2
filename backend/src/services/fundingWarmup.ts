import { logger } from '../utils/logger.js';
import { runScan } from './scanService.js';

const ALL_EXCHANGES = ['gate', 'binance', 'bybit', 'mexc', 'okx'];
const WARMUP_INTERVAL_MS = 5 * 60 * 1000; // align with scan cache TTL

let timer: NodeJS.Timeout | null = null;

/**
 * Periodically runs scans so the funding calendar, the main scan endpoint and
 * historical APR always have fresh cached data. Results are stored in the
 * shared scan cache by runScan, so user-facing requests return instantly
 * (stale-while-revalidate) instead of waiting on a live 5-exchange scan.
 */
export function startFundingWarmup(): void {
  if (timer) return;

  const run = async () => {
    try {
      // Warm the full set (frontend default) and each single exchange so that
      // arbitrary subset selections also hit cache instead of a fresh scan.
      await runScan(ALL_EXCHANGES);
      await Promise.all(ALL_EXCHANGES.map((ex) => runScan([ex])));
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
