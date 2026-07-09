import { PrismaClient } from '@prisma/client';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const isProd = config.isProduction;

export const prisma = new PrismaClient({
  log: isProd ? ['error'] : ['error', 'warn'],
  datasources: {
    db: {
      url: config.databaseUrl,
    },
  },
});

export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$connect();
    logger.info('PostgreSQL connected via Prisma');

    // Verify connection with a test query
    await prisma.$queryRaw`SELECT 1 as alive`;
    logger.info('PostgreSQL connection verified');
  } catch (err) {
    logger.error('PostgreSQL connection error:', err);
    throw err;
  }
}

export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
    logger.info('PostgreSQL disconnected');
  } catch (err) {
    logger.error('PostgreSQL disconnect error:', err);
  }
}

export async function checkDatabaseHealth(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}
