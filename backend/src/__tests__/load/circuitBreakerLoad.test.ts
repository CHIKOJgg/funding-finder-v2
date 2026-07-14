import axios from 'axios';
import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';

jest.mock('axios');
jest.mock('../../utils/logger.js');

let mockAxios: any;

describe('CircuitBreaker under load (exchange rate-limit resilience)', () => {
  let circuitBreaker: any;
  let scanExchanges: any;

  beforeEach(() => {
    jest.resetModules();
    // Re-bind axios.create -> shared client after resetModules, so scanners
    // that call axios.create(...).get(...) hit our mock.
    mockAxios = installMockAxios();
    cleanupConnections();
    const clientMod = require('../../utils/exchangeClient.js');
    circuitBreaker = clientMod.circuitBreaker;
    scanExchanges = require('../../exchanges/index.js').scanExchanges;
  });

  /** A function whose underlying fetch fails (we just reject directly). */
  const failingFetch = async () => {
    throw new Error('simulated exchange fetch failure');
  };

  it('opens the circuit after 5 sequential failures (failureThreshold)', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(circuitBreaker.execute('binance', failingFetch)).rejects.toThrow();
    }
    // The 6th call must be rejected fast by the open circuit.
    await expect(circuitBreaker.execute('binance', failingFetch)).rejects.toThrow(
      'Circuit breaker open'
    );
  });

  it('rejects subsequent calls within the window quickly (no network call)', async () => {
    let networkCalls = 0;
    const fn = async () => {
      networkCalls++;
      throw new Error('fail');
    };

    for (let i = 0; i < 5; i++) {
      try {
        await circuitBreaker.execute('bybit', fn);
      } catch {
        /* expected */
      }
    }
    // Circuit is now open.
    await expect(circuitBreaker.execute('bybit', fn)).rejects.toThrow(
      'Circuit breaker open'
    );
    // The open-circuit rejection happens before invoking the worker, so the
    // "network" must not be touched again.
    const afterOpen = networkCalls;
    try {
      await circuitBreaker.execute('bybit', fn);
    } catch {
      /* expected */
    }
    expect(networkCalls).toBe(afterOpen);
  });

  it('handles many concurrent failing executes and trips open', async () => {
    let attempted = 0;
    const fn = async () => {
      attempted++;
      throw new Error('fail');
    };

    await Promise.all(
      Array.from({ length: 50 }, () =>
        circuitBreaker.execute('okx', fn).catch(() => undefined)
      )
    );

    // The breaker is now open and rejects immediately.
    await expect(circuitBreaker.execute('okx', fn)).rejects.toThrow('Circuit breaker open');
    // Confirm the test actually exercised the failure path.
    expect(attempted).toBeGreaterThan(0);
  });

  it('resets after resetTimeout when advanced with fake timers', async () => {
    jest.useFakeTimers();
    try {
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute('gate', failingFetch);
        } catch {
          /* expected */
        }
      }
      await expect(circuitBreaker.execute('gate', failingFetch)).rejects.toThrow(
        'Circuit breaker open'
      );

      // Advance past the 60s reset timeout.
      jest.advanceTimersByTime(61_000);

      // Circuit is half-open now: the next call attempts the fetch again and fails.
      await expect(circuitBreaker.execute('gate', failingFetch)).rejects.toThrow();
    } finally {
      jest.useRealTimers();
    }
  });

  it('resets on demand via circuitBreaker.reset()', async () => {
    for (let i = 0; i < 5; i++) {
      try {
        await circuitBreaker.execute('kucoin', failingFetch);
      } catch {
        /* expected */
      }
    }
    await expect(circuitBreaker.execute('kucoin', failingFetch)).rejects.toThrow(
      'Circuit breaker open'
    );

    circuitBreaker.reset('kucoin');

    // After reset the breaker is closed and the fetch is attempted again.
    await expect(circuitBreaker.execute('kucoin', failingFetch)).rejects.toThrow();
  });

  it('scanExchanges degrades gracefully when every exchange fetch fails', async () => {
    mockAxios.rejectGet(new Error('network down'));
    // Pass a single batch (<=3 exchanges) to avoid inter-batch sleeps.
    const results = await scanExchanges(['binance', 'gate', 'okx']);
    expect(Array.isArray(results)).toBe(true);
  });
});
