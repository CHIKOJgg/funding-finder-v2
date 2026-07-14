jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanBinance } from '../../exchanges/binance.js';

let mock: ReturnType<typeof installMockAxios>;

beforeEach(() => {
  mock = installMockAxios();
  cleanupConnections();
});

describe('scanBinance', () => {
  it('returns normalized ExchangeResult[] for Binance', async () => {
    const now = Date.now();
    mock.routeGet({
      '/fapi/v1/ticker/24hr': [
        { symbol: 'BTCUSDT', quoteVolume: '1000000', lastPrice: '50000', volume: '20' },
      ],
      '/fapi/v1/exchangeInfo': {
        symbols: [
          { symbol: 'BTCUSDT', marginAsset: 'USDT', baseAsset: 'BTC', quoteAsset: 'USDT', filters: [] },
        ],
      },
      '/fapi/v1/premiumIndex': [
        { symbol: 'BTCUSDT', lastFundingRate: '0.0001', nextFundingTime: String(now + 3600000) },
      ],
    });

    const results = await scanBinance();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'binance');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('BTCUSDT');
    expect(r!.funding_interval_seconds).toBe(28800);
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on network failure (graceful degradation)', async () => {
    mock.rejectGet();
    const results = await scanBinance();
    expect(results).toEqual([]);
  });
});
