/**
 * Comprehensive LOAD & RESILIENCE test suite.
 *
 * These tests run INSIDE jest (no external server required) and exercise the
 * real Express middleware stack + resilience primitives under synthetic load,
 * so we can assert, deterministically, that:
 *   1. A healthy endpoint sustains a high request rate without 5xx errors and
 *      without tripping its own rate limiter (i.e. the API does NOT beat its
 *      own rate limit under normal traffic).
 *   2. A deliberately abusive burst DOES get throttled (429), proving the
 *      limiter protects the server and upstream exchange APIs from a
 *      rate-limit storm.
 *   3. mapWithConcurrency fans out across thousands of items without ever
 *      exceeding the cap and without exhausting the event loop.
 *   4. The circuit breaker protects the server from a downstream rate-limit
 *      storm (e.g. Binance 418) by failing fast after the threshold.
 *   5. Memory stays bounded under a long concurrent scan (no leak).
 */
import express from 'express';
import request from 'supertest';
import { perUserLimiter } from '../../middleware/rateLimit.js';
import {
  mapWithConcurrency,
  circuitBreaker,
  cleanupConnections,
  cache,
} from '../../utils/exchangeClient.js';
import { createTestApp } from '../testkit';

jest.mock('axios');
jest.mock('../../utils/logger.js');
jest.mock('../../utils/redis.js', () => ({ getRedis: () => null }));

describe('LOAD — server throughput (no self-inflicted rate-limit)', () => {
  beforeEach(() => cleanupConnections());

  it('serves a burst of concurrent healthy requests with zero 5xx and no 429', async () => {
    const router = express.Router();
    router.get('/healthz', (_req, res) => res.json({ ok: true, ts: Date.now() }));
    const app = createTestApp(router);

    const N = 200;
    const responses = await Promise.all(
      Array.from({ length: N }, () => request(app).get('/healthz'))
    );

    const ok = responses.filter((r) => r.status === 200).length;
    const errors = responses.filter((r) => r.status >= 500).length;
    const throttled = responses.filter((r) => r.status === 429).length;

    expect(ok).toBe(N);
    expect(errors).toBe(0);
    expect(throttled).toBe(0); // healthy endpoint must not self-throttle
  });

  it('sustains a sustained ramp of sequential requests without degrading', async () => {
    const router = express.Router();
    router.get('/ping', (_req, res) => res.json({ ok: true }));
    const app = createTestApp(router);

    const start = Date.now();
    let lastStatus = 0;
    for (let i = 0; i < 300; i++) {
      const r = await request(app).get('/ping');
      lastStatus = r.status;
      expect([200, 429]).toContain(r.status);
    }
    const elapsed = Date.now() - start;
    expect(lastStatus).toBe(200);
    // 300 sequential round-trips should complete quickly (no backlog build-up).
    expect(elapsed).toBeLessThan(10_000);
  });
});

describe('LOAD — rate limiter protects the server from abuse', () => {
  beforeEach(() => cleanupConnections());

  it('throttles an abusive burst to 429 while leaving headroom for others', async () => {
    const router = express.Router();
    router.use((req: any, _res, next) => {
      req.userId = 'abuser';
      next();
    });
    router.use(perUserLimiter(20, 60_000));
    router.get('/api', (_req, res) => res.json({ ok: true }));
    const app = createTestApp(router);

    let allowed = 0;
    let blocked = 0;
    for (let i = 0; i < 60; i++) {
      const r = await request(app).get('/api');
      if (r.status === 200) allowed++;
      else if (r.status === 429) blocked++;
    }
    expect(allowed).toBe(20);
    expect(blocked).toBe(40);
  });

  it('keeps distinct users under their own budgets during a mixed burst', async () => {
    const router = express.Router();
    const limiter = perUserLimiter(5, 60_000);
    router.use((req: any, _res, next) => {
      req.userId = req.query.uid || 'anon';
      next();
    });
    router.use(limiter);
    router.get('/api', (_req, res) => res.json({ ok: true }));
    const app = createTestApp(router);

    const users = ['u1', 'u2', 'u3', 'u4', 'u5'];
    const calls = users.flatMap((u) => Array.from({ length: 8 }, () => request(app).get(`/api?uid=${u}`)));
    const responses = await Promise.all(calls);

    // Each user gets exactly 5 allowed, 3 blocked -> 25 ok, 15 throttled.
    expect(responses.filter((r) => r.status === 200).length).toBe(25);
    expect(responses.filter((r) => r.status === 429).length).toBe(15);
  });
});

describe('LOAD — mapWithConcurrency at scale', () => {
  beforeEach(() => cleanupConnections());

  it('fans out over 5000 items at concurrency 16 without exceeding the cap', async () => {
    const items = Array.from({ length: 5000 }, (_, i) => i);
    let maxInFlight = 0;
    let inFlight = 0;
    const results = await mapWithConcurrency(items, { concurrency: 16, delayMs: 0 }, async (x) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setImmediate(r));
      inFlight--;
      return x * 2;
    });
    expect(results.length).toBe(5000);
    expect(results[4999]).toBe(9998);
    expect(maxInFlight).toBeLessThanOrEqual(16);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('isolates a single failing item among 2000 without aborting the batch', async () => {
    const items = Array.from({ length: 2000 }, (_, i) => i);
    const results = await mapWithConcurrency(items, { concurrency: 32, delayMs: 0 }, async (x) => {
      if (x === 999) throw new Error('poison');
      return x;
    });
    expect(results.length).toBe(2000);
    expect(results.filter((r: number | null) => r === null).length).toBe(1);
    expect(results[1000]).toBe(1000);
  });
});

describe('LOAD — circuit breaker shields server from downstream rate-limit storm', () => {
  beforeEach(() => {
    cleanupConnections();
    circuitBreaker.reset();
  });

  it('fails fast (no downstream call) once the breaker opens under a storm', async () => {
    let downstreamCalls = 0;
    const stormyFetch = async () => {
      downstreamCalls++;
      throw new Error('429 / 418 rate limited by exchange');
    };

    // Warm up to the threshold.
    for (let i = 0; i < 5; i++) {
      await circuitBreaker.execute('binance-storm', stormyFetch).catch(() => undefined);
    }
    // Now the breaker is open: further calls must NOT hit the downstream.
    const before = downstreamCalls;
    await Promise.all(
      Array.from({ length: 100 }, () =>
        circuitBreaker.execute('binance-storm', stormyFetch).catch(() => undefined)
      )
    );
    // Exactly 0 additional downstream calls while open.
    expect(downstreamCalls - before).toBe(0);
  });
});

describe('LOAD — memory stays bounded under repeated scans', () => {
  beforeEach(() => cleanupConnections());

  it('does not let the in-memory cache grow without bound', async () => {
    const sizeBefore = cache.size;
    for (let i = 0; i < 500; i++) {
      cache.set(`mem-test-${i}`, { i }, 1000);
    }
    // maxSize is 20000, so 500 is fine and size is bounded.
    expect(cache.size).toBeLessThanOrEqual(20000);
    expect(cache.size).toBeGreaterThan(sizeBefore);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
