/**
 * Unit tests for src/utils/exchangeClient.ts
 *
 * Tests the resilience / rate-limit / load-handling machinery:
 *  - MemoryCache (TTL expiry, maxSize eviction, clear)
 *  - CircuitBreaker (open after threshold, half-open recovery, reset, isolation)
 *  - mapWithConcurrency (bounded in-flight, order, length)
 *  - retry (exponential backoff, 4xx-no-retry, 429/network-retry)
 *  - cachedRequest / safeParseFloat / safeParseInt
 *  - getOrCreateClient / createApiClient / cleanupConnections
 */
import { installMockAxios } from './testkit';

jest.mock('axios');
import axios from 'axios';
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
} from '../utils/exchangeClient.js';

// installMockAxios replaces axios.create / isAxiosError used by exchangeClient
const mockAxios = installMockAxios();

beforeEach(() => {
  // Isolate shared singleton state between tests.
  cleanupConnections();
  jest.useRealTimers();
});

// ==================== MemoryCache ====================

describe('MemoryCache (via exported `cache`)', () => {
  test('set then get returns the stored value', () => {
    cache.set('a', { x: 1 }, 10_000);
    expect(cache.get('a')).toEqual({ x: 1 });
  });

  test('get returns null for unknown key', () => {
    expect(cache.get('does-not-exist')).toBeNull();
  });

  test('get returns null after TTL expiry', async () => {
    cache.set('exp', 'value', 20);
    expect(cache.get('exp')).toBe('value');
    await new Promise((r) => setTimeout(r, 35));
    expect(cache.get('exp')).toBeNull();
  });

  test('clear empties the cache', () => {
    cache.set('x', 1);
    cache.set('y', 2);
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('x')).toBeNull();
  });

  test('evictOldest keeps size bounded at maxSize (20000)', () => {
    const MAX = 20000;
    const keys = Array.from({ length: MAX + 1 }, (_, i) => `k${i}`);
    for (const k of keys) cache.set(k, k);

    expect(cache.size).toBe(MAX);
    // The very first inserted key should have been evicted.
    expect(cache.get('k0')).toBeNull();
    // The last inserted key is present.
    expect(cache.get(`k${MAX}`)).toBe(`k${MAX}`);
  });
});

// ==================== CircuitBreaker ====================

describe('CircuitBreaker (via exported `circuitBreaker`)', () => {
  const fail = () => Promise.reject(new Error('boom'));
  const ok = (v: any) => async () => v;
  const rejectsBoom = (key: string) =>
    expect(circuitBreaker.execute(key, fail)).rejects.toThrow('boom');
  const rejectsOpen = (key: string) =>
    expect(circuitBreaker.execute(key, fail)).rejects.toThrow(`Circuit breaker open for ${key}`);

  test('stays closed and propagates errors below the threshold (4 failures)', async () => {
    await rejectsBoom('closed');
    await rejectsBoom('closed');
    await rejectsBoom('closed');
    await rejectsBoom('closed');
    // After 4 failures the circuit is still closed -> 5th attempt still runs fn (boom), opening it.
    await rejectsBoom('closed');
  });

  test('opens after failureThreshold (5) failures and throws "open" message', async () => {
    await rejectsBoom('openA');
    await rejectsBoom('openA');
    await rejectsBoom('openA');
    await rejectsBoom('openA');
    await rejectsBoom('openA'); // 5th failure opens the circuit
    await rejectsOpen('openA'); // 6th call is rejected as open
  });

  test('different keys are independent', async () => {
    for (let i = 0; i < 5; i++) await rejectsBoom('indepA');
    await rejectsOpen('indepA'); // A is open
    await expect(circuitBreaker.execute('indepB', ok('ok'))).resolves.toBe('ok'); // B unaffected
  });

  test('reset(key) clears a single circuit so it works again', async () => {
    for (let i = 0; i < 5; i++) await rejectsBoom('resetA');
    await rejectsOpen('resetA');

    circuitBreaker.reset('resetA');
    await expect(circuitBreaker.execute('resetA', ok('recovered'))).resolves.toBe('recovered');
  });

  test('reset() with no key clears every circuit', async () => {
    for (let i = 0; i < 5; i++) await rejectsBoom('allA');
    for (let i = 0; i < 5; i++) await rejectsBoom('allB');
    circuitBreaker.reset();
    await expect(circuitBreaker.execute('allA', ok(1))).resolves.toBe(1);
    await expect(circuitBreaker.execute('allB', ok(2))).resolves.toBe(2);
  });

  test('moves to half-open after resetTimeout and closes on success', async () => {
    jest.useFakeTimers();
    try {
      for (let i = 0; i < 5; i++) await rejectsBoom('half');
      await rejectsOpen('half'); // Now open.

      // Advance beyond the 60000ms reset timeout.
      jest.advanceTimersByTime(61_000);

      // Next call moves to half-open and, on success, closes.
      await expect(circuitBreaker.execute('half', ok('win'))).resolves.toBe('win');

      // Circuit is closed again -> failures restart from 0.
      await rejectsBoom('half');
      await rejectsBoom('half');
      await rejectsBoom('half');
      await rejectsBoom('half');
      // Only 4 failures after recovery -> still closed, so success.
      await expect(circuitBreaker.execute('half', ok('still-ok'))).resolves.toBe('still-ok');
    } finally {
      jest.useRealTimers();
    }
  });
});

// ==================== mapWithConcurrency ====================

