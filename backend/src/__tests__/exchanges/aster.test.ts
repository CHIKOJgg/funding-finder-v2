jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanAster } from '../../exchanges/aster.js';

let mock: ReturnType<typeof installMockAxios>;

beforeEach(() => {
  mock = installMockAxios();
  cleanupConnections();
});

describe('scanAster', () => {
  it('returns normalized ExchangeResult[] for Aster', async () => {
    const now = Date.now();
    mock.routeGet({
      '/fapi/v1/premiumIndex': [
        { symbol: 'BTCUSDT', lastFundingRate: '0.0001', nextFundingTime: now + 3600000, markPrice: '50000' },
      ],
      '/fapi/v1/ticker/24hr': [
        { symbol: 'BTCUSDT', quoteVolume: '1000000', lastPrice: '50000' },
      ],
      '/fapi/v1/exchangeInfo': {
        symbols: [{ symbol: 'BTCUSDT', contractType: 'PERPETUAL', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT' }],
      },
    });

    const results = await scanAster();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'aster');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('BTCUSDT');
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on network failure (graceful degradation)', async () => {
    mock.rejectGet();
    const results = await scanAster();
    expect(results).toEqual([]);
  });
});
