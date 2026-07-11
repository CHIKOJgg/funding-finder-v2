import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

/**
 * Per-user rate limiter. Falls back to the request IP when no authenticated
 * user is present (shouldn't happen on protected routes, but keeps the
 * keyGenerator safe). Keyed by Telegram user id so a single abusive account
 * is throttled independently of others.
 */
export function perUserLimiter(max: number, windowMs: number) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => (req as any).userId || req.ip || 'unknown',
    message: { ok: false, error: 'Too many requests, please slow down' },
  });
}
