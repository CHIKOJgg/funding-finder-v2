import { runScan, getCachedScan } from './scanService.js';
import { ScanResult, ExchangeResult } from '../types/index.js';
import { logger } from '../utils/logger.js';

const VALID_EXCHANGES = ['gate', 'binance', 'bybit', 'mexc', 'okx'];

export interface FundingEvent {
  exchange: string;
  pair: string;
  ratePerHour: number;
  ratePerDay: number;
  annualized: number;
  nextApply: number; // epoch ms
  secondsUntil: number;
}

function extractEvents(result: ScanResult, limit: number): FundingEvent[] {
  const all = [...result.highYield, ...result.mediumYield, ...result.lowYield];
  const now = Date.now();

  return all
    .filter((item) => item.funding_next_apply && item.funding_next_apply > now)
    .map((item: ExchangeResult) => ({
      exchange: item.exchange,
      pair: item.contract,
      ratePerHour: item.funding_rate_per_hour,
      ratePerDay: item.funding_rate_per_day,
      annualized: item.annualized_rate,
      nextApply: item.funding_next_apply,
      secondsUntil: Math.round((item.funding_next_apply - now) / 1000),
    }))
    .sort((a, b) => a.nextApply - b.nextApply)
    .slice(0, limit);
}

/**
 * Build the upcoming funding-payout calendar for the requested exchanges.
 * Reuses the shared scan cache (populated by runScan / the background warm-up),
 * so it returns instantly when data is fresh. On a cache miss it triggers a
 * background refresh and returns empty immediately instead of blocking.
 */
export async function getFundingCalendar(
  exchanges: string[],
  limit = 12
): Promise<{ events: FundingEvent[]; scanned: number; stale: boolean }> {
  const clean = exchanges.filter((e) => VALID_EXCHANGES.includes(e)).slice(0, 5);
  const target = clean.length ? clean : ['gate'];

  const cached = getCachedScan(target);
  if (!cached) {
    // Non-blocking: refresh in the background, return empty now. The client
    // polls periodically and will pick up data once the warm-up populates it.
    runScan(target).catch((err) =>
      logger.warn({ err: (err as Error).message }, 'Funding calendar background scan failed')
    );
    return { events: [], scanned: 0, stale: true };
  }

  return { events: extractEvents(cached.result, limit), scanned: cached.result.scanned, stale: false };
}
