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

// Must match the Prisma pool size (see runtimeDatabaseUrl). We ping every
// pooled connection concurrently so NONE of them goes idle-long-enough for
// Railway's Postgres to close it.
const POOL_SIZE = 10;

export async function connectDatabase(): Promise<void> {
  try {
    try {
      const u = new URL(config.databaseUrl);
      console.log(`[DBHOST] ${u.protocol}//${u.hostname}:${u.port}${u.search}`);
    } catch (e) {
      console.log(`[DBHOST] unparseable: ${(e as Error).message}`);
    }
    await prisma.$connect();
    logger.info('PostgreSQL connected via Prisma');

    // Verify connection with a test query
    await prisma.$queryRaw`SELECT 1 as alive`;
    logger.info('PostgreSQL connection verified');

    // Keep the WHOLE connection pool warm. Railway's Postgres closes idle
    // connections after a short timeout; if only one connection is pinged, the
    // rest go cold and every authenticated request pays a ~1s reconnect PER
    // query (profile = 3 queries => 3-5s). So we ping all `POOL_SIZE`
    // connections concurrently on a tight interval and never let any idle out.
    if (process.env.DISABLE_KEEPALIVE === 'true') {
      logger.info('DB keepalive disabled via DISABLE_KEEPALIVE env');
      return;
    }
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = setInterval(() => {
      Promise.all(
        Array.from({ length: POOL_SIZE }, () =>
          prisma
            .$queryRaw`SELECT 1`
            .then(() => {})
            .catch((e) => logger.debug({ err: (e as Error).message }, 'DB keepalive ping failed'))
        )
      ).catch(() => {});
    }, 8_000);
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
