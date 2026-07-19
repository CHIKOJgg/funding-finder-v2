import rateLimit, { ipKeyGenerator, Options } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { Request, Response } from 'express';
import { logger } from '../utils/logger.js';
import { getRedis } from '../utils/redis.js';
import { config } from '../config/index.js';

/**
 * Build a rate-limit store backed by the shared Redis instance when REDIS_URL
 * is configured, so limits are enforced ACROSS all app instances behind the
 * load balancer (Render runs multiple pods, each with its own IP — an in-memory
 * store lets a user get `max` requests PER pod, effectively multiplying the
 * budget and making 429s non-deterministic). Falls back to the built-in
 * in-memory store (undefined) for single-instance / local dev where Redis is
 * absent. The `prefix` namespaces each limiter so their counters never collide.
 */
export function createRateLimitStore(prefix: string): Options['store'] | undefined {
  const redis = getRedis();
  if (!redis) return undefined;
  try {
    return new RedisStore({
      // rate-limit-redis v4 talks to the store via a raw command sender; ioredis
      // exposes exactly this shape via `call`.
      sendCommand: (...args: string[]) => (redis as any).call(...args),
      prefix: `rl:${prefix}:`,
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, `Failed to init Redis rate-limit store (${prefix}); falling back to in-memory`);
    return undefined;
  }
}

/**
 * Per-user rate limiter. Falls back to the request IP when no authenticated
 * user is present (shouldn't happen on protected routes, but keeps the
 * keyGenerator safe). Keyed by Telegram user id so a single abusive account
 * is throttled independently of others. `ipKeyGenerator` is used for the IP
 * fallback so express-rate-limit handles IPv6-safe normalization.
 *
 * When Redis is configured the counter is shared across every instance, so the
 * cap is a true global per-user limit rather than per-pod.
 */

// Developer / admin accounts that bypass all per-user rate limits. They need
// generous headroom for debugging and load testing. Configured via
// DEV_ULTIMATE_TELEGRAM_IDS (admin ids are also exempt); empty by default.
const RATE_LIMIT_EXEMPT_USERS = new Set<string>([
  ...config.admin.devUltimateTelegramIds,
  ...config.admin.telegramIds,
].map((id) => `tg_${id}`));

/**
 * Returns true when the request should skip the limiter entirely (exempt user).
 */
function isExemptFromLimits(req: Request): boolean {
  const userId = (req as any).userId || (req as any).user?.id;
  if (!userId) return false;
  return RATE_LIMIT_EXEMPT_USERS.has(userId);
}

export function perUserLimiter(max: number, windowMs: number, name = 'per-user') {
  return rateLimit({
    windowMs,
    max,
    // `limit` is the modern key in express-rate-limit v7+; `max` is kept for
    // backward compatibility (v8 still only reads `max`). Providing both keeps
    // the intended cap working across versions.
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    // Ultimate-tier (dev/admin) users bypass per-user caps entirely.
    skip: (req: Request) => isExemptFromLimits(req),
    store: createRateLimitStore(name),
    keyGenerator: (req: Request, _res: Response) =>
      (req as any).user?.id || (req as any).userId || ipKeyGenerator(req.ip as string),
    message: { ok: false, error: 'Too many requests, please slow down' },
    // Surface every rejection with context so a 429 storm is diagnosable
    // without guessing which limiter / user / route tripped.
    handler: (req, res, _next, options) => {
      const userId = (req as any).userId || (req as any).user?.id || null;
      const ip = req.ip || (req.headers['x-forwarded-for'] as string) || 'unknown';
      logger.warn(
        { limiter: name, userId, ip, route: req.path, method: req.method },
        `Rate limit hit (${name}): user=${userId} ip=${ip} ${req.method} ${req.path}`
      );
      res.status(options.statusCode).json(options.message);
    },
  });
}
