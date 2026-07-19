import { getLivePriceBatch } from '../services/priceService.js';
import { cleanupConnections } from '../utils/exchangeClient.js';

// Mock axios so no real network calls happen during unit tests.
jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('priceService', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    mockedAxios.post.mockReset();
    // The price cache is a module-level singleton; clear it so tests are isolated.
    cleanupConnections();
  });

  it('fetches a single price and returns it keyed by the requested symbol', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: { price: '62530.5' } } as any);
    const res = await getLivePriceBatch('binance', ['BTC/USDT']);
    expect(res['BTC/USDT']).toBeCloseTo(62530.5, 1);
  });

  it('returns an empty map (not throw) when the exchange is unsupported', async () => {
    const res = await getLivePriceBatch('unknown-exchange', ['BTC/USDT']);
    expect(res).toEqual({});
  });

  it('returns an empty map when the price fetch fails (keeps card valid via fallback)', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('network down'));
    const res = await getLivePriceBatch('binance', ['FAILCOIN/USDT']);
    expect(res).toEqual({});
  });

  it('builds the correct native symbol per exchange (covers all families)', async () => {
    const cases: [string, string, string][] = [
      ['binance', 'BTC/USDT', 'fapi.binance.com'],
      ['bybit', 'BTC/USDT', 'api.bybit.com'],
      ['okx', 'BTC/USDT', 'okx.com'],
      ['gate', 'BTC/USDT', 'gateio.ws'],
      ['mexc', 'BTC/USDT', 'contract.mexc.com'],
      ['bitget', 'BTC/USDT', 'api.bitget.com'],
      ['bingx', 'BTC/USDT', 'bingx.com'],
      ['bitmart', 'BTC/USDT', 'bitmart.com'],
      ['blofin', 'BTC/USDT', 'blofin.com'],
      ['bluefin', 'BTC/USDT', 'bluefin.io'],
      ['drift', 'BTC/USDT', 'drift.trade'],
      ['dydx', 'BTC/USDT', 'dydx.trade'],
      ['helix', 'BTC/USDT', 'injective.network'],
      ['htx', 'BTC/USDT', 'hbdm.com'],
      ['hyperliquid', 'BTC/USDT', 'hyperliquid.xyz'],
      ['paradex', 'BTC/USDT', 'paradex.io'],
      ['phemex', 'BTC/USDT', 'phemex.com'],
      ['weex', 'BTC/USDT', 'weex.com'],
      ['woo', 'BTC/USDT', 'woox.io'],
      ['apex', 'BTC/USDT', 'apex.exchange'],
      ['aster', 'BTC/USDT', 'asterdex.com'],
      ['coinw', 'BTC/USDT', 'coinw.com'],
      ['coinex', 'BTC/USDT', 'coinex.com'],
    ];

    // Per-exchange response shapes, exactly what each parser reads.
    const shapes: Record<string, any> = {
      'fapi.binance.com': { price: '1' },
      'api.bybit.com': { result: { list: [{ lastPrice: '1' }] } },
      'okx.com': { data: [{ last: '1' }] },
      'gateio.ws': { mark_price: '1' },
      'contract.mexc.com': { data: { lastPrice: '1' } },
      'api.bitget.com': { data: { data: [{ symbol: 'BTCUSDT', markPrice: '1' }] } },
      'bingx.com': { data: { data: [{ symbol: 'BTC-USDT', lastPrice: '1' }] } },
      'bitmart.com': { data: { data: [{ symbol: 'BTCUSDT', last_price: '1' }] } },
      'blofin.com': { data: [{ instId: 'BTC-USDT', last: '1' }] },
      'bluefin.io': { data: { data: [{ symbol: 'BTC-PERP', markPriceE9: '1000000000' }] } },
      'drift.trade': [{ symbol: 'BTC-PERP', markPrice: '1' }],
      'dydx.trade': { markets: { 'BTC-USD': { oraclePrice: '1' } } },
      'injective.network': { data: [{ marketId: 'btcusdt-perp', markPrice: '1' }] },
      'hbdm.com': { data: [{ contract_code: 'BTC-USDT', last_price: '1' }] },
      'hyperliquid.xyz': [{ universe: [{ name: 'BTC' }] }, [{ markPx: '1' }]],
      'paradex.io': [{ symbol: 'BTC-USD-PERP', mark_price: '1' }],
      'phemex.com': { result: [{ symbol: 'BTCUSDT', markRp: '1' }] },
      'weex.com': { data: { last_price: '1' } },
      'woox.io': { rows: [{ symbol: 'PERP_BTC_USDT', mark_price: '1' }] },
      'apex.exchange': { data: [{ markPrice: '1' }] },
      'asterdex.com': { data: [{ symbol: 'BTCUSDT', lastPrice: '1' }] },
      'coinw.com': { data: { last_price: '1' } },
      'coinex.com': { data: [{ market: 'BTCUSDT', last: '1' }] },
    };

    for (const [exchange, pair, urlPart] of cases) {
      // Clear call history so the URL assertion reflects only this iteration.
      mockedAxios.get.mockClear();
      mockedAxios.post.mockClear();
      mockedAxios.get.mockImplementation(async (url: any) => {
        return { status: 200, data: shapes[urlPart] } as any;
      });
      mockedAxios.post.mockImplementation(async (url: any) => {
        return { status: 200, data: shapes[urlPart] } as any;
      });
      const res = await getLivePriceBatch(exchange, [pair]);
      expect(Object.keys(res)).toContain(pair);
      expect(typeof res[pair]).toBe('number');
      const lastGet = mockedAxios.get.mock.calls.at(-1);
      const lastPost = mockedAxios.post.mock.calls.at(-1);
      const calledUrl = String((lastPost ?? lastGet)?.[0] ?? '');
      expect(calledUrl).toContain(urlPart);
    }
  });

  it('deduplicates symbols and caps at 50', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: { price: '1' } } as any);
    const many = Array.from({ length: 60 }, (_, i) => `COIN${i}/USDT`);
    const res = await getLivePriceBatch('binance', many);
    expect(mockedAxios.get.mock.calls.length).toBeLessThanOrEqual(50);
    expect(Object.keys(res).length).toBeLessThanOrEqual(50);
  });
});
