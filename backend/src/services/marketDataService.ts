import { prisma } from './prisma.js';
import { logger } from '../utils/logger.js';

// Track last OI value per key to avoid inserting duplicate records
const lastOiValues = new Map<string, { value: number; timestamp: number }>();

// Background OI/LSR writes are serialised so warmup scans never saturate the
// database pool and starve user-facing API requests.
let bgWriteQueue: Promise<void> = Promise.resolve();
function enqueueBgWrite(fn: () => Promise<void>): void {
  bgWriteQueue = bgWriteQueue.then(fn, fn);
}

// Open Interest data fetching and storage (with dedup)
export async function upsertOpenInterest(
  exchange: string,
  contract: string,
  openInterestUsd: number,
  timestamp: number = Date.now()
): Promise<void> {
  if (typeof openInterestUsd !== 'number' || !isFinite(openInterestUsd)) return;
  const key = `${exchange}:${contract}`;
  const last = lastOiValues.get(key);
  if (last && Math.abs(last.value - openInterestUsd) / (last.value || 1) < 0.001 && timestamp - last.timestamp < 300_000) {
    return;
  }
  lastOiValues.set(key, { value: openInterestUsd, timestamp });
  enqueueBgWrite(async () => {
  try {
    await prisma.openInterestHistory.upsert({
      where: { key },
      create: {
        key,
        records: {
          create: {
            timestamp: new Date(timestamp),
            openInterestUsd,
          },
        },
      },
      update: {
        records: {
          create: {
            timestamp: new Date(timestamp),
            openInterestUsd,
          },
        },
      },
    });
  } catch (err) {
    logger.debug(`Failed to upsert OI for ${key}: ${(err as Error).message}`);
  }
  });
}

// Track last LSR value per key to avoid inserting duplicate records
const lastLsrValues = new Map<string, { value: number; timestamp: number }>();

// Long/Short ratio data fetching and storage (with dedup)
export async function upsertLongShortRatio(
  exchange: string,
  contract: string,
  longShortRatio: number,
  longAccountRatio: number | null = null,
  shortAccountRatio: number | null = null,
  timestamp: number = Date.now()
): Promise<void> {
  if (typeof longShortRatio !== 'number' || !isFinite(longShortRatio)) return;
  const key = `${exchange}:${contract}`;
  const last = lastLsrValues.get(key);
  if (last && Math.abs(last.value - longShortRatio) < 0.001 && timestamp - last.timestamp < 300_000) {
    return;
  }
  lastLsrValues.set(key, { value: longShortRatio, timestamp });
  enqueueBgWrite(async () => {
  try {
    await prisma.longShortRatioHistory.upsert({
      where: { key },
      create: {
        key,
        records: {
          create: {
            timestamp: new Date(timestamp),
            longShortRatio,
            longAccountRatio: longAccountRatio ?? undefined,
            shortAccountRatio: shortAccountRatio ?? undefined,
          },
        },
      },
      update: {
        records: {
          create: {
            timestamp: new Date(timestamp),
            longShortRatio,
            longAccountRatio: longAccountRatio ?? undefined,
            shortAccountRatio: shortAccountRatio ?? undefined,
          },
        },
      },
    });
  } catch (err) {
    logger.debug(`Failed to upsert LSR for ${key}: ${(err as Error).message}`);
  }
  });
}

// Periodically evict stale entries from dedup caches to prevent memory leak
const DEDUP_CACHE_MAX_AGE = 10 * 60 * 1000;
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const cutoff = Date.now() - DEDUP_CACHE_MAX_AGE;
    for (const [k, v] of lastOiValues) { if (v.timestamp < cutoff) lastOiValues.delete(k); }
    for (const [k, v] of lastLsrValues) { if (v.timestamp < cutoff) lastLsrValues.delete(k); }
  }, 5 * 60 * 1000);
}

// Liquidation data storage
export async function recordLiquidation(
  exchange: string,
  contract: string,
  longVolUsd: number,
  shortVolUsd: number,
  price: number,
  timestamp: number = Date.now()
): Promise<void> {
  if (!isFinite(longVolUsd) || !isFinite(shortVolUsd) || !isFinite(price)) return;
  try {
    await prisma.liquidationSnapshot.create({
      data: {
        exchange,
        contract,
        timestamp: new Date(timestamp),
        longVolUsd,
        shortVolUsd,
        price,
      },
    });
  } catch (err) {
    logger.debug(`Failed to record liquidation for ${exchange}:${contract}: ${(err as Error).message}`);
  }
}

// Get latest Open Interest
export async function getLatestOpenInterest(exchange: string, contract: string) {
  const history = await prisma.openInterestHistory.findUnique({
    where: { key: `${exchange}:${contract}` },
    include: {
      records: {
        orderBy: { timestamp: 'desc' },
        take: 1,
      },
    },
  });
  return history?.records[0] || null;
}

// Get Open Interest history (for charts)
export async function getOpenInterestHistory(
  exchange: string,
  contract: string,
  hours: number = 168 // 7 days default
) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  const records = await prisma.openInterestRecord.findMany({
    where: {
      openInterestHistory: {
        key: `${exchange}:${contract}`,
      },
      timestamp: { gte: cutoff },
    },
    orderBy: { timestamp: 'asc' },
    take: 1000,
  });
  return records;
}

// Get Long/Short ratio history
export async function getLongShortRatioHistory(
  exchange: string,
  contract: string,
  hours: number = 168
) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  const records = await prisma.longShortRatioRecord.findMany({
    where: {
      longShortRatioHistory: {
        key: `${exchange}:${contract}`,
      },
      timestamp: { gte: cutoff },
    },
    orderBy: { timestamp: 'asc' },
    take: 1000,
  });
  return records;
}

// Get liquidation snapshots
export async function getLiquidationSnapshots(
  exchange: string,
  contract: string,
  hours: number = 24
) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  return prisma.liquidationSnapshot.findMany({
    where: {
      exchange,
      contract,
      timestamp: { gte: cutoff },
    },
    orderBy: { timestamp: 'desc' },
    take: 100,
  });
}

// Get OI-weighted average funding rate.
// Uses the latest stored funding rate per exchange (normalized to per-hour by
// each contract's real settlement interval) weighted by open interest. The old
// implementation weighted caller-supplied rates which were hardcoded to 0, so
// this endpoint always returned 0.
export async function getOiWeightedFundingRate(
  contract: string,
  exchanges: string[]
): Promise<number> {
  // Get latest OI for each exchange
  const oiData = await Promise.all(
    exchanges.map(async (exchange) => {
      const latestOI = await getLatestOpenInterest(exchange, contract);
      return { exchange, oi: latestOI?.openInterestUsd ?? 0 };
    })
  );

  const totalOi = oiData.reduce((sum, d) => sum + d.oi, 0);
  if (totalOi === 0) return 0;

  const latestRatePerHour = async (exchange: string): Promise<number> => {
    const hist = await prisma.fundingHistory.findUnique({
      where: { key: `${exchange}:${contract}` },
      include: { records: { orderBy: { timestamp: 'desc' }, take: 1 } },
    });
    const rec = hist?.records?.[0];
    if (!rec) return 0;
    return rec.funding / (rec.intervalHours || 8);
  };

  // Weight rates by OI
  let weightedSum = 0;
  for (const { exchange, oi } of oiData) {
    if (oi <= 0) continue;
    const rate = await latestRatePerHour(exchange);
    weightedSum += rate * (oi / totalOi);
  }

  return weightedSum;
}