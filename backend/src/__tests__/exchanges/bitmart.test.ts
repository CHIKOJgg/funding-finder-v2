jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanBitMart } from '../../exchanges/bitmart.js';

let mock: ReturnType<typeof installMockAxios>;

beforeEach(() => {
  mock = installMockAxios();
  cleanupConnections();
});

describe('scanBitMart', () => {
  it('returns normalized ExchangeResult[] for BitMart', async () => {
    const now = Date.now();
    mock.routeGet({
      '/v2/contract/public/symbols-list': {
        data: [{ symbol: 'BTCUSDT' }],
      },
      '/v2/contract/public/tickers': {
        data: [{ symbol: 'BTCUSDT', volume_24h: '1000000', last_price: '50000' }],
      },
      '/v2/contract/public/funding-rate': {
        data: { funding_rate: '0.0001', funding_time: now + 3600000 },
      },
    });

    const results = await scanBitMart();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'bitmart');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('BTCUSDT');
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on network failure (graceful degradation)', async () => {
    mock.rejectGet();
    const results = await scanBitMart();
    expect(results).toEqual([]);
  });
});
