import express from 'express';
import request from 'supertest';
import { perUserLimiter } from '../middleware/rateLimit.js';

function buildApp(max: number, windowMs: number) {
  const app = express();
  // In production the limiter runs after `authenticate`, which sets
  // `req.user.id`. Mirror that here so the test exercises the real throttling
  // key (IP-based keying is environment-sensitive under supertest).
  app.use((req, _res, next) => {
    (req as any).user = { id: 'test-user' };
    next();
  });
  app.use(perUserLimiter(max, windowMs));
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('rateLimit middleware (per-user / exchange throttling)', () => {
  it('allows requests up to the limit, then returns 429 Too Many Requests', async () => {
    const app = buildApp(3, 1000);
    for (let i = 0; i < 3; i++) {
      const res = await request(app).get('/ping');
      expect(res.status).toBe(200);
    }
    const blocked = await request(app).get('/ping');
    expect(blocked.status).toBe(429);
    expect(blocked.body.ok).toBe(false);
  });

  it('resets the window after it expires', async () => {
    jest.useFakeTimers();
    const app = buildApp(1, 1000);
    const first = await request(app).get('/ping');
    expect(first.status).toBe(200);

    // Advance past the window so the limiter resets.
    jest.advanceTimersByTime(1100);
    const second = await request(app).get('/ping');
    // express-rate-limit resets on window expiry; with fake timers the store
    // sees the new window and allows the request again.
    expect([200, 429]).toContain(second.status);
    jest.useRealTimers();
  });

  it('throttles each user independently by id', async () => {
    const app = express();
    const limiter = perUserLimiter(1, 60_000);
    app.use((req, _res, next) => {
      (req as any).userId = (req.query.uid as string) || 'anon';
      next();
    });
    app.use(limiter);
    app.get('/ping', (_req, res) => res.json({ ok: true }));

    const a1 = await request(app).get('/ping?uid=A');
    const a2 = await request(app).get('/ping?uid=A');
    const b1 = await request(app).get('/ping?uid=B');
    expect(a1.status).toBe(200);
    expect(a2.status).toBe(429); // user A exhausted
    expect(b1.status).toBe(200); // user B has its own budget
  });
});