describe('mapWithConcurrency', () => {
  test('preserves order and returns array of the same length', async () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const result = await mapWithConcurrency(
      input,
      { concurrency: 3, delayMs: 1 },
      async (item) => item * 2
    );
    expect(result).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(result).toHaveLength(input.length);
  });

  test('never exceeds `concurrency` in-flight, even with errors', async () => {
    const input = Array.from({ length: 12 }, (_, i) => i);
    let active = 0;
    let maxActive = 0;

    const result = await mapWithConcurrency(
      input,
      { concurrency: 3, delayMs: 5 },
      async (item) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        if (item === 5) throw new Error('fail');
        return item;
      }
    );

    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBe(3); // we did actually run concurrently
    expect(result).toHaveLength(input.length);
    // item 5 errored -> null in that slot
    expect(result[5]).toBeNull();
  });
});

// ==================== retry ====================

describe('retry', () => {
  test('returns result on first success without delay', async () => {
    const fn = jest.fn(async () => 'done');
    await expect(retry(fn, 3, 1)).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('does NOT retry on a 404 (4xx) and throws immediately', async () => {
    const err = { isAxiosError: true, response: { status: 404 } } as any;
    const fn = jest.fn(() => Promise.reject(err));
    await expect(retry(fn, 3, 1)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('does NOT retry on a 400 (4xx) and throws immediately', async () => {
    const err = { isAxiosError: true, response: { status: 400 } } as any;
    const fn = jest.fn(() => Promise.reject(err));
    await expect(retry(fn, 3, 1)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on a 429 (retryable) and eventually throws after attempts', async () => {
    const err = { isAxiosError: true, response: { status: 429 } } as any;
    const fn = jest.fn(() => Promise.reject(err));
    await expect(retry(fn, 3, 1)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('retries on a network error (no response) and eventually throws', async () => {
    const err = new Error('network down');
    const fn = jest.fn(() => Promise.reject(err));
    await expect(retry(fn, 3, 1)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('retries a 500 (5xx) and succeeds on a later attempt', async () => {
    const serverErr = { isAxiosError: true, response: { status: 500 } } as any;
    let calls = 0;
    const fn = jest.fn(async () => {
      calls++;
      if (calls < 3) return Promise.reject(serverErr);
      return 'recovered';
    });
    await expect(retry(fn, 5, 1)).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

// ==================== cachedRequest / parsers ====================

describe('cachedRequest', () => {
  test('executes fn on first call and returns cached value on second', async () => {
    const fn = jest.fn(async () => ({ rate: 0.001 }));
    const first = await cachedRequest('req1', fn, 10_000);
    const second = await cachedRequest('req1', fn, 10_000);
    expect(first).toEqual({ rate: 0.001 });
    expect(second).toEqual({ rate: 0.001 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('different keys are cached independently', async () => {
    const fnA = jest.fn(async () => 'A');
    const fnB = jest.fn(async () => 'B');
    await cachedRequest('keyA', fnA);
    await cachedRequest('keyB', fnB);
    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenCalledTimes(1);
  });
});

describe('safeParseFloat / safeParseInt', () => {
  test('safeParseFloat parses valid numbers', () => {
    expect(safeParseFloat('1.5')).toBe(1.5);
    expect(safeParseFloat('  2.25  ')).toBe(2.25);
    expect(safeParseFloat(3.5)).toBe(3.5);
  });

  test('safeParseFloat falls back on invalid/empty input', () => {
    expect(safeParseFloat('abc')).toBe(0);
    expect(safeParseFloat('')).toBe(0);
    expect(safeParseFloat(null)).toBe(0);
    expect(safeParseFloat(undefined)).toBe(0);
    expect(safeParseFloat('x', 9)).toBe(9);
  });

  test('safeParseInt parses valid integers', () => {
    expect(safeParseInt('10')).toBe(10);
    expect(safeParseInt('  42  ')).toBe(42);
    expect(safeParseInt(7)).toBe(7);
  });

  test('safeParseInt falls back on invalid/empty input', () => {
    expect(safeParseInt('3.9')).toBe(3); // parseInt truncates
    expect(safeParseInt('abc')).toBe(0);
    expect(safeParseInt('')).toBe(0);
    expect(safeParseInt(null, 5)).toBe(5);
  });
});

// ==================== client pool ====================

describe('getOrCreateClient / createApiClient / cleanupConnections', () => {
  // Give each created client a unique object so the pool's per-key caching is
  // observable (the shared testkit client is a singleton otherwise).
  beforeAll(() => {
    (axios as any).create = jest.fn((cfg: any) => ({
      ...mockAxios.client,
      _baseURL: cfg?.baseURL,
      _timeout: cfg?.timeout,
    }));
  });

  test('returns the same axios instance for the same baseUrl:timeout key', () => {
    const a = getOrCreateClient('https://api.example.com', 5000);
    const b = getOrCreateClient('https://api.example.com', 5000);
    expect(a).toBe(b);
    expect((axios as any).create).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://api.example.com', timeout: 5000 })
    );
  });

  test('returns distinct instances for different keys', () => {
    const a = getOrCreateClient('https://api.example.com', 5000);
    const b = getOrCreateClient('https://api.example.com', 9000);
    const c = getOrCreateClient('https://other.com', 5000);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    // Each distinct key is matched to a distinct config (baseURL/timeout).
    expect((b as any)._timeout).toBe(9000);
    expect((c as any)._baseURL).toBe('https://other.com');
  });

  test('createApiClient is an alias for getOrCreateClient', () => {
    const a = createApiClient('https://alias.com', 1000);
    const b = getOrCreateClient('https://alias.com', 1000);
    expect(a).toBe(b);
  });

  test('cleanupConnections clears the client pool', () => {
    const before = getOrCreateClient('https://pool.com', 1000);
    cleanupConnections();
    const after = getOrCreateClient('https://pool.com', 1000);
    expect(before).not.toBe(after);
  });
});
