import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

export function errorHandler(err: AppError, req: Request, res: Response, next: NextFunction) {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  logger.error({
    err: {
      message: err.message,
      stack: err.stack,
      code: err.code,
    },
    req: {
      method: req.method,
      url: req.url,
    },
  }, `Error: ${message}`);

  res.status(statusCode).json({
    ok: false,
    error: statusCode >= 500 ? 'Internal Server Error' : message,
    ...(process.env.NODE_ENV === 'development' && statusCode >= 500 && { stack: err.stack }),
  });
}

export function createError(message: string, statusCode: number = 500, code?: string): AppError {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
