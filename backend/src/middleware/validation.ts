import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { logger } from '../utils/logger.js';

export function validate(schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = schema.parse(req[source]);
      req[source] = data;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const errors = err.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        logger.warn('Validation error:', errors);
        return res.status(400).json({
          ok: false,
          error: 'Validation failed',
          details: errors,
        });
      }
      next(err);
    }
  };
}
