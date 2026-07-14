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
    const now = Date.now();
    mock.routeGet({
      '/perpetual-markets': {
        data: [
          { marketId: 'btcusdt-perp', fundingRate: '0.0001', markPrice: '50000', oraclePrice: '50000', volume24h: '1000', nextFundingTimestamp: now + 3600000 },
        ],
      },
    });

    const results = await scanHelix();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'helix');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('btcusdt-perp');
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on network failure (graceful degradation)', async () => {
    mock.rejectGet();
    const results = await scanHelix();
    expect(results).toEqual([]);
  });
});
