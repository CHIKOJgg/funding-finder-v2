import { prisma } from './prisma.js';
import { logger } from '../utils/logger.js';

// Open Interest data fetching and storage
export async function upsertOpenInterest(
  exchange: string,
  contract: string,
  openInterestUsd: number,
  timestamp: number = Date.now()
): Promise<void> {
  const key = `${exchange}:${contract}`;
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
}

// Long/Short ratio data fetching and storage
export async function upsertLongShortRatio(
  exchange: string,
  contract: string,
  longShortRatio: number,
  longAccountRatio: number | null = null,
  shortAccountRatio: number | null = null,
  timestamp: number = Date.now()
): Promise<void> {
  const key = `${exchange}:${contract}`;
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

// Get OI-weighted average funding rate
export async function getOiWeightedFundingRate(
  contract: string,
  exchangeRates: Array<{ exchange: string; rate: number }>
): Promise<number> {
  // Get latest OI for each exchange
  const oiData = await Promise.all(
    exchangeRates.map(async ({ exchange }) => {
      const latestOI = await getLatestOpenInterest(exchange, contract);
      return { exchange, oi: latestOI?.openInterestUsd ?? 0 };
    })
  );

  const totalOi = oiData.reduce((sum, d) => sum + d.oi, 0);
  if (totalOi === 0) return 0;

  // Weight rates by OI
  let weightedSum = 0;
  for (const { exchange, rate } of exchangeRates) {
    const oi = oiData.find((d) => d.exchange === exchange)?.oi ?? 0;
    weightedSum += rate * (oi / totalOi);
  }

  return weightedSum;
}