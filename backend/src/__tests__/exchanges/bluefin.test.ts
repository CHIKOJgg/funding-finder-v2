jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanBluefin } from '../../exchanges/bluefin.js';

let mock: ReturnType<typeof installMockAxios>;

beforeEach(() => {
  mock = installMockAxios();
  cleanupConnections();
});

describe('scanBluefin', () => {
  it('returns normalized ExchangeResult[] for Bluefin', async () => {
    const now = Date.now();
    mock.routeGet({
      '/exchange/info': {
        data: { markets: [{ symbol: 'BTC-PERP' }] },
      },
      '/exchange/tickers': {
        data: [
          { symbol: 'BTC-PERP', lastFundingRateE9: '100000', markPriceE9: '50000000000', quoteVolume24hrE9: '1000000000', nextFundingTimeAtMillis: now + 3600000 },
        ],
      },
    });

    const results = await scanBluefin();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'bluefin');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('BTC-PERP');
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on network failure (graceful degradation)', async () => {
    mock.rejectGet();
    const results = await scanBluefin();
    expect(results).toEqual([]);
  });
});
