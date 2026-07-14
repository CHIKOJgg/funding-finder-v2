jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanGate } from '../../exchanges/gate.js';

let mock: ReturnType<typeof installMockAxios>;

beforeEach(() => {
  mock = installMockAxios();
  cleanupConnections();
});

describe('scanGate', () => {
  it('returns normalized ExchangeResult[] for Gate.io', async () => {
    const now = Date.now();
    mock.routeGet({
      '/futures/usdt/tickers': [
        { contract: 'BTCUSDT', volume_24h_settle: '5000000', mark_price: '50000', funding_rate: '0.0001', funding_next_apply: String(now + 3600000) },
      ],
      '/futures/usdt/contracts': {
        funding_rate: '0.0001',
        funding_next_apply: String(now + 3600000),
      },
      '/futures/usdt/funding_rate': [{ t: 1000 }, { t: 29801000 }],
    });

    const results = await scanGate();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'gate');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('BTCUSDT');
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on network failure (graceful degradation)', async () => {
    mock.rejectGet();
    const results = await scanGate();
    expect(results).toEqual([]);
  });
});
