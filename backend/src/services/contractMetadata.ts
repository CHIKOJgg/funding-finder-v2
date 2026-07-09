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

export async function upsertContractMetadata(info: ContractInfo): Promise<void> {
  const key = `${info.exchange}:${info.contract}`;
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
