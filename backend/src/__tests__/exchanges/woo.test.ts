jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanWOO } from '../../exchanges/woo.js';

let mock: ReturnType<typeof installMockAxios>;

beforeEach(() => {
  mock = installMockAxios();
  cleanupConnections();
});

describe('scanWOO', () => {
  it('returns normalized ExchangeResult[] for WOO X', async () => {
    const now = Date.now();
    mock.routeGet({
      '/v1/public/futures': {
        rows: [{ symbol: 'PERP_BTC_USDT', '24h_volume': '5000000', mark_price: '50000' }],
      },
      '/v1/public/funding_rates': {
        rows: [
          { symbol: 'PERP_BTC_USDT', last_funding_rate: '0.0001', next_funding_time: now + 3600000, last_funding_rate_interval: '8' },
        ],
      },
    });

    const results = await scanWOO();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'woo');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('PERP_BTC_USDT');
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on network failure (graceful degradation)', async () => {
    mock.rejectGet();
    const results = await scanWOO();
    expect(results).toEqual([]);
  });
});
