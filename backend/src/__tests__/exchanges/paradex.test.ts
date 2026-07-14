jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanParadex } from '../../exchanges/paradex.js';

let mock: ReturnType<typeof installMockAxios>;

beforeEach(() => {
  mock = installMockAxios();
  cleanupConnections();
});

describe('scanParadex', () => {
  it('returns normalized ExchangeResult[] for Paradex', async () => {
    mock.routeGet({
      '/v1/markets': [
        {
          symbol: 'ETH-USD-PERP',
          status: 'ACTIVE',
          funding_rate: '0.0001',
          mark_price: '3000',
          volume_24h: '1000000',
          funding_interval: 3600,
          next_funding_time: new Date(Date.now() + 3600000).toISOString(),
        },
      ],
    });

    const results = await scanParadex();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'paradex');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('ETH-USD-PERP');
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on network failure (graceful degradation)', async () => {
    mock.rejectGet();
    const results = await scanParadex();
    expect(results).toEqual([]);
  });
});
