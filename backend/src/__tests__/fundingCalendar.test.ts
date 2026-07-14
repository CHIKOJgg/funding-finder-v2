import { prismaMock } from './testkit';
import { cache } from '../utils/exchangeClient.js';
import type { ExchangeResult, ScanResult } from '../types/index.js';

jest.mock('../services/prisma', () => ({
  prisma: prismaMock,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
}));

jest.mock('../exchanges/index.js', () => ({
  SUPPORTED_EXCHANGES: ['gate', 'binance'],
  scanExchanges: jest.fn(),
}));

import { getFundingCalendar } from '../services/fundingCalendar.js';

function mk(partial: Partial<ExchangeResult> & Pick<ExchangeResult, 'exchange' | 'contract'>): ExchangeResult {
  return {
    currentFunding: 0.0001,
    funding_rate_per_hour: 0.0001,
    funding_rate_per_day: 0.0003,
    annualized_rate: 0.1,
    funding_interval_seconds: 28800,
    funding_interval_hours: 8,
    funding_interval_source: 'default',
    funding_next_apply: 0,
    time_until_next_funding_seconds: 0,
    mark_price: 60000,
    volume_24h_settle: 10_000_000,
    med_seconds: 28800,
    med_hours: 8,
    ...partial,
  } as ExchangeResult;
}

function seedScan(key: string, items: ExchangeResult[]): void {
  const result: ScanResult = {
    highYield: items,
    mediumYield: [],
    lowYield: [],
    hourly: [],
    twohour: [],
    fallback: [],
    scanned: items.length,
    metrics: { minFundingUsed: 0.000001, totalOpportunities: items.length, exchanges: ['gate'], averageIntervalHours: 8, intervalDistribution: { '8h': items.length } },
  };
  cache.set(key, { result, ts: Date.now() }, 60000);
}

describe('fundingCalendar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cache.clear();
  });

  it('returns an empty, stale result when there is no cached scan', async () => {
    const res = await getFundingCalendar(['gate']);
    expect(res).toEqual({ events: [], scanned: 0, stale: true });
  });

  it('extracts future funding events from the cached scan, sorted by time', async () => {
    const now = Date.now();
    const items = [
      mk({ exchange: 'gate', contract: 'BTC_USDT', funding_next_apply: now + 8 * 3600 * 1000 }),
      mk({ exchange: 'gate', contract: 'ETH_USDT', funding_next_apply: now + 1 * 3600 * 1000 }),
    ];
    seedScan('scan:gate', items);

    const res = await getFundingCalendar(['gate']);
    expect(res.stale).toBe(false);
    expect(res.scanned).toBe(2);
    expect(res.events).toHaveLength(2);
    // Sorted ascending by nextApply: ETH (1h) then BTC (8h).
    expect(res.events[0].pair).toBe('ETH_USDT');
    expect(res.events[0].secondsUntil).toBeGreaterThan(0);
    expect(res.events[0].nextApply).toBeLessThan(res.events[1].nextApply);
  });

  it('derives next-apply from the funding interval when funding_next_apply is missing', async () => {
    const items = [mk({ exchange: 'gate', contract: 'SOL_USDT', funding_next_apply: 0 })]; // 0 -> derive
    seedScan('scan:gate', items);

    const res = await getFundingCalendar(['gate']);
    expect(res.events).toHaveLength(1);
    expect(res.events[0].nextApply).toBeGreaterThan(Date.now());
  });

  it('respects the limit parameter', async () => {
    const now = Date.now();
    const items = Array.from({ length: 5 }, (_, i) =>
      mk({ exchange: 'gate', contract: `C${i}_USDT`, funding_next_apply: now + (i + 1) * 3600 * 1000 })
    );
    seedScan('scan:gate', items);

    const res = await getFundingCalendar(['gate'], 2);
    expect(res.events).toHaveLength(2);
  });

  it('filters out unsupported exchanges', async () => {
    const res = await getFundingCalendar(['gate', 'kraken'], 5);
    // kraken is not supported, so it is dropped; with no cached gate scan -> stale empty.
    expect(res).toEqual({ events: [], scanned: 0, stale: true });
  });
});
