import { cache } from '../utils/exchangeClient.js';
import { runScan } from './scanService.js';
import { ScanResult, ExchangeResult } from '../types/index.js';
import { logger } from '../utils/logger.js';

const VALID_EXCHANGES = ['gate', 'binance', 'bybit', 'mexc', 'okx'];
const CALENDAR_TTL_MS = 5 * 60 * 1000;

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
 * Results are cached for 5 minutes to avoid re-running expensive scans.
 */
export async function getFundingCalendar(
  exchanges: string[],
  limit = 12
): Promise<{ events: FundingEvent[]; scanned: number; stale: boolean }> {
  const clean = exchanges.filter((e) => VALID_EXCHANGES.includes(e)).slice(0, 5);
  const key = `calendar:${clean.join(',')}`;

  let result = cache.get<ScanResult>(key);
  let stale = false;
  if (!result) {
    try {
      result = await runScan(clean.length ? clean : ['gate']);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Funding calendar scan failed');
      return { events: [], scanned: 0, stale: true };
    }
    cache.set(key, result, CALENDAR_TTL_MS);
    stale = true;
  }

  return { events: extractEvents(result, limit), scanned: result.scanned, stale };
}
