import { runScan, getCachedScan } from './scanService.js';
import { SUPPORTED_EXCHANGES } from '../exchanges/index.js';
import { ScanResult, ExchangeResult } from '../types/index.js';
import { logger } from '../utils/logger.js';

const VALID_EXCHANGES = SUPPORTED_EXCHANGES;

export interface FundingEvent {
  exchange: string;
  pair: string;
  ratePerHour: number;
  ratePerDay: number;
  annualized: number;
  nextApply: number; // epoch ms
  secondsUntil: number;
}

// Resolve the next funding-settlement timestamp for a scanned contract.
// Prefers the exchange-provided `funding_next_apply` when it is a valid future
// timestamp, but falls back to deriving the next interval boundary from the
// funding interval (the same logic the frontend countdown uses). This keeps the
// calendar populated and consistent with the per-position countdowns even when
// an exchange omits `funding_next_apply` or reports it in the wrong unit
// (seconds vs ms) — both of which previously made every event get filtered out.
function resolveNextApply(item: ExchangeResult, now: number): number {
  const fna = item.funding_next_apply;
  if (typeof fna === 'number' && isFinite(fna) && fna > now) {
    return fna;
  }
  const intervalHours =
    item.funding_interval_hours ||
    (item.funding_interval_seconds ? item.funding_interval_seconds / 3600 : 0);
  if (!intervalHours || intervalHours <= 0) return 0;
  const stepMs = intervalHours * 3600 * 1000;
  const epoch = Date.UTC(1970, 0, 1);
  return Math.ceil((now - epoch) / stepMs) * stepMs + epoch;
}

function extractEvents(result: ScanResult, limit: number): FundingEvent[] {
  const all = [...result.highYield, ...result.mediumYield, ...result.lowYield];
  const now = Date.now();

  return all
    .map((item: ExchangeResult) => {
      const nextApply = resolveNextApply(item, now);
      return {
        exchange: item.exchange,
        pair: item.contract,
        ratePerHour: item.funding_rate_per_hour,
        ratePerDay: item.funding_rate_per_day,
        annualized: item.annualized_rate,
        nextApply,
        secondsUntil: Math.round((nextApply - now) / 1000),
      };
    })
    // Only include contracts whose next settlement is actually in the future
    // (requires a known interval; contracts without one can't be scheduled).
    .filter((e) => e.nextApply > now)
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
  const clean = exchanges.filter((e) => VALID_EXCHANGES.includes(e)).slice(0, 12);
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
