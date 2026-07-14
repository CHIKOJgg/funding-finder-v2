jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanMEXC } from '../../exchanges/mexc.js';

let mock: ReturnType<typeof installMockAxios>;

beforeEach(() => {
  mock = installMockAxios();
  cleanupConnections();
});

describe('scanMEXC', () => {
  it('returns normalized ExchangeResult[] for MEXC', async () => {
    const now = Date.now();
    mock.routeGet({
      '/api/v1/contract/detail': {
        data: [
          { symbol: 'BTCUSDT', settleCoin: 'USDT', baseCoin: 'BTC', quoteCoin: 'USDT', maxLeverage: '100' },
        ],
      },
      '/api/v1/contract/funding_rate': {
        data: { fundingRate: '0.0001', nextSettleTime: now + 3600000 },
      },
      '/api/v1/contract/ticker': {
        data: { fairPrice: '50000', lastPrice: '50000', volume24: '1000000' },
      },
    });

    const results = await scanMEXC();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'mexc');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('BTCUSDT');
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on network failure (graceful degradation)', async () => {
    mock.rejectGet();
    const results = await scanMEXC();
    expect(results).toEqual([]);
  });
});
