jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanCoinW } from '../../exchanges/coinw.js';

let mock: ReturnType<typeof installMockAxios>;

beforeEach(() => {
  mock = installMockAxios();
  cleanupConnections();
});

describe('scanCoinW', () => {
  it('returns normalized ExchangeResult[] for CoinW', async () => {
    const now = Date.now();
    mock.routeGet({
      '/api/v2/futures/public/symbols': {
        data: [{ symbol: 'BTCUSDT' }],
      },
      '/api/v2/futures/public/funding-rate': {
        data: { funding_rate: '0.0001', funding_time: now + 3600000, next_funding_time: now + 3600000, mark_price: '50000' },
      },
      '/api/v2/futures/public/ticker': {
        data: { mark_price: '50000', last_price: '50000', quote_volume: '1000000', volume_24h: '1000' },
      },
    });

    const results = await scanCoinW();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'coinw');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('BTCUSDT');
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on network failure (graceful degradation)', async () => {
    mock.rejectGet();
    const results = await scanCoinW();
    expect(results).toEqual([]);
  });
});
