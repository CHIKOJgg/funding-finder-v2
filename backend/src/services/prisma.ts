import { PrismaClient } from '@prisma/client';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const isProd = config.isProduction;

function runtimeDatabaseUrl(url: string): string {
  // Supabase session poolers have a small per-pool client limit. Prisma's
  // default pool can exhaust it when warm-up jobs and user requests overlap.
  // Keep schema sync on the original DIRECT_URL; this limit applies only to
  // the long-running application client.
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has('connection_limit')) parsed.searchParams.set('connection_limit', '5');
    if (!parsed.searchParams.has('pool_timeout')) parsed.searchParams.set('pool_timeout', '20');
    return parsed.toString();
  } catch {
    return url;
  }
}

export const prisma = new PrismaClient({
  log: isProd ? ['error'] : ['error', 'warn'],
  datasources: {
    db: {
      url: runtimeDatabaseUrl(config.databaseUrl),
    },
  },
});

let keepAliveTimer: NodeJS.Timeout | null = null;

export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$connect();
    logger.info('PostgreSQL connected via Prisma');

    // Verify connection with a test query
    await prisma.$queryRaw`SELECT 1 as alive`;
    logger.info('PostgreSQL connection verified');

    // Keep the connection pool warm. Background work (e.g. the periodic
    // funding warm-up scan) can leave the pool idle for minutes at a time;
    // Railway's Postgres then closes those idle connections and the next
    // authenticated request pays a ~1s reconnect PER query — which made
    // Profile / tabs feel like they took 3-5s to open every time the pool
    // went cold. A cheap periodic ping keeps every pooled connection alive.
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = setInterval(() => {
      prisma
        .$queryRaw`SELECT 1`
        .then(() => {})
        .catch((e) => logger.debug({ err: (e as Error).message }, 'DB keepalive ping failed'));
    }, 30_000);
  } catch (err) {
    logger.error('PostgreSQL connection error:', err);
    throw err;
  }
}

export async function disconnectDatabase(): Promise<void> {
  try {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
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
