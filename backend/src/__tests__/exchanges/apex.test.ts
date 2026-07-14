jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanApex } from '../../exchanges/apex.js';

let mock: ReturnType<typeof installMockAxios>;

beforeEach(() => {
  mock = installMockAxios();
  cleanupConnections();
});

describe('scanApex', () => {
  it('returns normalized ExchangeResult[] for ApeX', async () => {
    mock.routeGet({
      '/v3/symbols': {
        data: [{ symbol: 'BTCUSDT', contractType: 'PERPETUAL' }],
      },
      '/v3/ticker': {
        data: { fundingRate: '0.0001', markPrice: '50000', turnover24h: '5000000' },
      },
    });

    const results = await scanApex();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'apex');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('BTCUSDT');
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on network failure (graceful degradation)', async () => {
    mock.rejectGet();
    const results = await scanApex();
    expect(results).toEqual([]);
  });
});
