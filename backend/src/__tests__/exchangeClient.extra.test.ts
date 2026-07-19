import {
  cache,
  circuitBreaker,
  mapWithConcurrency,
  retry,
  cachedRequest,
  safeParseFloat,
  safeParseInt,
  getOrCreateClient,
  createApiClient,
  cleanupConnections,
  sleep,
} from '../utils/exchangeClient.js';

jest.mock('axios');
jest.mock('../utils/logger.js');
jest.mock('../utils/redis.js', () => ({ getRedis: () => null }));

// Provide a deterministic fake axios.create so getOrCreateClient returns a real
// object (the auto-mock would return `undefined`).
import axios from 'axios';
(axios as any).create = jest.fn((cfg: any) => ({ __client: true, defaults: cfg }));
// Make axios.isAxiosError recognise our fakes so retry() can read status.
(axios as any).isAxiosError = (e: any): boolean => !!(e && e.isAxiosError === true);

describe('exchangeClient — MemoryCache', () => {
  beforeEach(() => cleanupConnections());

  it('stores and returns a value before expiry', () => {
    cache.set('a', 123, 1000);
    expect(cache.get('a')).toBe(123);
  });

  it('returns null for missing key', () => {
    expect(cache.get('missing')).toBeNull();
  });

  it('expires entries after ttl', async () => {
    cache.set('b', 'v', 5);
    await sleep(15);
    expect(cache.get('b')).toBeNull();
  });

  it('clears all entries', () => {
    cache.set('c1', 1);
    cache.set('c2', 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('c1')).toBeNull();
  });

  it('exposes keys iterator', () => {
    cache.set('k1', 1);
    cache.set('k2', 2);
    const keys = [...cache.keys()];
    expect(keys).toContain('k1');
    expect(keys).toContain('k2');
  });

  it('evicts oldest entry when max size reached', () => {
    // Force a tiny max by repeatedly setting; default max 20000 is high, so we
    // just assert eviction does not throw and size stays bounded-ish by using a
    // large volume that would exceed the cap.
    for (let i = 0; i < 20005; i++) {
      cache.set(`evict-${i}`, i, 60000);
    }
    // The store must have evicted at least something (size <= maxSize).
    expect(cache.size).toBeLessThanOrEqual(20000);
  });
});

describe('exchangeClient — CircuitBreaker', () => {
  beforeEach(() => {
    cleanupConnections();
    circuitBreaker.reset();
  });

  it('passes success through and tracks state', async () => {
    const res = await circuitBreaker.execute('k1', async () => 'ok');
    expect(res).toBe('ok');
  });

  it('opens after failureThreshold (5) consecutive failures', async () => {
    const failing = async () => {
      throw new Error('boom');
    };
    for (let i = 0; i < 5; i++) {
      await expect(circuitBreaker.execute('k2', failing)).rejects.toThrow('boom');
    }
    // 6th call should short-circuit without invoking fn.
    let invoked = false;
    await expect(
      circuitBreaker.execute('k2', async () => {
        invoked = true;
        return 'x';
      })
    ).rejects.toThrow('Circuit breaker open for k2');
    expect(invoked).toBe(false);
  });

  it('resets to closed after resetTimeout elapses (half-open)', async () => {
    const failing = async () => {
      throw new Error('boom');
    };
    for (let i = 0; i < 5; i++) {
      try {
        await circuitBreaker.execute('k3', failing);
      } catch {
        /* expected */
      }
    }
    // Manually age the circuit so resetTimeout passes.
    const cb: any = (circuitBreaker as any).circuits.get('k3');
    cb.lastFailure = Date.now() - 61_000;

    // Next call enters half-open, fails again -> opens immediately.
    await expect(circuitBreaker.execute('k3', failing)).rejects.toThrow('boom');

    cb.lastFailure = Date.now() - 61_000;
    // Half-open succeeds -> closes.
    const ok = await circuitBreaker.execute('k3', async () => 'recovered');
    expect(ok).toBe('recovered');
    expect((circuitBreaker as any).circuits.get('k3').state).toBe('closed');
    expect((circuitBreaker as any).circuits.get('k3').failures).toBe(0);
  });

  it('reset(key) clears a single circuit', async () => {
    const failing = async () => {
      throw new Error('boom');
    };
    for (let i = 0; i < 5; i++) {
      try {
        await circuitBreaker.execute('k4', failing);
      } catch {
        /* expected */
      }
    }
    circuitBreaker.reset('k4');
    expect((circuitBreaker as any).circuits.has('k4')).toBe(false);
    // After reset, success path works again.
    const ok = await circuitBreaker.execute('k4', async () => 'ok');
    expect(ok).toBe('ok');
  });

  it('treats a single failure as not yet open (below threshold)', async () => {
    await expect(circuitBreaker.execute('k5', async () => {
      throw new Error('one');
    })).rejects.toThrow('one');
    // Still closed -> next call attempts the real fn (not short-circuited).
    let invoked = false;
    const res = await circuitBreaker.execute('k5', async () => {
      invoked = true;
      return 'fine';
    });
    expect(invoked).toBe(true);
    expect(res).toBe('fine');
  });
});

