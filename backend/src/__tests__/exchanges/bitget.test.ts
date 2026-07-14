jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanBitget } from '../../exchanges/bitget.js';

let mock: ReturnType<typeof installMockAxios>;

beforeEach(() => {
  mock = installMockAxios();
  cleanupConnections();
});

describe('scanBitget', () => {
  it('returns normalized ExchangeResult[] for Bitget', async () => {
    mock.routeGet({
      '/api/v2/mix/market/tickers': {
        data: [
          { symbol: 'BTCUSDT', fundingRate: '0.0001', markPrice: '50000', usdtVolume: '5000000' },
        ],
      },
      '/api/v2/mix/market/contracts': {
        data: [{ symbol: 'BTCUSDT', fundInterval: '8' }],
      },
    });

    const results = await scanBitget();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'bitget');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('BTCUSDT');
    expect(r!.funding_interval_source).toBe('api');
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on network failure (graceful degradation)', async () => {
    mock.rejectGet();
    const results = await scanBitget();
    expect(results).toEqual([]);
  });
});
