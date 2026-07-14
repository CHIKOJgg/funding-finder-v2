jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanDydx } from '../../exchanges/dydx.js';

let mock: ReturnType<typeof installMockAxios>;

beforeEach(() => {
  mock = installMockAxios();
  cleanupConnections();
});

describe('scanDydx', () => {
  it('returns normalized ExchangeResult[] for dYdX', async () => {
    mock.routeGet({
      '/v4/perpetualMarkets': {
        markets: {
          'BTC-USD': { status: 'ACTIVE', nextFundingRate: '0.0001', oraclePrice: '50000', volume24H: '1000000' },
        },
      },
    });

    const results = await scanDydx();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'dydx');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('BTC-USD');
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on network failure (graceful degradation)', async () => {
    mock.rejectGet();
    const results = await scanDydx();
    expect(results).toEqual([]);
  });
});
