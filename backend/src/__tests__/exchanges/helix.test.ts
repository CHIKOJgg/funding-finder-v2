jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanHelix } from '../../exchanges/helix.js';

let mock: ReturnType<typeof installMockAxios>;

beforeEach(() => {
  mock = installMockAxios();
  cleanupConnections();
});

describe('scanHelix', () => {
  it('returns normalized ExchangeResult[] for Helix', async () => {
    mock.routeGet({
      '/injective/exchange/v1beta1/derivative/markets': {
        markets: [
          {
            market: {
              ticker: 'BTC/USDT PERP',
              market_id: '0x123',
              status: 'active',
              is_perpetual: true,
              perpetual_market_info: { hourly_funding_rate_cap: '0.0001', hourly_interest_rate: '0.0001' },
            },
          },
        ],
      },
    });

    const results = await scanHelix();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'helix');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('BTC/USDT PERP');
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on network failure (graceful degradation)', async () => {
    mock.rejectGet();
    const results = await scanHelix();
    expect(results).toEqual([]);
  });
});
