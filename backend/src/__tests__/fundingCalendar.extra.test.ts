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

jest.mock('../utils/logger.js');

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

describe('fundingCalendar — resolveNextApply edge cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cache.clear();
  });

  it('drops events whose funding_next_apply is in the PAST AND no interval to derive from', async () => {
    const now = Date.now();
    const items = [
      // Past settlement with NO usable interval -> cannot be scheduled -> dropped.
      mk({ exchange: 'gate', contract: 'OLD_USDT', funding_next_apply: now - 3600 * 1000, funding_interval_seconds: 0, funding_interval_hours: 0 }),
      // Future settlement -> kept.
      mk({ exchange: 'gate', contract: 'NEW_USDT', funding_next_apply: now + 3600 * 1000 }),
    ];
    seedScan('scan:gate', items);
    const res = await getFundingCalendar(['gate']);
    expect(res.events).toHaveLength(1);
    expect(res.events[0].pair).toBe('NEW_USDT');
  });

  it('drops events with a non-finite funding_next_apply AND no usable interval', async () => {
    const items = [
      mk({ exchange: 'gate', contract: 'BAD1', funding_next_apply: NaN, funding_interval_seconds: 0, funding_interval_hours: 0 }),
      mk({ exchange: 'gate', contract: 'BAD2', funding_next_apply: Infinity, funding_interval_seconds: 0, funding_interval_hours: 0 } as any),
    ];
    seedScan('scan:gate', items);
    const res = await getFundingCalendar(['gate']);
    // Both lack a future settlement timestamp -> filtered out.
    expect(res.events).toHaveLength(0);
  });

  it('re-derives a FUTURE settlement from the interval when funding_next_apply is a past value', async () => {
    const now = Date.now();
    // Past fna but a valid 8h interval: resolveNextApply falls back to deriving
    // the next interval boundary, which is in the future -> event is kept.
    const items = [
      mk({ exchange: 'gate', contract: 'PAST_USDT', funding_next_apply: now - 3600 * 1000 }),
    ];
    seedScan('scan:gate', items);
    const res = await getFundingCalendar(['gate']);
    expect(res.events).toHaveLength(1);
    expect(res.events[0].nextApply).toBeGreaterThan(now);
  });

  it('derives next-apply from funding_interval_hours when seconds missing', async () => {
    const now = Date.now();
    const items = [
      mk({
        exchange: 'gate', contract: 'DERIVED_USDT',
        funding_next_apply: 0,
        funding_interval_seconds: 0, funding_interval_hours: 4,
      }),
    ];
    seedScan('scan:gate', items);
    const res = await getFundingCalendar(['gate']);
    expect(res.events).toHaveLength(1);
    // Should be the next 4h boundary strictly after `now`.
    expect(res.events[0].nextApply).toBeGreaterThan(now);
    expect(res.events[0].secondsUntil).toBeGreaterThan(0);
  });

  it('derives next-apply when funding_next_apply is 0 and only seconds interval present', async () => {
    const now = Date.now();
    const items = [
      mk({ exchange: 'gate', contract: 'SEC_USDT', funding_next_apply: 0, funding_interval_hours: 0 }),
    ];
    seedScan('scan:gate', items);
    const res = await getFundingCalendar(['gate']);
    expect(res.events).toHaveLength(1);
    expect(res.events[0].nextApply).toBeGreaterThan(now);
  });

  it('falls back to gate when ALL requested exchanges are invalid', async () => {
    // No cache at all; clean list empty -> defaults to ['gate']; background scan
    // kicks off and we get a stale empty result (does not throw).
    const res = await getFundingCalendar(['kraken', 'coinbase']);
    expect(res).toEqual({ events: [], scanned: 0, stale: true });
  });

  it('slices results to the requested limit even with many events', async () => {
    const now = Date.now();
    const items = Array.from({ length: 20 }, (_, i) =>
      mk({ exchange: 'gate', contract: `M${i}_USDT`, funding_next_apply: now + (i + 1) * 600 * 1000 })
    );
    seedScan('scan:gate', items);
    const res = await getFundingCalendar(['gate'], 3);
    expect(res.events).toHaveLength(3);
    // Strictly ascending order.
    for (let i = 1; i < res.events.length; i++) {
      expect(res.events[i].nextApply).toBeGreaterThan(res.events[i - 1].nextApply);
    }
  });
});
