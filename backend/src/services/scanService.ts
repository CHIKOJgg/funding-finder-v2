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
    if (uniqueItems.length === 0) return;

    const now = new Date();
    const keys = uniqueItems.map((i) => `${i.exchange}:${i.contract}`);

    // Insert parent rows in ONE statement, ignoring rows that already exist
    // (idempotent per unique `key`). This replaces a per-row `upsert` loop that
    // fired thousands of parallel queries and starved the DB connection pool
    // (the pool default is tiny), which made every authenticated request time
    // out for seconds whenever a scan saved its history.
    await prisma.fundingHistory.createMany({
      data: keys.map((key) => ({ key })),
      skipDuplicates: true,
    });

    // Resolve the (possibly pre-existing) parent IDs in a single query.
    const parents = await prisma.fundingHistory.findMany({
      where: { key: { in: keys } },
      select: { id: true, key: true },
    });
    const idByKey = new Map(parents.map((p) => [p.key, p.id]));

    // Bulk-insert all child FundingRecord rows in ONE statement.
    await prisma.fundingRecord.createMany({
      data: uniqueItems.map((item) => ({
        fundingHistoryId: idByKey.get(`${item.exchange}:${item.contract}`) as string,
        timestamp: now,
        funding: item.currentFunding,
        intervalHours: item.funding_interval_hours || null,
      })),
    });
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'Failed to save funding history');
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
  }

  const result: ScanResult = {
    highYield: highYield.slice(0, 50),
    mediumYield: mediumYield.slice(0, 50),
    lowYield: lowYield.slice(0, 50),
    hourly: [],
    twohour: [],
    fallback: [],
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

/** Parse the exchange list out of a `scan:<exchanges>` cache key. */
function parseExchangesFromKey(key: string): string[] {
  return key.replace('scan:', '').split(',').filter(Boolean);
}

/**
 * Find an in-flight scan whose exchange set is a SUPERSET of the requested
 * set. Used so a user requesting 3 exchanges can ride the already-running
 * warm-up scan of all 23 instead of launching a second concurrent scan.
 */
function findSupersetInFlight(exchanges: string[]): Promise<ScanResult> | null {
  const set = new Set(exchanges);
  for (const [key, promise] of inFlightScans.entries()) {
    if (!key.startsWith('scan:')) continue;
    const cachedSet = new Set(parseExchangesFromKey(key));
    let isSuperset = true;
    for (const e of set) {
      if (!cachedSet.has(e)) {
        isSuperset = false;
        break;
      }
    }
    if (isSuperset) return promise;
  }
  return null;
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

  // Superset coalescing: if a broader scan (e.g. the scheduled warm-up of all
  // exchanges) is already in flight and covers the requested set, attach to it
  // instead of launching a second concurrent scan. This is the key fix for the
  // "app is slow / crashes on entry" symptom: previously the user's 3-exchange
  // auto-scan and the 23-exchange warm-up ran simultaneously and saturated the
  // single Node process, making every other request take 12–30s.
  const superset = findSupersetInFlight(exchanges);
  if (superset) {
    logger.info(`Coalescing subset scan (${key}) onto in-flight superset scan`);
    return superset;
  }

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

/** Debug snapshot: which scans are currently in flight (for /api/debug). */
export function scanDebug() {
  return {
    inFlight: [...inFlightScans.keys()],
    cacheKeys: [...cache.keys()].filter((k) => k.startsWith('scan:')).length,
  };
}
