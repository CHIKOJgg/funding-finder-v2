import { prisma } from './prisma.js';
import { logger } from '../utils/logger.js';

export interface ContractInfo {
  exchange: string;
  contract: string;
  settleCurrency?: string;
  baseCurrency?: string;
  quoteCurrency?: string;
  tickSize?: number;
  minQty?: number;
  maxLeverage?: number;
  fundingCap?: number;
  fundingFloor?: number;
  openInterest?: number;
}

// Prevent warmup scans from saturating the database pool. All metadata write
// calls are queued so at most 1 connection is consumed by background upserts
// regardless of how many exchanges are being scanned simultaneously.
let upsertQueue: Promise<void> = Promise.resolve();

function enqueueUpsert(fn: () => Promise<void>): void {
  upsertQueue = upsertQueue.then(fn, fn);
}

// Contract metadata (tick size, leverage, open interest, ...) changes very slowly.
// Upserting all ~3700 contracts on EVERY scan flooded the DB and made every
// authenticated request take 3-5s while a scan was running. We only write when a
// contract is new or its cached entry is older than the TTL, so recurring scans
// perform almost no metadata writes and stay light.
const metadataUpsertedAt = new Map<string, number>();
const METADATA_UPSERT_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function upsertContractMetadata(info: ContractInfo): Promise<void> {
  const key = `${info.exchange}:${info.contract}`;
  const now = Date.now();
  const last = metadataUpsertedAt.get(key);
  if (last !== undefined && now - last < METADATA_UPSERT_TTL_MS) {
    return; // already fresh — skip the DB write entirely
  }
  enqueueUpsert(async () => {
  try {
    await prisma.contractMetadata.upsert({
      where: { key },
      create: {
        key,
        exchange: info.exchange,
        contract: info.contract,
        settleCurrency: info.settleCurrency || 'usdt',
        baseCurrency: info.baseCurrency,
        quoteCurrency: info.quoteCurrency,
        tickSize: info.tickSize,
        minQty: info.minQty,
        maxLeverage: info.maxLeverage,
        fundingCap: info.fundingCap,
        fundingFloor: info.fundingFloor,
        openInterest: info.openInterest,
      },
      update: {
        baseCurrency: info.baseCurrency,
        quoteCurrency: info.quoteCurrency,
        tickSize: info.tickSize,
        minQty: info.minQty,
        maxLeverage: info.maxLeverage,
        fundingCap: info.fundingCap,
        fundingFloor: info.fundingFloor,
        openInterest: info.openInterest,
        lastUpdated: new Date(),
      },
    });
  } catch (err) {
    logger.debug(`Failed to upsert metadata for ${key}: ${(err as Error).message}`);
  }
    metadataUpsertedAt.set(key, Date.now());
  });
}

export async function getContractMetadata(key: string) {
  return prisma.contractMetadata.findUnique({ where: { key } });
}

export async function getContractsByExchange(exchange: string) {
  return prisma.contractMetadata.findMany({
    where: { exchange },
    orderBy: { contract: 'asc' },
  });
}

export async function getContractsByCurrency(currency: string) {
  return prisma.contractMetadata.findMany({
    where: {
      OR: [
        { baseCurrency: currency },
        { quoteCurrency: currency },
      ],
    },
    orderBy: { contract: 'asc' },
  });
}

export async function getStaleContracts(hoursStale: number = 24) {
  const cutoff = new Date(Date.now() - hoursStale * 60 * 60 * 1000);
  return prisma.contractMetadata.findMany({
    where: {
      lastUpdated: { lt: cutoff },
    },
    orderBy: { lastUpdated: 'asc' },
    take: 100,
  });
}

export async function getContractStats() {
  const [total, exchanges] = await Promise.all([
    prisma.contractMetadata.count(),
    prisma.contractMetadata.groupBy({
      by: ['exchange'],
      _count: { id: true },
    }),
  ]);

  return {
    total,
    byExchange: exchanges.map((e) => ({
      exchange: e.exchange,
      count: e._count.id,
    })),
  };
}
