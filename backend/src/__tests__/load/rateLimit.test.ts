import express from 'express';
import request from 'supertest';
import { perUserLimiter } from '../../middleware/rateLimit.js';
import { createTestApp } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';

jest.mock('axios');
jest.mock('../../utils/logger.js');

describe('perUserLimiter under rapid repeated requests', () => {
  beforeEach(() => {
    jest.resetModules();
    cleanupConnections();
  });

  it('returns 429 after the per-user limit is exceeded', async () => {
    const router = express.Router();
    // Pin a stable user id so the limiter keys by user (not the request IP),
    // which also avoids express-rate-limit's IPv6 keyGenerator warning.
    router.use((req: any, _res, next) => {
      req.userId = 'load-test-user';
      next();
    });
    router.use(perUserLimiter(5, 60_000));
    router.get('/ping', (_req, res) => res.json({ ok: true }));

    const app = createTestApp(router);

    const statuses: number[] = [];
    for (let i = 0; i < 9; i++) {
      const res = await request(app).get('/ping');
      statuses.push(res.status);
    }

    const allowed = statuses.filter((s) => s === 200).length;
    const blocked = statuses.filter((s) => s === 429).length;

    // Exactly 5 allowed, the rest throttled.
    expect(allowed).toBe(5);
    expect(blocked).toBeGreaterThanOrEqual(1);
    expect(statuses[statuses.length - 1]).toBe(429);
  });

  it('throttles each user independently by id', async () => {
    const router = express.Router();
    const limiter = perUserLimiter(2, 60_000);
    router.use((req: any, _res, next) => {
      req.userId = req.query.uid || 'anon';
      next();
    });
    router.use(limiter);
    router.get('/ping', (_req, res) => res.json({ ok: true }));

    const app = createTestApp(router);

    const a1 = await request(app).get('/ping?uid=A');
    const a2 = await request(app).get('/ping?uid=A');
    const a3 = await request(app).get('/ping?uid=A');
    const b1 = await request(app).get('/ping?uid=B');

    expect(a1.status).toBe(200);
    expect(a2.status).toBe(200);
    expect(a3.status).toBe(429); // user A exhausted
    expect(b1.status).toBe(200); // user B has its own budget
  });
});
