jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanDrift } from '../../exchanges/drift.js';

let mock: ReturnType<typeof installMockAxios>;

beforeEach(() => {
  mock = installMockAxios();
  cleanupConnections();
});

describe('scanDrift', () => {
  it('returns normalized ExchangeResult[] for Drift', async () => {
    const now = Date.now();
    mock.routeGet({
      '/markets': [
        {
          symbol: 'SOL-PERP',
          fundingRate: '0.0001',
          markPrice: '100',
          oraclePrice: '100',
          volume24h: '500000',
          nextFundingTimestamp: now + 3600000,
        },
      ],
    });

    const results = await scanDrift();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'drift');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('SOL-PERP');
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on network failure (graceful degradation)', async () => {
    mock.rejectGet();
    const results = await scanDrift();
    expect(results).toEqual([]);
  });
});
