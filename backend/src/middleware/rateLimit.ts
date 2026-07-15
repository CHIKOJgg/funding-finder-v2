import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { logger } from '../utils/logger.js';

/**
 * Per-user rate limiter. Falls back to the request IP when no authenticated
 * user is present (shouldn't happen on protected routes, but keeps the
 * keyGenerator safe). Keyed by Telegram user id so a single abusive account
 * is throttled independently of others. `ipKeyGenerator` is used for the IP
 * fallback so express-rate-limit handles IPv6-safe normalization.
 */
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
