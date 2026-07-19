import { installMockAxios, prismaMock } from './testkit';

jest.mock('axios');
jest.mock('../services/prisma', () => ({
  prisma: prismaMock,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
}));

jest.mock('../utils/logger.js');

import { getSpotFutures } from '../services/spotFuturesService.js';
import { cache } from '../utils/exchangeClient.js';

const axiosMock = installMockAxios();

describe('spotFuturesService — extra coverage', () => {
  beforeEach(() => {
    axiosMock.reset();
    cache.clear();
    jest.clearAllMocks();
  });

  it('parses OKX instrument id with dash and computes APY', async () => {
    axiosMock.routeGet({
      'funding-rate': { data: [{ fundingRate: '0.0002' }] },
      'market/ticker': { data: [{ last: '3000' }] },
      'mark-price': { data: [{ markPx: '3010' }] },
    });
    const res = await getSpotFutures('okx', 'BTC-USDT');
    expect(res.supported).toBe(true);
    expect(res.symbol).toBe('BTC-USDT');
    expect(res.spotPrice).toBe(3000);
    expect(res.perpMark).toBe(3010);
    expect(res.fundingRate).toBe(0.0002);
    expect(res.fundingApy).toBeCloseTo(0.0002 * 1095 * 100, 2);
  });

  it('parses OKX bare pair by injecting a dash', async () => {
    axiosMock.routeGet({
      'funding-rate': { data: [{ fundingRate: '0.0003' }] },
      'market/ticker': { data: [{ last: '1' }] },
      'mark-price': { data: [{ markPx: '1' }] },
    });
    const res = await getSpotFutures('okx', 'BTCUSDT');
    expect(res.symbol).toBe('BTC-USDT');
  });

  it('parses Gate.io underscore contract and normalizes funding', async () => {
    axiosMock.routeGet({
      'contracts/BTC_USDT': { mark_price: '50000', funding_rate: '0.00015' },
      'spot/tickers': [{ last: '49900' }],
    });
    const res = await getSpotFutures('gate', 'BTC_USDT');
    expect(res.spotPrice).toBe(49900);
    expect(res.perpMark).toBe(50000);
    expect(res.fundingRate).toBe(0.00015);
  });

  it('parses MEXC funding rate and falls back to fairPrice', async () => {
    axiosMock.get.mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('contract/ticker')) return { data: { data: { fairPrice: '100', lastPrice: '99' } } };
      if (u.includes('ticker/price')) return { data: { price: '100' } };
      if (u.includes('funding_rate')) return { data: { data: { fundingRate: '0.00005' } } };
      return { data: {} };
    });
    const res = await getSpotFutures('mexc', 'BTCUSDT');
    expect(res.spotPrice).toBe(100);
    expect(res.perpMark).toBe(100);
    expect(res.fundingRate).toBe(0.00005);
  });

  it('caps the basis time-series at MAX_SAMPLES (60)', async () => {
    axiosMock.routeGet({
      'premiumIndex': { markPrice: '60050', lastFundingRate: '0.0001' },
      'ticker/price': { price: '60000' },
    });
    // Push 70 samples; the sparkline must never exceed 60.
    for (let i = 0; i < 70; i++) {
      await getSpotFutures('binance', 'BTCUSDT');
    }
    const res = await getSpotFutures('binance', 'BTCUSDT');
    expect(res.series.length).toBeLessThanOrEqual(60);
    expect(res.series.length).toBe(60);
  });

  it('returns unsupported result for an unknown exchange string', async () => {
    const res = await getSpotFutures('notARealExchange', 'BTCUSDT');
    expect(res.supported).toBe(false);
    expect(res.spotPrice).toBeNull();
  });

  it('handles a zero spot price (basis guarded to 0)', async () => {
    axiosMock.routeGet({
      'premiumIndex': { markPrice: '0', lastFundingRate: '0.0001' },
      'ticker/price': { price: '0' },
    });
    const res = await getSpotFutures('binance', 'BTCUSDT');
    expect(res.basisPct).toBe(0);
  });
});
