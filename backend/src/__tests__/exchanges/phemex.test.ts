jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanPhemex } from '../../exchanges/phemex.js';

let mock: ReturnType<typeof installMockAxios>;

beforeEach(() => {
  mock = installMockAxios();
  cleanupConnections();
});

describe('scanPhemex', () => {
  it('returns normalized ExchangeResult[] for Phemex', async () => {
    const now = Date.now();
    mock.routeGet({
      '/md/v3/ticker/24hr/all': {
        result: [{ symbol: 'BTCUSDT', turnoverRv: '5000000', markRp: '50000' }],
      },
      '/contract-biz/public/real-funding-rates': {
        data: {
          rows: [
            { fundingRate: '0.0001', nextfundingTime: now + 3600000, fundingInterval: 28800, fundingRateCap: '0.001', fundingRateFloor: '-0.001' },
          ],
        },
      },
    });

    const results = await scanPhemex();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'phemex');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('BTCUSDT');
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on network failure (graceful degradation)', async () => {
    mock.rejectGet();
    const results = await scanPhemex();
    expect(results).toEqual([]);
  });
});
