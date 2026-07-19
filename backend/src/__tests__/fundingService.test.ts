import { installMockAxios, prismaMock } from './testkit';

jest.mock('axios');
jest.mock('../services/prisma', () => ({
  prisma: prismaMock,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
}));
jest.mock('../utils/redis.js', () => ({ getRedis: () => null }));
jest.mock('../utils/logger.js');

import { getLiveFundingBatch } from '../services/fundingService.js';
import { cache } from '../utils/exchangeClient.js';

const axiosMock = installMockAxios();

describe('fundingService — getLiveFundingBatch', () => {
  beforeEach(() => {
    axiosMock.reset();
    cache.clear();
    jest.clearAllMocks();
  });

  it('returns an empty map for an unsupported exchange', async () => {
    const map = await getLiveFundingBatch('kraken', ['TESTCOINUSDT']);
    expect(map).toEqual({});
    expect(axiosMock.get).not.toHaveBeenCalled();
  });

  it('fetches and normalizes binance funding for multiple symbols', async () => {
    axiosMock.get.mockImplementation(async () => ({ data: { lastFundingRate: '0.0001', nextFundingTime: 1700000000000 } }));
    const map = await getLiveFundingBatch('binance', ['TESTCOINUSDT', 'ETHUSDT']);
    expect(Object.keys(map).sort()).toEqual(['ETHUSDT', 'TESTCOINUSDT']);
    expect(map.TESTCOINUSDT.rawRate).toBe(0.0001);
    expect(map.TESTCOINUSDT.ratePerHour).toBeCloseTo(0.0001 / 8);
    expect(map.TESTCOINUSDT.intervalHours).toBe(8);
    expect(map.ETHUSDT.rawRate).toBe(0.0001);
    expect(map.ETHUSDT.ratePerHour).toBeCloseTo(0.0001 / 8);
  });

  it('deduplicates symbols and caps at 50', async () => {
    axiosMock.get.mockImplementation(async () => ({ data: { lastFundingRate: '0.0001' } }));
    const symbols = Array.from({ length: 60 }, (_, i) => `S${i}USDT`);
    const map = await getLiveFundingBatch('binance', symbols);
    expect(Object.keys(map).length).toBe(50);
  });

  it('returns null per symbol when the rate cannot be parsed (num guard)', async () => {
    axiosMock.get.mockImplementation(async () => ({ data: { lastFundingRate: 'not-a-number' } }));
    const map = await getLiveFundingBatch('binance', ['TESTCOINUSDT']);
    expect(map).toEqual({});
  });

  it('returns an empty map when the exchange request throws', async () => {
    axiosMock.rejectGet(new Error('down'));
    const map = await getLiveFundingBatch('binance', ['TESTCOINUSDT']);
    expect(map).toEqual({});
  });

  it('normalizes OKX funding via instId lookup', async () => {
    axiosMock.get.mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('funding-rate')) return { data: { data: [{ fundingRate: '0.0003', fundingTime: '2024-01-01T00:00:00Z' }] } };
      return { data: {} };
    });
    const map = await getLiveFundingBatch('okx', ['BTC-USDT']);
    expect(map['BTC-USDT'].rawRate).toBe(0.0003);
    expect(map['BTC-USDT'].ratePerHour).toBeCloseTo(0.0003 / 8);
  });

  it('handles a hyperliquid (DEX, 1h interval) response', async () => {
    axiosMock.post.mockImplementation(async (_url: any, body: any) => {
      if (body?.type === 'metaAndAssetCtxs') {
        return {
          data: [
            { universe: [{ name: 'BTC' }] },
            [{ funding: '0.00001' }],
          ],
        };
      }
      if (body?.type === 'predictedFundings') return { data: [] };
      return { data: {} };
    });
    const map = await getLiveFundingBatch('hyperliquid', ['BTC']);
    expect(map.BTC.rawRate).toBe(0.00001);
    expect(map.BTC.intervalHours).toBe(1);
    expect(map.BTC.ratePerHour).toBeCloseTo(0.00001);
  });
});

// Every supported exchange must execute its fetchFunding branch without
// throwing, even when the upstream shape is unexpected. This exercises all the
// per-exchange branches in fundingService for coverage + resilience.
const EXCHANGES_TO_EXERCISE = [
  'binance', 'bybit', 'okx', 'gate', 'mexc', 'bitget', 'bingx', 'phemex',
  'woo', 'hyperliquid', 'dydx', 'paradex', 'htx', 'coinex', 'blofin',
  'bitmart', 'weex', 'coinw', 'drift', 'helix', 'apex', 'aster', 'bluefin',
];

describe('fundingService — every exchange branch executes without throwing', () => {
  it.each(EXCHANGES_TO_EXERCISE)('handles %s gracefully', async (exchange) => {
    axiosMock.get.mockImplementation(async () => ({ data: {} }));
    axiosMock.post.mockImplementation(async () => ({ data: {} }));
    await expect(getLiveFundingBatch(exchange, ['TESTCOINUSDT'])).resolves.toBeDefined();
  });

  it('bybit list-based fetch returns a normalized rate', async () => {
    cache.clear();
    axiosMock.get.mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('tickers?category=linear')) {
        return { data: { result: { list: [{ symbol: 'TESTCOINUSDT', fundingRate: '0.0002', fundingInterval: '480', nextFundingTime: '1700000000000' }] } } };
      }
      return { data: {} };
    });
    const map = await getLiveFundingBatch('bybit', ['TESTCOINUSDT']);
    expect(map.TESTCOINUSDT.rawRate).toBe(0.0002);
    expect(map.TESTCOINUSDT.intervalHours).toBe(8);
  });

  it('bitget dual-list fetch returns a normalized rate', async () => {
    cache.clear();
    axiosMock.get.mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('tickers')) return { data: { data: [{ symbol: 'TESTCOINUSDT', fundingRate: '0.0003' }] } };
      if (u.includes('contracts')) return { data: { data: [{ symbol: 'TESTCOINUSDT', fundInterval: '8' }] } };
      return { data: {} };
    });
    const map = await getLiveFundingBatch('bitget', ['TESTCOINUSDT']);
    expect(map.TESTCOINUSDT.rawRate).toBe(0.0003);
  });

  it('dydx indexer fetch returns a normalized rate', async () => {
    cache.clear();
    axiosMock.get.mockImplementation(async () => ({
      data: { markets: { 'TESTCOIN-USD': { nextFundingRate: '0.0004' } } },
    }));
    const map = await getLiveFundingBatch('dydx', ['TESTCOIN-USD']);
    expect(map['TESTCOIN-USD'].rawRate).toBe(0.0004);
    expect(map['TESTCOIN-USD'].intervalHours).toBe(1);
  });

  it('coinex list fetch returns a normalized rate', async () => {
    cache.clear();
    axiosMock.get.mockImplementation(async () => ({
      data: { data: [{ market: 'TESTCOINUSDT', latest_funding_rate: '0.0005', next_funding_time: '1700000000000' }] },
    }));
    const map = await getLiveFundingBatch('coinex', ['TESTCOINUSDT']);
    expect(map.TESTCOINUSDT.rawRate).toBe(0.0005);
  });
});
