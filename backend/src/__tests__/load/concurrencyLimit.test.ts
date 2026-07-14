import { mapWithConcurrency, cleanupConnections } from '../../utils/exchangeClient.js';

jest.mock('axios');
jest.mock('../../utils/logger.js');

describe('mapWithConcurrency under high load', () => {
  beforeEach(() => {
    jest.resetModules();
    cleanupConnections();
  });

  it('processes all 1000 items with concurrency 8 and never exceeds the cap', async () => {
    const total = 1000;
    const items = Array.from({ length: total }, (_, i) => i);

    let inFlight = 0;
    let maxInFlight = 0;

    const start = Date.now();
    const results = await mapWithConcurrency(
      items,
      { concurrency: 8, delayMs: 1 },
      async (x) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 0));
        inFlight--;
        return x * 2;
      }
    );
    const elapsed = Date.now() - start;

    expect(results.length).toBe(total);
    // Every slot is filled.
    expect(results.every((r: number | null) => r !== null)).toBe(true);
    // Concurrency cap must never be breached.
    expect(maxInFlight).toBeLessThanOrEqual(8);
    // With 8 in-flight and ~1ms delay per item, 1000 items must finish well
    // under a multi-second bound (sanity check it is actually parallelised).
    expect(elapsed).toBeLessThan(5000);
  });

  it('returns null for failed items and does not abort the whole batch', async () => {
    const items = Array.from({ length: 100 }, (_, i) => i);

    const results = await mapWithConcurrency(
      items,
      { concurrency: 4, delayMs: 0 },
      async (x) => {
        if (x % 10 === 0) throw new Error('boom');
        return x;
      }
    );

    expect(results.length).toBe(100);
    // The 10 failing items (0,10,...,90) become null, the rest are kept.
    const failed = results.filter((r: number | null) => r === null).length;
    expect(failed).toBe(10);
    expect(results[1]).toBe(1);
    expect(results[99]).toBe(99);
    expect(results[0]).toBeNull();
  });

  it('respects a higher concurrency setting', async () => {
    const items = Array.from({ length: 200 }, (_, i) => i);
    let maxInFlight = 0;
    let inFlight = 0;

    await mapWithConcurrency(items, { concurrency: 16, delayMs: 0 }, async (x) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 0));
      inFlight--;
      return x;
    });

    expect(maxInFlight).toBeLessThanOrEqual(16);
    expect(maxInFlight).toBeGreaterThan(1);
  });
});
