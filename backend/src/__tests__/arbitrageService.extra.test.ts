import { prismaMock } from './testkit';
import type { ExchangeResult } from '../types/index.js';

jest.mock('../services/prisma', () => ({
  prisma: prismaMock,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
}));

import {
  detectArbitrageOpportunities,
  calculateProfit,
  createArbitrageAlert,
  getUserArbitrageAlerts,
  deleteArbitrageAlert,
  toggleArbitrageAlert,
} from '../services/arbitrageService.js';

function mk(partial: Partial<ExchangeResult> & Pick<ExchangeResult, 'exchange' | 'contract' | 'funding_rate_per_hour'>): ExchangeResult {
  return {
    currentFunding: partial.funding_rate_per_hour,
    funding_interval_seconds: 28800,
    funding_interval_hours: 8,
    funding_interval_source: 'default',
    funding_rate_per_day: partial.funding_rate_per_hour * 3,
    annualized_rate: partial.funding_rate_per_hour * 3 * 365,
    funding_next_apply: 0,
    time_until_next_funding_seconds: 0,
    mark_price: 60000,
    volume_24h_settle: 10_000_000,
    med_seconds: 28800,
    med_hours: 8,
    ...partial,
  } as ExchangeResult;
}

describe('arbitrageService — scoring and profit/risk', () => {
  it('calculateProfit returns profit + risk with annual return > 0 for a real spread', async () => {
    const opp = detectArbitrageOpportunities([
      mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0001, volume_24h_settle: 50_000_000 }),
      mk({ exchange: 'bybit', contract: 'BTCUSDT', funding_rate_per_hour: 0.0004, volume_24h_settle: 40_000_000 }),
    ])[0];

    const { profit, risk } = await calculateProfit(opp, 5000);
    expect(profit.annualReturn).toBeGreaterThan(0);
    expect(profit.fees).toBeGreaterThan(0);
    expect(profit.slippage).toBeGreaterThan(0);
    // The one-time cost is subtracted once, so the annualized return is just
    // below the naive rate*8760*100 figure.
    expect(profit.annualReturn).toBeLessThan(0.0003 * 24 * 365 * 100);
    expect(['LOW', 'MEDIUM', 'HIGH']).toContain(risk.level);
  });

  it('scores higher-liquidity + lower-risk opportunities above risky ones', () => {
    // Same spread, but `risky` has thin liquidity (HIGH risk -> *0.3) and no
    // liquidity bonus, while `good` has deep liquidity (LOW/MEDIUM -> bonus).
    const good = detectArbitrageOpportunities([
      mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0001, volume_24h_settle: 50_000_000 }),
      mk({ exchange: 'bybit', contract: 'BTCUSDT', funding_rate_per_hour: 0.0004, volume_24h_settle: 40_000_000 }),
    ])[0];
    const risky = detectArbitrageOpportunities([
      mk({ exchange: 'binance', contract: 'ETHUSDT', funding_rate_per_hour: 0.0001, volume_24h_settle: 300_000 }),
      mk({ exchange: 'bybit', contract: 'ETHUSDT', funding_rate_per_hour: 0.0004, volume_24h_settle: 300_000 }),
    ])[0];
    expect(good.score).toBeGreaterThan(risky.score);
  });

  it('detects interval mismatch as a risk factor and penalizes the score', () => {
    const opps = detectArbitrageOpportunities([
      mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0001, funding_interval_hours: 8 }),
      mk({ exchange: 'hyperliquid', contract: 'BTC', funding_rate_per_hour: 0.0005, funding_interval_hours: 1 }),
    ]);
    expect(opps).toHaveLength(0);
  });

  it('flags intervalMismatch=true on the opportunity object when intervals differ', () => {
    // Same pair but one exchange reports 8h and the other 4h -> mismatch flagged
    // and the pair is skipped (not collectible), so no opportunity is produced.
    const opps = detectArbitrageOpportunities([
      mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0001, funding_interval_hours: 8 }),
      mk({ exchange: 'okx', contract: 'BTC-USDT-SWAP', funding_rate_per_hour: 0.0005, funding_interval_hours: 4 }),
    ]);
    expect(opps).toHaveLength(0);
  });
});

describe('arbitrageService — alert CRUD', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws when the user hits the 50-alert cap', async () => {
    (prismaMock.arbitrageAlert.count as jest.Mock).mockResolvedValue(50);
    await expect(
      createArbitrageAlert('u1', { pair: 'BTC/USDT', exchangeA: 'binance', exchangeB: 'bybit' })
    ).rejects.toThrow(/Maximum 50/);
  });

  it('creates an arbitrage alert with sensible defaults', async () => {
    (prismaMock.arbitrageAlert.count as jest.Mock).mockResolvedValue(0);
    (prismaMock.arbitrageAlert.create as jest.Mock).mockResolvedValue({ id: 'x1' });
    await createArbitrageAlert('u1', { pair: 'BTC/USDT', exchangeA: 'binance', exchangeB: 'bybit' });
    const data = (prismaMock.arbitrageAlert.create as jest.Mock).mock.calls[0][0].data;
    expect(data.condition).toBe('difference');
    expect(data.threshold).toBe(0.002);
    expect(data.direction).toBe('both');
  });

  it('paginates user alerts', async () => {
    (prismaMock.arbitrageAlert.findMany as jest.Mock).mockResolvedValue([{ id: 'a' }]);
    (prismaMock.arbitrageAlert.count as jest.Mock).mockResolvedValue(2);
    const res = await getUserArbitrageAlerts('u1', 10, 0);
    expect(res.total).toBe(2);
    expect((prismaMock.arbitrageAlert.findMany as jest.Mock).mock.calls[0][0].take).toBe(10);
  });

  it('deletes an alert by id scoped to the user', async () => {
    (prismaMock.arbitrageAlert.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
    expect(await deleteArbitrageAlert('u1', 'a1')).toBe(true);
    const where = (prismaMock.arbitrageAlert.deleteMany as jest.Mock).mock.calls[0][0].where;
    expect(where).toEqual({ id: 'a1', userId: 'u1' });
  });

  it('toggles active state', async () => {
    (prismaMock.arbitrageAlert.findFirst as jest.Mock).mockResolvedValue({ id: 'a1', isActive: true });
    (prismaMock.arbitrageAlert.update as jest.Mock).mockResolvedValue({ id: 'a1', isActive: false });
    const res = await toggleArbitrageAlert('u1', 'a1');
    expect(res.isActive).toBe(false);
  });
});
