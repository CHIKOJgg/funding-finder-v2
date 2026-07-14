jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanOKX } from '../../exchanges/okx.js';

let mock: ReturnType<typeof installMockAxios>;

beforeEach(() => {
  mock = installMockAxios();
  cleanupConnections();
});

describe('scanOKX', () => {
  it('returns normalized ExchangeResult[] for OKX', async () => {
    const now = Date.now();
    mock.routeGet({
      '/api/v5/public/instruments': {
        data: [
          { instId: 'BTC-USDT-SWAP', settleCcy: 'USDT', baseCcy: 'BTC', quoteCcy: 'USDT', tickSz: '0.1', minSz: '0.01', lever: '100', state: 'live' },
        ],
      },
      '/api/v5/market/tickers': {
        data: [{ instId: 'BTC-USDT-SWAP', last: '50000', volCcy24h: '1000000' }],
      },
      '/api/v5/public/funding-rate': {
        data: [
          { fundingRate: '0.0001', fundingTime: new Date(now + 3600000).toISOString() },
        ],
      },
    });

    const results = await scanOKX();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'okx');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('BTC-USDT-SWAP');
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on network failure (graceful degradation)', async () => {
    mock.rejectGet();
    const results = await scanOKX();
    expect(results).toEqual([]);
  });
});
