import { installMockAxios, prismaMock } from './testkit';

jest.mock('axios');
jest.mock('../services/prisma', () => ({
  prisma: prismaMock,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
}));

import { getSpotFutures, SF_SUPPORTED_EXCHANGES } from '../services/spotFuturesService.js';
import { cache } from '../utils/exchangeClient.js';

const axiosMock = installMockAxios();

describe('spotFuturesService', () => {
  beforeEach(() => {
    axiosMock.reset();
    cache.clear();
    jest.clearAllMocks();
  });

  it('reports unsupported exchanges as not supported without hitting the network', async () => {
    const res = await getSpotFutures('kraken', 'BTCUSDT');
    expect(res.supported).toBe(false);
    expect(res.spotPrice).toBeNull();
    expect(axiosMock.get).not.toHaveBeenCalled();
  });

  it('computes basis, funding APY and net APY for a supported exchange', async () => {
    axiosMock.routeGet({
      'premiumIndex': { markPrice: '60050', lastFundingRate: '0.0001' },
      'ticker/price': { price: '60000' },
    });

    const res = await getSpotFutures('binance', 'BTCUSDT');
    expect(res.supported).toBe(true);
    expect(res.exchange).toBe('binance');
    expect(res.spotPrice).toBe(60000);
    expect(res.perpMark).toBe(60050);
    expect(res.basisPct).toBeCloseTo(((60050 - 60000) / 60000) * 100, 6);
    // fundingApy = rate * intervalsPerYear * 100; 8h -> 3/day * 365 = 1095 intervals.
    expect(res.fundingApy).toBeCloseTo(0.0001 * 1095 * 100, 4);
    expect(res.netApy).toBeLessThan(res.fundingApy!);
    expect(res.strategy).toMatch(/collect funding/);
    expect(res.series.length).toBeGreaterThan(0);
  });

  it('falls back to a null result when the exchange request fails', async () => {
    axiosMock.rejectGet(new Error('timeout'));
    const res = await getSpotFutures('bybit', 'BTCUSDT');
    expect(res.supported).toBe(true);
    expect(res.spotPrice).toBeNull();
    expect(res.fundingRate).toBeNull();
  });

  it('exposes the supported exchange list', () => {
    expect(SF_SUPPORTED_EXCHANGES).toContain('binance');
    expect(SF_SUPPORTED_EXCHANGES).toContain('gate');
  });

  it('reuses the in-memory series across calls', async () => {
    axiosMock.routeGet({
      'premiumIndex': { markPrice: '60050', lastFundingRate: '0.0001' },
      'ticker/price': { price: '60000' },
    });
    await getSpotFutures('binance', 'BTCUSDT');
    const second = await getSpotFutures('binance', 'BTCUSDT');
    expect(second.series.length).toBeGreaterThanOrEqual(1);
  });
});
