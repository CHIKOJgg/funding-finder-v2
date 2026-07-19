const prismaMock = require('./testkit').prismaMock;
const mockTx = jest.fn();

jest.mock('../services/prisma', () => ({
  prisma: new Proxy(prismaMock, {
    get(target, prop) {
      if (prop === '$transaction') return mockTx;
      if (prop === '$queryRaw' || prop === '$queryRawUnsafe' || prop === '$executeRaw') return jest.fn();
      return (target as any)[prop];
    },
  }),
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
}));

jest.mock('../exchanges/index.js', () => ({
  scanExchanges: jest.fn(),
  SUPPORTED_EXCHANGES: ['binance', 'bybit', 'okx', 'gate'],
  scanSingleExchange: jest.fn(),
  getSupportedExchanges: jest.fn(),
  cleanup: jest.fn(),
}));

jest.mock('../utils/logger.js');

// We re-import the module under test fresh in every test so the module-level
// `inFlightScans` map and the shared `cache` start clean (these are singletons
// that otherwise leak state across tests and cause hangs).
function loadModule() {
  jest.resetModules();
  const scan = require('../services/scanService.js');
  const { cache } = require('../utils/exchangeClient.js');
  const { scanExchanges } = require('../exchanges/index.js');
  cache.clear();
  return { scan, cache, scanExchanges };
}

function mk(partial: any): any {
  return {
    currentFunding: partial.funding_rate_per_hour,
    funding_interval_seconds: 28800,
    funding_interval_hours: 8,
    funding_interval_source: 'default',
    funding_rate_per_hour: partial.funding_rate_per_hour,
    funding_rate_per_day: partial.funding_rate_per_hour * 3,
    annualized_rate: partial.funding_rate_per_hour * 3 * 365,
    funding_next_apply: 0,
    time_until_next_funding_seconds: 0,
    mark_price: 60000,
    volume_24h_settle: 10_000_000,
    med_seconds: 28800,
    med_hours: 8,
    ...partial,
  };
}

describe('scanService — getCachedScan superset matching', () => {
  it('reuses a cached scan that covers a requested superset of exchanges', () => {
    const { scan, cache } = loadModule();
    const wide = [mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0002, volume_24h_settle: 50_000_000 })] as any;
    cache.set(scan.scanCacheKey(['binance', 'bybit', 'okx', 'gate']), { result: { scanned: 1, highYield: wide } as any, ts: Date.now() }, 60_000);

    const hit = scan.getCachedScan(['binance', 'okx']);
    expect(hit).not.toBeNull();
    expect(hit!.result.scanned).toBe(1);
  });

  it('returns null when no cached scan covers the request', () => {
    const { scan, cache } = loadModule();
    cache.set(scan.scanCacheKey(['binance']), { result: { scanned: 1 } as any, ts: Date.now() }, 60_000);
    expect(scan.getCachedScan(['okx'])).toBeNull();
  });

  it('returns null on a totally empty cache', () => {
    const { scan } = loadModule();
    expect(scan.getCachedScan(['binance'])).toBeNull();
  });
});

describe('scanService — runScan coalescing & refresh', () => {
  it('performs a live scan when the cache is empty and caches the result', async () => {
    const { scan, cache, scanExchanges } = loadModule();
    scanExchanges.mockResolvedValue([mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0002, volume_24h_settle: 50_000_000 })]);
    const res = await scan.runScan(['binance']);
    expect(scanExchanges).toHaveBeenCalledWith(['binance']);
    expect(res.scanned).toBe(1);

    await scan.runScan(['binance']);
    expect(scanExchanges).toHaveBeenCalledTimes(1);
    expect(cache.size).toBeGreaterThanOrEqual(1);
  });

  it('builds a stable cache key from the sorted exchange list', () => {
    const { scan } = loadModule();
    expect(scan.scanCacheKey(['bybit', 'binance'])).toBe(scan.scanCacheKey(['binance', 'bybit']));
  });

  it('returns empty scan when exchanges return nothing', async () => {
    const { scan } = loadModule();
    const { scanExchanges } = require('../exchanges/index.js');
    scanExchanges.mockResolvedValue([]);
    const res = await scan.runScan(['okx']);
    expect(res.scanned).toBe(0);
  });

  it('coalesces concurrent subset callers onto an in-flight superset scan', async () => {
    const { scan, scanExchanges } = loadModule();
    let resolveScan: (v: any[]) => void = () => {};
    scanExchanges.mockReturnValue(new Promise<any[]>((res) => { resolveScan = res; }));

    const widePromise = scan.runScan(['binance', 'bybit', 'okx', 'gate']);
    const subsetPromise = scan.runScan(['binance', 'okx']);

    resolveScan([mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0002, volume_24h_settle: 50_000_000 })]);

    const [wide, subset] = await Promise.all([widePromise, subsetPromise]);
    expect(wide).toBe(subset);
    expect(scanExchanges).toHaveBeenCalledTimes(1);
  });

  it('only runs ONE live scan for concurrent identical requests', async () => {
    const { scan, scanExchanges } = loadModule();
    scanExchanges.mockResolvedValue([mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0002, volume_24h_settle: 50_000_000 })]);
    const [a, b, c] = await Promise.all([scan.runScan(['okx']), scan.runScan(['okx']), scan.runScan(['okx'])]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(scanExchanges).toHaveBeenCalledTimes(1);
  });

  it('triggers a background refresh once the entry ages past SCAN_REFRESH_AFTER_MS', async () => {
    jest.useFakeTimers();
    try {
      const { scan, scanExchanges } = loadModule();
      scanExchanges.mockResolvedValue([mk({ exchange: 'gate', contract: 'X', funding_rate_per_hour: 0.0002, volume_24h_settle: 50_000_000 })]);
      await scan.runScan(['gate']);
      expect(scanExchanges).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(61_000);
      const res = await scan.runScan(['gate']);
      expect(res.scanned).toBe(1);
      // Allow the background refresh promise (and its nested timers) to flush.
      await jest.runAllTimersAsync();
      expect(scanExchanges).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not crash the caller when a live scan rejects (re-throws)', async () => {
    const { scan, scanExchanges } = loadModule();
    scanExchanges.mockRejectedValue(new Error('exchange down'));
    await expect(scan.runScan(['binance'])).rejects.toThrow('exchange down');
  });

  it('scanDebug exposes in-flight and cache introspection', async () => {
    const { scan, scanExchanges } = loadModule();
    scanExchanges.mockResolvedValue([mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0002, volume_24h_settle: 50_000_000 })]);
    await scan.runScan(['binance']);
    const d = scan.scanDebug();
    expect(d.cacheKeys).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(d.inFlight)).toBe(true);
  });
});
