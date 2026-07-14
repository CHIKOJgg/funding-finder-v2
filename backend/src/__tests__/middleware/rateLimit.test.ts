import { perUserLimiter } from '../../middleware/rateLimit.js';

function makeCtx() {
  const req: any = { userId: 'user-1', ip: '127.0.0.1' };
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

describe('rateLimit middleware - perUserLimiter', () => {
  it('allows requests under the limit', async () => {
    const limiter = perUserLimiter(3, 1000);
    let allowed = 0;
    for (let i = 0; i < 3; i++) {
      const { req, res, next } = makeCtx();
      await limiter(req, res, next);
      if (next.mock.calls.length > 0) allowed++;
    }
    expect(allowed).toBe(3);
  });

  it('returns 429 once the limit is exceeded', async () => {
    const limiter = perUserLimiter(2, 1000);
    const statuses: number[] = [];
    const called: number[] = [];
    for (let i = 0; i < 5; i++) {
      const ctx = makeCtx();
      await limiter(ctx.req, ctx.res, ctx.next);
      statuses.push(ctx.status());
      called.push(ctx.next.mock.calls.length);
    }
    // First 2 allowed (status stays 0), next 3 blocked (429).
    expect(statuses.filter((s) => s === 429).length).toBe(3);
    expect(statuses.filter((s) => s === 0).length).toBe(2);
  });

  it('limits per user id independently', async () => {
    const limiter = perUserLimiter(1, 1000);
    const a = makeCtx();
    a.req.userId = 'user-a';
    await limiter(a.req, a.res, a.next);
    const b = makeCtx();
    b.req.userId = 'user-b';
    await limiter(b.req, b.res, b.next);
    // Both should be allowed because they have different ids.
    expect(a.next.mock.calls.length).toBe(1);
    expect(b.next.mock.calls.length).toBe(1);
  });
});
