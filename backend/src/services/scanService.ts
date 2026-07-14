import { ExchangeResult, ScanResult, KNOWN_INTERVALS } from '../types/index.js';
import { scanExchanges } from '../exchanges/index.js';
import { prisma } from './prisma.js';
import { logger } from '../utils/logger.js';
import { normalizeFundingRate, getYieldCategory, detectFundingInterval } from '../utils/helpers.js';
import { cache } from '../utils/exchangeClient.js';

// How long a cached scan result is served before it is considered expired and
// a fresh scan is required (NOT for SWR — background refresh happens sooner).
const SCAN_CACHE_TTL_MS = 5 * 60 * 1000;

export function scanCacheKey(exchanges: string[]): string {
  return `scan:${[...exchanges].sort().join(',')}`;
}

/**
 * Return a previously computed scan result if it is still fresh.
 * SWR (stale-while-revalidate) is implemented by callers using `ageMs`.
 * Also supports superset matching: if a cached scan includes all requested
 * exchanges (plus more), it can be reused to avoid duplicate scans.
 */
export function getCachedScan(exchanges: string[]): { result: ScanResult; ts: number; ageMs: number } | null {
  const key = scanCacheKey(exchanges);
  const entry = cache.get<{ result: ScanResult; ts: number }>(key);
  if (entry) return { result: entry.result, ts: entry.ts, ageMs: Date.now() - entry.ts };

  // Superset matching: find a cached scan that includes all requested exchanges
  const sorted = [...exchanges].sort().join(',');
  const sortedSet = new Set(exchanges);
  for (const cacheKey of cache.keys()) {
    if (!cacheKey.startsWith('scan:')) continue;
    const cachedExchanges = cacheKey.replace('scan:', '');
    const cachedSet = new Set(cachedExchanges.split(','));
    // If the cached scan covers all requested exchanges, reuse it
    let isSuperset = true;
    for (const e of sortedSet) {
      if (!cachedSet.has(e)) { isSuperset = false; break; }
    }
    if (isSuperset) {
      const entry2 = cache.get<{ result: ScanResult; ts: number }>(cacheKey);
      if (entry2) return { result: entry2.result, ts: entry2.ts, ageMs: Date.now() - entry2.ts };
    }
  }
  return null;
}

