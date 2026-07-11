import { logger } from '../utils/logger.js';
import { getFundingCalendar } from './fundingCalendar.js';

const ALL_EXCHANGES = ['gate', 'binance', 'bybit', 'mexc', 'okx'];
const WARMUP_INTERVAL_MS = 5 * 60 * 1000; // align with calendar cache TTL

let timer: NodeJS.Timeout | null = null;

/**
 * Periodically runs a full scan so the funding calendar and historical APR
 * always have reasonably fresh data, even before any user-triggered scan.
 * The scan result is cached inside getFundingCalendar (5 min TTL).
 */
export function startFundingWarmup(): void {
  if (timer) return;

  const run = async () => {
    try {
      // Warm the full set (frontend default) and each single exchange so that
      // subset selections also hit cache instead of triggering a fresh scan.
      await getFundingCalendar(ALL_EXCHANGES, 12);
      await Promise.all(ALL_EXCHANGES.map((ex) => getFundingCalendar([ex], 12)));
      logger.debug('Funding calendar warm-up completed');
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Funding calendar warm-up failed');
    }
  };

  // Kick off shortly after startup, then on an interval.
  timer = setTimeout(async () => {
    await run();
    timer = setInterval(run, WARMUP_INTERVAL_MS);
  }, 10_000);

  logger.info('Funding calendar warm-up scheduled');
}

export function stopFundingWarmup(): void {
  if (timer) {
    clearTimeout(timer);
    clearInterval(timer);
    timer = null;
  }
}
