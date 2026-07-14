jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanBybit } from '../../exchanges/bybit.js';

let mock: ReturnType<typeof installMockAxios>;

beforeEach(() => {
  mock = installMockAxios();
  cleanupConnections();
});

describe('scanBybit', () => {
  it('returns normalized ExchangeResult[] for Bybit', async () => {
    const now = Date.now();
    const list = [
      {
        symbol: 'BTCUSDT',
        predictedFundingRate: '0.0001',
        fundingRate: '0.0001',
        nextFundingTime: String(now + 3600000),
        fundingInterval: '480',
        turnover24h: '5000000',
        markPrice: '50000',
      },
    ];
    mock.routeGet({
      '/v5/market/tickers': { retCode: 0, retMsg: 'OK', result: { list } },
    });

    const results = await scanBybit();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'bybit');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('BTCUSDT');
    expect(r!.funding_interval_source).toBe('api');
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on network failure (graceful degradation)', async () => {
    mock.rejectGet();
    const results = await scanBybit();
    expect(results).toEqual([]);
  });
});