describe('exchangeClient — retry with backoff', () => {
  beforeEach(() => cleanupConnections());

  it('returns on first success', async () => {
    const fn = jest.fn(async () => 'ok');
    const res = await retry(fn, 3);
    expect(res).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries until success within attempts', async () => {
    let calls = 0;
    const res = await retry(async () => {
      calls++;
      if (calls < 3) throw new Error('transient');
      return 'done';
    }, 5);
    expect(res).toBe('done');
    expect(calls).toBe(3);
  });

  it('throws after exhausting attempts', async () => {
    const fn = jest.fn(async () => {
      throw new Error('always');
    });
    await expect(retry(fn, 2)).rejects.toThrow('always');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 4xx (except 429/418)', async () => {
    const err: any = new Error('bad request');
    err.response = { status: 404 };
    (err as any).isAxiosError = true;
    const fn = jest.fn(async () => {
      throw err;
    });
    await expect(retry(fn, 5)).rejects.toThrow('bad request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 and 418', async () => {
    for (const status of [429, 418]) {
      let calls = 0;
      const e: any = new Error(`status ${status}`);
      e.response = { status };
      e.isAxiosError = true;
      await expect(
        retry(async () => {
          calls++;
          if (calls < 2) throw e;
          return 'ok';
        }, 3)
      ).resolves.toBe('ok');
      expect(calls).toBe(2);
    }
  });

  it('detects 418 from message string when status missing', async () => {
    let calls = 0;
    const e: any = new Error('418 I am a teapot');
    await expect(
      retry(async () => {
        calls++;
        if (calls < 2) throw e;
        return 'ok';
      }, 3)
    ).resolves.toBe('ok');
    expect(calls).toBe(2);
  });

  it('applies extra (x2) backoff for 418 vs 429', async () => {
    // Use fake timers so we can measure cumulative backoff deterministically
    // without waiting real milliseconds. retry wraps `helpers.sleep`.
    jest.useFakeTimers();
    const helpers = require('../utils/helpers.js');
    const sleepSpy = jest.spyOn(helpers, 'sleep').mockResolvedValue(undefined);
    const retryMod = require('../utils/exchangeClient.js');

    const makeErr = (status: number) => {
      const e: any = new Error(`status ${status}`);
      e.response = { status };
      e.isAxiosError = true;
      return e;
    };

    // 418: fail twice then succeed. Expected sleeps: 300*2^0*2 + 300*2^1*2
    const e418 = makeErr(418);
    let calls418 = 0;
    const p418 = retryMod.retry(async () => {
      calls418++;
      if (calls418 < 3) throw e418;
      return 'ok418';
    }, 3);
    await jest.runAllTimersAsync();
    await p418;
    const slept418 = sleepSpy.mock.calls.reduce((s: number, c: any) => s + c[0], 0);

    sleepSpy.mockClear();

    const e429 = makeErr(429);
    let calls429 = 0;
    const p429 = retryMod.retry(async () => {
      calls429++;
      if (calls429 < 3) throw e429;
      return 'ok429';
    }, 3);
    await jest.runAllTimersAsync();
    await p429;
    const slept429 = sleepSpy.mock.calls.reduce((s: number, c: any) => s + c[0], 0);

    // 418 path must sleep MORE than the equivalent 429 path (x2 multiplier).
    expect(slept418).toBeGreaterThan(slept429);
    expect(slept418).toBe(1800);
    expect(slept429).toBe(900);

    sleepSpy.mockRestore();
    jest.useRealTimers();
  });
});

describe('exchangeClient — cachedRequest', () => {
  beforeEach(() => cleanupConnections());

  it('calls fn once and serves cached value on subsequent calls', async () => {
    let calls = 0;
    const fn = jest.fn(async () => {
      calls++;
      return { n: calls };
    });
    const a = await cachedRequest('cr1', fn, 1000);
    const b = await cachedRequest('cr1', fn, 1000);
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });

  it('re-invokes fn after expiry', async () => {
    let calls = 0;
    const fn = jest.fn(async () => {
      calls++;
      return calls;
    });
    await cachedRequest('cr2', fn, 5);
    await sleep(15);
    await cachedRequest('cr2', fn, 5);
    expect(calls).toBe(2);
  });
});

describe('exchangeClient — safe parsers', () => {
  it('safeParseFloat handles all edge cases', () => {
    expect(safeParseFloat(null)).toBe(0);
    expect(safeParseFloat(undefined)).toBe(0);
    expect(safeParseFloat('')).toBe(0);
    expect(safeParseFloat('  3.5  ')).toBe(3.5);
    expect(safeParseFloat('abc', 9)).toBe(9);
    expect(safeParseFloat(NaN, 1)).toBe(1);
    expect(safeParseFloat(Infinity, 2)).toBe(2);
  });

  it('safeParseInt handles all edge cases', () => {
    expect(safeParseInt(null)).toBe(0);
    expect(safeParseInt('  42  ')).toBe(42);
    expect(safeParseInt('xyz', 7)).toBe(7);
    expect(safeParseInt('3.9')).toBe(3);
    expect(safeParseInt(NaN, 5)).toBe(5);
  });
});

describe('exchangeClient — client pool', () => {
  beforeEach(() => cleanupConnections());

  it('returns a shared client per baseUrl+timeout', () => {
    const c1 = getOrCreateClient('https://x.test', 5000);
    const c2 = getOrCreateClient('https://x.test', 5000);
    expect(c1).toBe(c2);
    expect(c1).toBeDefined();
  });

  it('creates distinct clients for differing baseUrl', () => {
    const a = getOrCreateClient('https://a.test');
    const b = getOrCreateClient('https://b.test');
    expect(a).not.toBe(b);
  });

  it('createApiClient is an alias of getOrCreateClient', () => {
    expect(createApiClient('https://y.test')).toBe(getOrCreateClient('https://y.test'));
  });
});

describe('exchangeClient — mapWithConcurrency (resilience)', () => {
  beforeEach(() => cleanupConnections());

  it('preserves order and never exceeds concurrency cap under load', async () => {
    const items = Array.from({ length: 500 }, (_, i) => i);
    let inFlight = 0;
    let maxInFlight = 0;
    const results = await mapWithConcurrency(items, { concurrency: 10, delayMs: 0 }, async (x) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return x;
    });
    expect(results).toEqual(items);
    expect(maxInFlight).toBeLessThanOrEqual(10);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('isolates failures: errored items become null, others succeed', async () => {
    const results = await mapWithConcurrency(
      [0, 1, 2, 3, 4],
      { concurrency: 2, delayMs: 0 },
      async (x) => {
        if (x === 2) throw new Error('bad');
        return x * 10;
      }
    );
    expect(results).toEqual([0, 10, null, 30, 40]);
  });
});