async function saveToHistory(result: ScanResult): Promise<void> {
  try {
    const allItems = [...result.highYield, ...result.mediumYield, ...result.lowYield];
    const seen = new Set<string>();
    const uniqueItems = allItems.filter((item) => {
      const key = `${item.exchange}:${item.contract}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const now = new Date();

    // Batch upserts in chunks of 50 to avoid overwhelming DB
    const BATCH_SIZE = 50;
    for (let i = 0; i < uniqueItems.length; i += BATCH_SIZE) {
      const batch = uniqueItems.slice(i, i + BATCH_SIZE);
      try {
        await prisma.$transaction(
          batch.map((item) => {
            const key = `${item.exchange}:${item.contract}`;
            return prisma.fundingHistory.upsert({
              where: { key },
              create: {
                key,
                records: {
                  create: {
                    timestamp: now,
                    funding: item.currentFunding,
                  },
                },
              },
              update: {
                records: {
                  create: {
                    timestamp: now,
                    funding: item.currentFunding,
                  },
                },
              },
            });
          })
        );
      } catch (e) {
        logger.debug(`Batch history save failed: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    logger.error('Error saving history:', e);
  }
}

/**
 * Process scan results with proper normalization.
 * 
 * Key insight: Different exchanges have different funding intervals:
 * - Binance/OKX/MEXC: Fixed 8h
 * - Bybit: 8h default, but can be 1h, 4h, 8h
 * - Gate.io: Varies per contract (1h, 4h, 8h, 24h)
 * 
 * To compare fairly, we MUST normalize all rates to hourly basis.
 */
export async function processScanResults(all: ExchangeResult[]): Promise<ScanResult> {
  logger.info(`Processing ${all.length} total records from all exchanges`);

  // Filter out invalid records
  const cleaned = all.filter(
    (x) =>
      x &&
      x.currentFunding !== undefined &&
      x.currentFunding !== null &&
      !isNaN(x.currentFunding) &&
      isFinite(x.currentFunding) &&
      (x.volume_24h_settle || 0) >= 0
  );

  logger.info(`After cleaning: ${cleaned.length} valid records`);

  // Calculate interval distribution for metrics
  const intervalDistribution: Record<string, number> = {};
  let totalIntervalHours = 0;
  let intervalCount = 0;

  for (const item of cleaned) {
    if (item.funding_interval_seconds) {
      const label = `${item.funding_interval_hours || item.funding_interval_seconds / 3600}h`;
      intervalDistribution[label] = (intervalDistribution[label] || 0) + 1;
      totalIntervalHours += item.funding_interval_hours || item.funding_interval_seconds / 3600;
      intervalCount++;
    }
  }

  const averageIntervalHours = intervalCount > 0 ? totalIntervalHours / intervalCount : 8;

  logger.info(`Interval distribution:`, intervalDistribution);
  logger.info(`Average funding interval: ${averageIntervalHours.toFixed(1)}h`);

  // Categorize by normalized hourly rate (absolute value)
  const highYield: ExchangeResult[] = [];
  const mediumYield: ExchangeResult[] = [];
  const lowYield: ExchangeResult[] = [];

  // Also maintain legacy categories for backward compatibility
  const TWELVE_HOUR_SEC = 43200;
  const THIRTY_SIX_HOUR_SEC = 129600;
  const hourly: ExchangeResult[] = [];
  const twohour: ExchangeResult[] = [];
  const fallback: ExchangeResult[] = [];

  // Calculate dynamic thresholds based on median hourly rate
  const hourlyRates = cleaned
    .map((x) => Math.abs(x.funding_rate_per_hour))
    .filter((rate) => rate > 0);
  
  const medianHourlyRate = hourlyRates.length > 0
    ? hourlyRates.sort((a, b) => a - b)[Math.floor(hourlyRates.length / 2)]
    : 0.00001;

  // Dynamic minimum: 30% of median hourly rate
  const dynamicMinHourly = Math.max(0.000001, medianHourlyRate * 0.3);
  logger.info(`Median hourly rate: ${(medianHourlyRate * 100).toFixed(6)}%, Dynamic min: ${(dynamicMinHourly * 100).toFixed(6)}%`);

  const MIN_VOLUME = 1000;

  for (const item of cleaned) {
    const absHourlyRate = Math.abs(item.funding_rate_per_hour);
    
    // Skip if below minimum
    if (absHourlyRate < dynamicMinHourly || item.volume_24h_settle < MIN_VOLUME) {
      continue;
    }

    // Categorize by normalized hourly rate
    const category = getYieldCategory(item.funding_rate_per_hour);
    if (category === 'high') highYield.push(item);
    else if (category === 'medium') mediumYield.push(item);
    else lowYield.push(item);

    // Legacy categorization (for backward compatibility)
    if (item.funding_interval_seconds !== null) {
      if (item.funding_interval_seconds <= TWELVE_HOUR_SEC) {
        hourly.push(item);
      } else if (item.funding_interval_seconds <= THIRTY_SIX_HOUR_SEC) {
        twohour.push(item);
      } else {
        fallback.push(item);
      }
    } else {
      fallback.push(item);
    }
  }

  // Sort all categories by absolute hourly rate (descending)
  const sortByHourlyRate = (a: ExchangeResult, b: ExchangeResult) => 
    Math.abs(b.funding_rate_per_hour) - Math.abs(a.funding_rate_per_hour);
  
  highYield.sort(sortByHourlyRate);
  mediumYield.sort(sortByHourlyRate);
  lowYield.sort(sortByHourlyRate);
  hourly.sort(sortByHourlyRate);
  twohour.sort(sortByHourlyRate);
  fallback.sort(sortByHourlyRate);

  logger.info(`High yield (>0.01%/h): ${highYield.length}`);
  logger.info(`Medium yield (0.001-0.01%/h): ${mediumYield.length}`);
  logger.info(`Low yield (<0.001%/h): ${lowYield.length}`);
  logger.info(`Legacy hourly: ${hourly.length}, twohour: ${twohour.length}, fallback: ${fallback.length}`);

  const result: ScanResult = {
    highYield: highYield.slice(0, 100),
    mediumYield: mediumYield.slice(0, 100),
    lowYield: lowYield.slice(0, 100),
    hourly: hourly.slice(0, 100),
    twohour: twohour.slice(0, 100),
    fallback: fallback.slice(0, 100),
    scanned: cleaned.length,
    metrics: {
      minFundingUsed: dynamicMinHourly,
      totalOpportunities: highYield.length + mediumYield.length + lowYield.length,
      exchanges: [...new Set(cleaned.map((x) => x.exchange))],
      averageIntervalHours,
      intervalDistribution,
    },
  };

  // Save history in background (don't await)
  saveToHistory(result).catch((e) => logger.error('History save failed:', e));

  return result;
}

/**
 * Normalize raw exchange results to add hourly rates.
 */
function normalizeExchangeResults(results: ExchangeResult[]): ExchangeResult[] {
  return results.map((item) => {
    // If normalization wasn't done during scanning, do it now
    if (item.funding_rate_per_hour === undefined || item.funding_rate_per_hour === null) {
      const intervalSeconds = item.funding_interval_seconds || KNOWN_INTERVALS.EIGHT_HOUR;
      const normalized = normalizeFundingRate(item.currentFunding, intervalSeconds);
      
      return {
        ...item,
        funding_rate_per_hour: normalized.perHour,
        funding_rate_per_day: normalized.perDay,
        annualized_rate: normalized.annualized,
      };
    }
    return item;
  });
}

// In-flight live scans, keyed by the sorted exchange list. Used to coalesce
// concurrent callers (multiple users entering at once, the warm-up and the
// alert evaluator all firing together) onto a SINGLE live scan. This is what
// keeps a single shared "funding store" instead of every request hammering
// the exchange APIs — and is what prevents Binance 418 (WAF rate-limit) storms.
const inFlightScans = new Map<string, Promise<ScanResult>>();

// Once a cached result is older than this, a background refresh is kicked off
// so the store stays fresh between the scheduled warm-ups.
const SCAN_REFRESH_AFTER_MS = 60_000;

async function doLiveScan(exchanges: string[]): Promise<ScanResult> {
  const all = await scanExchanges(exchanges);
  const normalized = normalizeExchangeResults(all);
  return processScanResults(normalized);
}

function storeResult(key: string, result: ScanResult): ScanResult {
  cache.set(key, { result, ts: Date.now() }, SCAN_CACHE_TTL_MS);
  return result;
}

/**
 * Unified, read-through funding store. Returns the cached scan instantly when
 * fresh; otherwise coalesces concurrent callers onto one live scan. A
 * background refresh is triggered once the cached entry starts to age, keeping
 * data fresh without ever blocking a user request on a live 5-exchange scan.
 */
export async function runScan(exchanges: string[]): Promise<ScanResult> {
  const key = scanCacheKey(exchanges);
  const cached = cache.get<{ result: ScanResult; ts: number }>(key);
  const now = Date.now();

  if (cached && now - cached.ts < SCAN_CACHE_TTL_MS) {
    if (now - cached.ts > SCAN_REFRESH_AFTER_MS) {
      void refreshScan(key, exchanges);
    }
    return cached.result;
  }

  // Cold or expired: serve only one live scan at a time per exchange set.
  const existing = inFlightScans.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const result = await doLiveScan(exchanges);
    return storeResult(key, result);
  })().finally(() => {
    inFlightScans.delete(key);
  });

  inFlightScans.set(key, promise);
  return promise;
}

function refreshScan(key: string, exchanges: string[]): void {
  if (inFlightScans.has(key)) return;
  const promise = doLiveScan(exchanges)
    .then((result) => storeResult(key, result))
    .finally(() => {
      inFlightScans.delete(key);
    });
  inFlightScans.set(key, promise);
  // Swallow rejections so a failed background refresh doesn't become an
  // unhandled rejection (it's best-effort — the next cycle will retry).
  promise.catch(() => {});
}
