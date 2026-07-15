import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';

export function requestId(req: Request, _res: Response, next: NextFunction) {
  const id = req.headers['x-request-id'] as string || crypto.randomUUID();
  req.headers['x-request-id'] = id;
  next();
}

// Requests slower than this are logged as a warning — a saturated event loop
// (e.g. a concurrent warm-up + user scan) shows up here first.
const SLOW_MS = 2000;

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const { method, url } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const userId = (req as any).userId || (req as any).user?.id || null;
    const ip = req.ip || (req.headers['x-forwarded-for'] as string) || 'unknown';

    const base = {
      method,
      url,
      status: res.statusCode,
      duration: `${duration}ms`,
      requestId: req.headers['x-request-id'],
      userId,
      ip,
    };

    let level: 'info' | 'warn' | 'error' = 'info';
    if (res.statusCode >= 500) level = 'error';
    else if (res.statusCode >= 400) level = 'warn';

    // Slow requests get escalated regardless of status so stalls are visible.
    if (duration >= SLOW_MS && level === 'info') level = 'warn';

    const suffix =
      duration >= SLOW_MS ? ` (SLOW)` :
      res.statusCode >= 500 ? ` (SERVER ERROR)` :
      res.statusCode >= 400 ? ` (CLIENT ERROR)` : '';

    logger[level](base, `${method} ${url} ${res.statusCode} ${duration}ms${suffix}`);
  });

  next();
}
