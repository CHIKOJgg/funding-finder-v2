jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanCoinEx } from '../../exchanges/coinex.js';

let mock: ReturnType<typeof installMockAxios>;

beforeEach(() => {
  mock = installMockAxios();
  cleanupConnections();
});

describe('scanCoinEx', () => {
  it('returns normalized ExchangeResult[] for CoinEx', async () => {
    const now = Date.now();
    mock.routeGet({
      '/futures/funding-rate': {
        data: [
          { market: 'BTCUSDT', latest_funding_rate: '0.0001', next_funding_time: now + 3600000, mark_price: '50000' },
        ],
      },
      '/futures/ticker': {
        data: [{ market: 'BTCUSDT', value: '1000000', last: '50000' }],
      },
      '/futures/market': {
        data: [{ market: 'BTCUSDT', contract_type: 'perpetual' }],
      },
    });

    const results = await scanCoinEx();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'coinex');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('BTCUSDT');
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on network failure (graceful degradation)', async () => {
    mock.rejectGet();
    const results = await scanCoinEx();
    expect(results).toEqual([]);
  });
});
