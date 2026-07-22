import Redis from 'ioredis';
import { config } from '../config/index.js';
import { logger } from './logger.js';

// Lazily-initialized shared Redis client. Returns null when REDIS_URL is not
// configured, so callers can fall back to in-memory implementations (single
// instance deployments). The connection is created on first use and failures
// are logged but never thrown, to avoid crashing the process over Redis.
let client: Redis | null = null;
let initialized = false;

export function getRedis(): Redis | null {
  if (initialized) return client;
  initialized = true;

  if (!config.redis.url) {
    if (config.isProduction) {
      logger.warn(
        'REDIS_URL is not set in production — cross-instance webhook idempotency and rate limits are DISABLED. ' +
          'Set REDIS_URL to enable safe horizontal scaling.'
      );
    }
    return null;
  }

  try {
    client = new Redis(config.redis.url, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      // Don't let a slow/unreachable Redis block the event loop forever.
      connectTimeout: 5000,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
    });
    client.on('error', (err) => logger.debug({ err: err.message }, 'Redis client error'));
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Failed to initialize Redis client');
    client = null;
  }

  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    try {
      await client.quit();
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Error closing Redis connection');
    }
    client = null;
    initialized = false;
  }
}
