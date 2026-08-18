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
    // Upstash and most managed Redis providers require TLS (rediss://).
    // Auto-upgrade plain redis:// URLs that point to upstash.io or render.com
    // to avoid "Connection closed" after the first idle timeout.
    let url = config.redis.url;
    if (url.startsWith('redis://') && (url.includes('upstash.io') || url.includes('render.com'))) {
      url = url.replace('redis://', 'rediss://');
      logger.info('Auto-upgraded Redis URL to TLS (rediss://) for managed provider');
    }
    client = new Redis(url, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      connectTimeout: 10000,
      retryStrategy: (times) => {
        if (times > 5) return null;
        return Math.min(times * 500, 3000);
      },
    });
    client.setMaxListeners(20);
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
  }
  initialized = false;
}
