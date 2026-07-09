import { Request, Response, NextFunction } from 'express';

describe('Validation Middleware', () => {
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
    mockReq = { body: {}, query: {}, params: {} };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  it('should pass valid body data', () => {
    const { z } = require('zod');
    const schema = z.object({ name: z.string().min(1) });
    mockReq.body = { name: 'test' };

    const { validate } = require('../middleware/validation.js');
    validate(schema, 'body')(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockReq.body).toEqual({ name: 'test' });
  });

  it('should reject invalid body data', () => {
    const { z } = require('zod');
    const schema = z.object({ name: z.string().min(1) });
    mockReq.body = { name: '' };

    const { validate } = require('../middleware/validation.js');
    validate(schema, 'body')(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: 'Validation failed',
        details: expect.arrayContaining([
          expect.objectContaining({ field: 'name' }),
        ]),
      })
    );
  });

  it('should validate query parameters', () => {
    const { z } = require('zod');
    const schema = z.object({ limit: z.string().optional() });
    mockReq.query = { limit: '10' };

    const { validate } = require('../middleware/validation.js');
    validate(schema, 'query')(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should validate params', () => {
    const { z } = require('zod');
    const schema = z.object({ id: z.string().min(1) });
    mockReq.params = { id: '123' };

    const { validate } = require('../middleware/validation.js');
    validate(schema, 'params')(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should provide detailed error messages', () => {
    const { z } = require('zod');
    const schema = z.object({
      email: z.string().email(),
      age: z.number().min(18),
    });
    mockReq.body = { email: 'not-an-email', age: 15 };

    const { validate } = require('../middleware/validation.js');
    validate(schema, 'body')(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.arrayContaining([
          expect.objectContaining({ field: 'email' }),
          expect.objectContaining({ field: 'age' }),
        ]),
      })
    );
  });
});
