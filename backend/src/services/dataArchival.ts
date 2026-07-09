import { prisma } from './prisma.js';
import { logger } from '../utils/logger.js';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Run every hour
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startDataArchival(): void {
  if (cleanupTimer) {
    logger.warn('Data archival already running');
    return;
  }

  logger.info('Starting data archival service (hourly cleanup)');
  cleanupTimer = setInterval(async () => {
    try {
      await archiveOldData();
    } catch (err) {
      logger.error({ err }, 'Data archival cycle failed');
    }
  }, CLEANUP_INTERVAL_MS);
}

export function stopDataArchival(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    logger.info('Data archival stopped');
  }
}

export async function archiveOldData(): Promise<{
  recordsDeleted: number;
  historiesCleaned: number;
}> {
  const startTime = Date.now();
  const now = new Date();

  // Keep records for 30 days, delete older
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Delete old FundingRecords
  const deletedRecords = await prisma.fundingRecord.deleteMany({
    where: {
      timestamp: { lt: thirtyDaysAgo },
    },
  });

  // Clean up empty FundingHistory entries (no records left)
  const emptyHistories = await prisma.fundingHistory.findMany({
    where: {
      records: { none: {} },
    },
    select: { id: true },
  });

  let historiesCleaned = 0;
  if (emptyHistories.length > 0) {
    const result = await prisma.fundingHistory.deleteMany({
      where: {
        id: { in: emptyHistories.map((h) => h.id) },
      },
    });
    historiesCleaned = result.count;
  }

  // Delete old AlertTriggers (keep 90 days)
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  await prisma.alertTrigger.deleteMany({
    where: {
      triggeredAt: { lt: ninetyDaysAgo },
    },
  });

  // Delete old Orders that are still pending after 24 hours
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  await prisma.order.deleteMany({
    where: {
      status: 'pending',
      createdAt: { lt: oneDayAgo },
    },
  });

  const duration = Date.now() - startTime;
  logger.info(
    {
      recordsDeleted: deletedRecords.count,
      historiesCleaned,
      duration: `${duration}ms`,
    },
    'Data archival completed'
  );

  return {
    recordsDeleted: deletedRecords.count,
    historiesCleaned,
  };
}

export async function getArchiveStats(): Promise<{
  totalRecords: number;
  totalHistories: number;
  oldestRecord: Date | null;
  newestRecord: Date | null;
  totalTriggers: number;
}> {
  const [totalRecords, totalHistories, oldestRecord, newestRecord, totalTriggers] =
    await Promise.all([
      prisma.fundingRecord.count(),
      prisma.fundingHistory.count(),
      prisma.fundingRecord.findFirst({ orderBy: { timestamp: 'asc' }, select: { timestamp: true } }),
      prisma.fundingRecord.findFirst({ orderBy: { timestamp: 'desc' }, select: { timestamp: true } }),
      prisma.alertTrigger.count(),
    ]);

  return {
    totalRecords,
    totalHistories,
    oldestRecord: oldestRecord?.timestamp || null,
    newestRecord: newestRecord?.timestamp || null,
    totalTriggers,
  };
}
