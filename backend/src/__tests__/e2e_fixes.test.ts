import { installMockAxios, prismaMock } from './testkit';

jest.mock('axios');
jest.mock('../services/prisma', () => ({
  prisma: prismaMock,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
}));
jest.mock('../utils/redis.js', () => ({ getRedis: () => null }));
jest.mock('../utils/logger.js');

import { scanCoinbase } from '../exchanges/coinbase.js';
import { scanBitunix } from '../exchanges/bitunix.js';
import { cache } from '../utils/exchangeClient.js';

const mockAxios = installMockAxios();

beforeEach(() => {
  mockAxios.reset();
  cache.clear();
  jest.clearAllMocks();
});

describe('Funding fixes — verified against real exchange behavior', () => {
  it('coinbase: 1h interval + predicted_funding used as decimal (no /100)', async () => {
    // Route by URL substring; `quote` MUST precede `/api/v1/instruments`
    // because the quote URL also contains that substring.
    mockAxios.routeGet({
      quote: { predicted_funding: '0.00001000', mark_price: '50000' },
      '/api/v1/instruments': [{ instrument: 'BTC-PERP', type: 'PERP', volume_24h: 100 }],
    });

    const results = await scanCoinbase();
    const btc = results.find((r) => r.contract === 'BTC-PERP');
    expect(btc).toBeDefined();
    // predicted_funding is ALREADY a per-hour decimal — must not be divided.
    expect(btc!.currentFunding).toBeCloseTo(0.00001, 12);
    // FIX: Coinbase International settles hourly (was incorrectly 8h).
    expect(btc!.funding_interval_hours).toBe(1);
    expect(btc!.funding_rate_per_hour).toBeCloseTo(0.00001, 12);
    expect(btc!.funding_rate_per_day).toBeCloseTo(0.00001 * 24, 12);
  });

  it('bitunix: percentage fundingRate converted to decimal (/100)', async () => {
    mockAxios.routeGet({
      funding_rate: { data: { fundingRate: '0.00588', fundingInterval: 8, nextFundingTime: 1700000000000 } },
      trading_pairs: { data: ['BTCUSDT'] },
      tickers: { data: [{ symbol: 'BTCUSDT', markPrice: '50000', volume: '100' }] },
    });

    const results = await scanBitunix();
    const btc = results.find((r) => r.contract === 'BTCUSDT');
    expect(btc).toBeDefined();
    // FIX: Bitunix reports PERCENT ("0.00588" == 0.00588% ≈ Binance 0.00005852).
    expect(btc!.currentFunding).toBeCloseTo(0.00588 / 100, 12);
    expect(btc!.funding_interval_hours).toBe(8);
    expect(btc!.funding_rate_per_hour).toBeCloseTo((0.00588 / 100) / 8, 12);
  });
});
