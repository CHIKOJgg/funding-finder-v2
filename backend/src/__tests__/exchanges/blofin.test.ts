jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanBloFin } from '../../exchanges/blofin.js';

let mock: ReturnType<typeof installMockAxios>;

beforeEach(() => {
  mock = installMockAxios();
  cleanupConnections();
});

describe('scanBloFin', () => {
  it('returns normalized ExchangeResult[] for BloFin', async () => {
    const now = Date.now();
    mock.routeGet({
      '/api/v1/market/instruments': {
        data: [
          { instId: 'BTC-USDT', instType: 'SWAP', settleCurrency: 'USDT', state: 'live' },
        ],
      },
      '/api/v1/market/funding-rate': {
        data: [{ fundingRate: '0.0001', fundingTime: now + 3600000 }],
      },
      '/api/v1/market/mark-price': {
        data: [{ markPrice: '50000' }],
      },
      '/api/v1/market/tickers': {
        data: [{ volCurrency24h: '1000' }],
      },
    });

    const results = await scanBloFin();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'blofin');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('BTC-USDT');
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on network failure (graceful degradation)', async () => {
    mock.rejectGet();
    const results = await scanBloFin();
    expect(results).toEqual([]);
  });
});
