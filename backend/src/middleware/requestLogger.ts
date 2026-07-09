import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';

export function requestId(req: Request, _res: Response, next: NextFunction) {
  const id = req.headers['x-request-id'] as string || crypto.randomUUID();
  req.headers['x-request-id'] = id;
  next();
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const { method, url } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]({
      method,
      url,
      status: res.statusCode,
      duration: `${duration}ms`,
      requestId: req.headers['x-request-id'],
    }, `${method} ${url} ${res.statusCode} ${duration}ms`);
  });

  next();
}
