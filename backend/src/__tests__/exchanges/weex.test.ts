jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanWeex } from '../../exchanges/weex.js';

let mock: ReturnType<typeof installMockAxios>;

beforeEach(() => {
  mock = installMockAxios();
  cleanupConnections();
});

describe('scanWeex', () => {
  it('returns normalized ExchangeResult[] for WEEX', async () => {
    const now = Date.now();
    mock.routeGet({
      '/api/v1/futures/public/symbols': {
        data: [{ symbol: 'BTCUSDT' }],
      },
      '/api/v1/futures/public/funding-rate': {
        data: { funding_rate: '0.0001', funding_time: now + 3600000, mark_price: '50000' },
      },
      '/api/v1/futures/public/ticker': {
        data: { last_price: '50000', volume_24h: '1000', turnover_24h: '1000000' },
      },
    });

    const results = await scanWeex();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'weex');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('BTCUSDT');
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on network failure (graceful degradation)', async () => {
    mock.rejectGet();
    const results = await scanWeex();
    expect(results).toEqual([]);
  });
});
