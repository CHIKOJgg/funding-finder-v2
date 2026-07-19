import { perUserLimiter, createRateLimitStore } from '../../middleware/rateLimit.js';

// The owner id is exempt from all per-user limits.
const EXEMPT_USER = 'tg_5915824444';

function makeCtx(overrides: Record<string, any> = {}) {
  const req: any = { userId: 'user-1', ip: '127.0.0.1', user: { id: 'user-1' }, ...overrides };
  const res: any = {
    statusCode: 0,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return res;
    },
    json() {
      return res;
    },
    set() {
      return res;
    },
    setHeader() {
      return res;
    },
    getHeader() {
      return undefined;
    },
    send() {
      return res;
    },
    writableEnded: false,
  };
  const next = jest.fn();
  return { req, res, next, status: () => res.statusCode };
}

describe('rateLimit middleware — exempt users & fallback', () => {
  it('never throttles an exempt (owner) user regardless of volume', async () => {
    const limiter = perUserLimiter(2, 1000);
    let allowed = 0;
    for (let i = 0; i < 50; i++) {
      const { req, next } = makeCtx({ userId: EXEMPT_USER, user: { id: EXEMPT_USER } });
      await limiter(req, {} as any, next);
      if (next.mock.calls.length > 0) allowed++;
    }
    expect(allowed).toBe(50);
  });

  it('falls back to the request IP when no user id is present', async () => {
    const limiter = perUserLimiter(1, 1000);
    const a = makeCtx({ userId: undefined, user: undefined, ip: '10.0.0.1' });
    await limiter(a.req, a.res, a.next);
    const b = makeCtx({ userId: undefined, user: undefined, ip: '10.0.0.2' });
    await limiter(b.req, b.res, b.next);
    // Different IPs -> independent budgets.
    expect(a.next.mock.calls.length).toBe(1);
    expect(b.next.mock.calls.length).toBe(1);
  });

  it('createRateLimitStore returns undefined (in-memory) when Redis is absent', () => {
    // With REDIS_URL unset (test env), getRedis() returns null -> in-memory store.
    const store = createRateLimitStore('test');
    expect(store).toBeUndefined();
  });
});
