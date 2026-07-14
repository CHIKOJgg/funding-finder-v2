jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanBingX } from '../../exchanges/bingx.js';

let mock: ReturnType<typeof installMockAxios>;

beforeEach(() => {
  mock = installMockAxios();
  cleanupConnections();
});

describe('scanBingX', () => {
  it('returns normalized ExchangeResult[] for BingX', async () => {
    const now = Date.now();
    mock.routeGet({
      '/openApi/swap/v2/quote/ticker': {
        data: [{ symbol: 'BTC-USDT', quoteVolume: '1000000', lastPrice: '50000' }],
      },
      '/openApi/swap/v2/quote/fundingRate': {
        data: [{ fundingRate: '0.0001', fundingTime: now + 3600000, markPrice: '50000' }],
      },
    });

    const results = await scanBingX();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'bingx');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('BTC-USDT');
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on network failure (graceful degradation)', async () => {
    mock.rejectGet();
    const results = await scanBingX();
    expect(results).toEqual([]);
  });
});
