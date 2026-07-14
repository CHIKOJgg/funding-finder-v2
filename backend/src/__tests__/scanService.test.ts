import { prismaMock } from './testkit';
import { scanExchanges } from '../exchanges/index.js';
import type { ExchangeResult, ScanResult } from '../types/index.js';

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

import { processScanResults, runScan, scanCacheKey } from '../services/scanService.js';
import { cache } from '../utils/exchangeClient.js';

function mk(partial: Partial<ExchangeResult> & Pick<ExchangeResult, 'exchange' | 'contract' | 'funding_rate_per_hour'>): ExchangeResult {
  return {
    currentFunding: partial.funding_rate_per_hour,
    funding_interval_seconds: 28800,
    funding_interval_hours: 8,
    funding_interval_source: 'default',
    funding_rate_per_day: partial.funding_rate_per_hour * 3,
    annualized_rate: partial.funding_rate_per_hour * 3 * 365,
    funding_next_apply: 0,
    time_until_next_funding_seconds: 0,
    mark_price: 60000,
    volume_24h_settle: 10_000_000,
    med_seconds: 28800,
    med_hours: 8,
    ...partial,
  } as ExchangeResult;
}

describe('scanService — processScanResults', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTx.mockImplementation((arg: any) => (typeof arg === 'function' ? arg(prismaMock) : Promise.resolve(arg)));
    cache.clear();
  });

  it('groups results into high / medium yield by normalized hourly rate', async () => {
    // One high-rate contract + three medium-rate contracts. The dynamic minimum
    // is 30% of the median hourly rate, so the mediums (0.00004-0.00005) stay
    // above threshold while the lone high (0.0002) is categorized as high.
    const res = await processScanResults([
      mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0002, volume_24h_settle: 50_000_000 }),
      mk({ exchange: 'okx', contract: 'BTC-USDT-SWAP', funding_rate_per_hour: 0.00004, volume_24h_settle: 20_000_000 }),
      mk({ exchange: 'bybit', contract: 'ETHUSDT', funding_rate_per_hour: 0.00005, volume_24h_settle: 10_000_000 }),
      mk({ exchange: 'gate', contract: 'SOL_USDT', funding_rate_per_hour: 0.00005, volume_24h_settle: 8_000_000 }),
    ]);

    expect(res.highYield.map((x) => x.exchange)).toEqual(['binance']);
    expect(res.mediumYield.map((x) => x.exchange).sort()).toEqual(['bybit', 'gate', 'okx']);
    expect(res.lowYield).toHaveLength(0);
    expect(res.metrics.totalOpportunities).toBe(4);
    expect(res.metrics.exchanges.sort()).toEqual(['binance', 'bybit', 'gate', 'okx']);
  });

  it('categorizes only-low-rate results into the low bucket', async () => {
    const res = await processScanResults([
      mk({ exchange: 'gate', contract: 'SOL_USDT', funding_rate_per_hour: 0.000002, volume_24h_settle: 5_000_000 }),
      mk({ exchange: 'okx', contract: 'ADA-USDT-SWAP', funding_rate_per_hour: 0.000003, volume_24h_settle: 5_000_000 }),
      mk({ exchange: 'binance', contract: 'DOGEUSDT', funding_rate_per_hour: 0.000004, volume_24h_settle: 5_000_000 }),
    ]);
    expect(res.highYield).toHaveLength(0);
    expect(res.mediumYield).toHaveLength(0);
    expect(res.lowYield).toHaveLength(3);
    expect(res.metrics.totalOpportunities).toBe(3);
  });

  it('drops invalid / low-volume records', async () => {
    const res = await processScanResults([
      mk({ exchange: 'binance', contract: 'DOGEUSDT', funding_rate_per_hour: 0.0003, volume_24h_settle: 500 }), // low volume (filtered at categorization, still counted as scanned)
      mk({ exchange: 'bybit', contract: 'ETHUSDT', funding_rate_per_hour: NaN, volume_24h_settle: 10_000_000 }), // NaN -> cleaned out
      // @ts-expect-error intentionally malformed
      mk({ exchange: 'gate', contract: 'X', currentFunding: undefined, funding_rate_per_hour: undefined }),
    ]);
    // Only the finite-funding, well-formed record survives cleaning.
    expect(res.scanned).toBe(1);
    expect(res.highYield.length + res.mediumYield.length + res.lowYield.length).toBe(0);
  });

  it('computes interval distribution and average interval metrics', async () => {
    const res = await processScanResults([
      mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0002, funding_interval_hours: 8 }),
      mk({ exchange: 'okx', contract: 'BTC-USDT-SWAP', funding_rate_per_hour: 0.0003, funding_interval_hours: 4 }),
    ]);
    expect(res.metrics.intervalDistribution['8h']).toBe(1);
    expect(res.metrics.intervalDistribution['4h']).toBe(1);
    expect(res.metrics.averageIntervalHours).toBeCloseTo(6, 5);
  });

  it('saves history in the background (best-effort, no throw on failure)', async () => {
    mockTx.mockRejectedValue(new Error('db down'));
    await expect(
      processScanResults([
        mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0002, volume_24h_settle: 50_000_000 }),
      ])
    ).resolves.toBeDefined();
    // Restore for other tests.
    mockTx.mockImplementation((arg: any) => (typeof arg === 'function' ? arg(prismaMock) : Promise.resolve(arg)));
  });
});

describe('scanService — runScan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cache.clear();
  });

  it('performs a live scan when the cache is empty and caches the result', async () => {
    (scanExchanges as jest.Mock).mockResolvedValue([
      mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0002, volume_24h_settle: 50_000_000 }),
    ]);
    const res = await runScan(['binance']);
    expect(scanExchanges).toHaveBeenCalledWith(['binance']);
    expect(res.scanned).toBe(1);
    expect(res.highYield).toHaveLength(1);

    // Second call is served from cache (scanExchanges not hit again).
    await runScan(['binance']);
    expect(scanExchanges).toHaveBeenCalledTimes(1);
  });

  it('builds a stable cache key from the sorted exchange list', () => {
    expect(scanCacheKey(['bybit', 'binance'])).toBe(scanCacheKey(['binance', 'bybit']));
  });

  it('returns empty scan when exchanges return nothing', async () => {
    (scanExchanges as jest.Mock).mockResolvedValue([]);
    const res: ScanResult = await runScan(['okx']);
    expect(res.scanned).toBe(0);
    expect(res.metrics.totalOpportunities).toBe(0);
  });
});
