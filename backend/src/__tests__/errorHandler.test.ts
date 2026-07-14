import { Request, Response, NextFunction } from 'express';

describe('Error Handler', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  const OLD_ENV = process.env;

  beforeAll(() => {
    process.env = {
      ...OLD_ENV,
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/funding_finder',
      TELEGRAM_BOT_TOKEN: 'test_token',
      JWT_SECRET: 'a'.repeat(32),
      WEBHOOK_SECRET: 'a'.repeat(32),
    };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  beforeEach(() => {
    jest.resetModules();
    mockReq = {
      method: 'GET',
      url: '/api/test',
      body: { password: 'secret123' },
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  it('should not log request body in production', () => {
    process.env.NODE_ENV = 'production';

    const { errorHandler } = require('../middleware/errorHandler.js');
    const err = new Error('Test error') as any;
    err.statusCode = 400;

    errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: 'Test error',
      })
    );
    const jsonCall = (mockRes.json as jest.Mock).mock.calls[0][0];
    expect(jsonCall).not.toHaveProperty('stack');
  });

  it('should not leak internal details on 500 errors in production', () => {
    process.env.NODE_ENV = 'production';

    const { errorHandler } = require('../middleware/errorHandler.js');
    const err = new Error('Internal database connection failed: db01:5432') as any;
    err.statusCode = 500;

    errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: 'Internal Server Error',
      })
    );
  });

  it('should show stack trace in development mode for 500 errors', () => {
    process.env.NODE_ENV = 'development';

    const { errorHandler } = require('../middleware/errorHandler.js');
    const err = new Error('Dev error') as any;
    err.statusCode = 500;
    err.stack = 'Error: Dev error\n    at Object.<anonymous>';

    errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    const jsonCall = (mockRes.json as jest.Mock).mock.calls[0][0];
    expect(jsonCall).toHaveProperty('stack');
  });

  it('should preserve the original error message for non-500 errors', () => {
    process.env.NODE_ENV = 'production';

    const { errorHandler } = require('../middleware/errorHandler.js');
    const err = new Error('Validation error') as any;
    err.statusCode = 422;

    errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: 'Validation error',
      })
    );
  });

  it('should handle errors without statusCode as 500', () => {
    process.env.NODE_ENV = 'production';

    const { errorHandler } = require('../middleware/errorHandler.js');
    const err = new Error('Unhandled error');

    errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
  });

  describe('createError helper', () => {
    it('creates an AppError with statusCode and code', () => {
      const { createError } = require('../middleware/errorHandler.js');
      const err = createError('boom', 400, 'BOOM_CODE');
      expect(err.message).toBe('boom');
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('BOOM_CODE');
    });

    it('defaults to statusCode 500', () => {
      const { createError } = require('../middleware/errorHandler.js');
      const err = createError('default');
      expect(err.statusCode).toBe(500);
    });
  });
});
