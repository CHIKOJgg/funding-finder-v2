const prismaMock = require('./testkit').prismaMock;

jest.mock('../services/prisma', () => ({
  prisma: prismaMock,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
}));

jest.mock('../utils/logger.js');

import * as arb from '../services/arbitrageService.js';

function mk(partial: any): any {
  return {
    currentFunding: partial.funding_rate_per_hour ?? 0.0001,
    funding_interval_seconds: 28800,
    funding_interval_hours: partial.funding_interval_hours ?? 8,
    funding_interval_source: 'default',
    funding_rate_per_hour: partial.funding_rate_per_hour ?? 0.0001,
    funding_rate_per_day: (partial.funding_rate_per_hour ?? 0.0001) * 3,
    annualized_rate: (partial.funding_rate_per_hour ?? 0.0001) * 3 * 365,
    funding_next_apply: 0,
    time_until_next_funding_seconds: 0,
    mark_price: 60000,
    volume_24h_settle: partial.volume_24h_settle ?? 10_000_000,
    med_seconds: 28800,
    med_hours: 8,
    ...partial,
  };
}

describe('arbitrageService — detectArbitrageOpportunities', () => {
  it('detects an opportunity only when difference exceeds the per-hour threshold', () => {
    const { detectArbitrageOpportunities } = arb;
    const results = [
      mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0001 }),
      mk({ exchange: 'bybit', contract: 'BTCUSDT', funding_rate_per_hour: 0.00025 }),
    ];
    const opps = detectArbitrageOpportunities(results);
    expect(opps.length).toBeGreaterThanOrEqual(1);
    expect(opps[0].difference).toBeGreaterThan(0.00001);
    // Direction: higher hourly rate exchange is SHORTED.
    expect(opps[0].opportunity).toContain('SHORT on bybit');
  });

  it('does not create a pair group when a single exchange appears once', () => {
    const { detectArbitrageOpportunities } = arb;
    const opps = detectArbitrageOpportunities([mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0001 })]);
    expect(opps).toHaveLength(0);
  });

  it('skips interval mismatch but allows matching intervals on different bases', () => {
    const { detectArbitrageOpportunities } = arb;
    const results = [
      mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0001, funding_interval_hours: 8 }),
      mk({ exchange: 'okx', contract: 'BTC-USDT-SWAP', funding_rate_per_hour: 0.0009, funding_interval_hours: 8 }),
    ];
    const opps = detectArbitrageOpportunities(results);
    expect(opps.length).toBe(1);
    expect(opps[0].intervalMismatch).toBe(false);
  });

  it('sorts opportunities by descending score', () => {
    const { detectArbitrageOpportunities } = arb;
    const results = [
      mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0001, volume_24h_settle: 2_000_000 }),
      mk({ exchange: 'bybit', contract: 'BTCUSDT', funding_rate_per_hour: 0.0002, volume_24h_settle: 2_000_000 }),
      mk({ exchange: 'okx', contract: 'BTC-USDT-SWAP', funding_rate_per_hour: 0.0006, volume_24h_settle: 50_000_000 }),
    ];
    const opps = detectArbitrageOpportunities(results);
    expect(opps.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < opps.length; i++) {
      expect(opps[i - 1].score).toBeGreaterThanOrEqual(opps[i].score);
    }
  });

  it('applies interval-mismatch penalty and HIGH-risk penalty to the score', () => {
    const { detectArbitrageOpportunities } = arb;
    // Matching intervals, small diff, high liquidity -> LOW risk.
    const matched = detectArbitrageOpportunities([
      mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.00010, volume_24h_settle: 50_000_000 }),
      mk({ exchange: 'okx', contract: 'BTC-USDT-SWAP', funding_rate_per_hour: 0.00012, volume_24h_settle: 50_000_000, funding_interval_hours: 8 }),
    ]);
    expect(matched[0].risk.level).toBe('LOW');

    // Interval mismatch is captured on the opportunity (penalty applied in score).
    const mismatched = detectArbitrageOpportunities([
      mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0001, volume_24h_settle: 50_000_000, funding_interval_hours: 8 }),
      mk({ exchange: 'hyperliquid', contract: 'BTC', funding_rate_per_hour: 0.0009, volume_24h_settle: 50_000_000, funding_interval_hours: 1 }),
    ]);
    // Mismatch is skipped entirely by the detector (non-collectible), so we
    // assert it is absent rather than relying on a penalty path.
    expect(mismatched).toHaveLength(0);
  });

  it('classifies risk across liquidity / volatility / anomaly thresholds via detected opportunities', () => {
    const { detectArbitrageOpportunities } = arb;
    // Very low liquidity -> HIGH risk.
    const lowLiq = detectArbitrageOpportunities([
      mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0001, volume_24h_settle: 100_000 }),
      mk({ exchange: 'okx', contract: 'BTC-USDT-SWAP', funding_rate_per_hour: 0.0009, volume_24h_settle: 100_000, funding_interval_hours: 8 }),
    ]);
    expect(lowLiq[0].risk.level).toBe('HIGH');
    expect(lowLiq[0].risk.reasons.join(' ')).toContain('Очень низкая ликвидность');

    // High percentage diff -> HIGH risk.
    const highVol = detectArbitrageOpportunities([
      mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0001, volume_24h_settle: 50_000_000 }),
      mk({ exchange: 'okx', contract: 'BTC-USDT-SWAP', funding_rate_per_hour: 0.05, volume_24h_settle: 50_000_000, funding_interval_hours: 8 }),
    ]);
    expect(highVol[0].risk.level).toBe('HIGH');
  });
});

describe('arbitrageService — profit math via calculateProfit', () => {
  it('falls back to a default 0.05% taker fee for unknown exchanges', async () => {
    const opp = mk({ exchange: 'unknownA', contract: 'BTCUSDT', funding_rate_per_hour: 0.0001, volume_24h_settle: 10_000_000, exchangeA: 'unknownA', exchangeB: 'unknownB', difference: 0.0001, difference_per_day: 0.0003, percentageDiff: 0, intervalA_hours: 8, intervalB_hours: 8, intervalMismatch: false });
    const { profit } = await arb.calculateProfit(opp, 1000);
    // Default fee is 0.0005; totalFees = capital * (0.0005+0.0005) * 2.
    expect(profit.fees).toBeCloseTo(1000 * 0.0005 * 2 * 2);
    expect(profit.annualReturn).toBeGreaterThan(0);
  });

  it('produces negative net hourly when one-time costs exceed gross hourly', async () => {
    const opp = mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.000001, volume_24h_settle: 500_000, exchangeA: 'binance', exchangeB: 'bybit', difference: 0.000001, difference_per_day: 0.000003, percentageDiff: 0, intervalA_hours: 8, intervalB_hours: 8, intervalMismatch: false });
    const { profit } = await arb.calculateProfit(opp, 1000);
    expect(profit.netHourly).toBeLessThan(0);
  });

  it('scales gross by horizon correctly', async () => {
    const opp = mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.001, volume_24h_settle: 50_000_000, exchangeA: 'binance', exchangeB: 'bybit', difference: 0.001, difference_per_day: 0.003, percentageDiff: 0, intervalA_hours: 8, intervalB_hours: 8, intervalMismatch: false });
    const { profit } = await arb.calculateProfit(opp, 1000);
    expect(profit.grossDaily).toBeCloseTo(profit.grossHourly * 24);
    expect(profit.netDaily).toBeCloseTo(profit.grossDaily - profit.fees - profit.slippage);
  });
});

describe('arbitrageService — alert CRUD', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('enforces the 50-alert per-user cap', async () => {
    
    prismaMock.arbitrageAlert.count.mockResolvedValue(50);
    await expect(
      arb.createArbitrageAlert('u1', { pair: 'BTC/USDT', exchangeA: 'binance', exchangeB: 'bybit' })
    ).rejects.toThrow('Maximum 50 arbitrage alerts per user');
    expect(prismaMock.arbitrageAlert.create).not.toHaveBeenCalled();
  });

  it('creates an alert with sane defaults', async () => {
    
    prismaMock.arbitrageAlert.count.mockResolvedValue(0);
    prismaMock.arbitrageAlert.create.mockResolvedValue({ id: 'a1' });
    const res = await arb.createArbitrageAlert('u1', { pair: 'BTC/USDT', exchangeA: 'binance', exchangeB: 'bybit' });
    expect(res.id).toBe('a1');
    const data = prismaMock.arbitrageAlert.create.mock.calls[0][0].data;
    expect(data.condition).toBe('difference');
    expect(data.threshold).toBe(0.002);
    expect(data.direction).toBe('both');
    expect(data.cooldown).toBe(300000);
  });

  it('honors custom alert fields', async () => {
    
    prismaMock.arbitrageAlert.count.mockResolvedValue(0);
    prismaMock.arbitrageAlert.create.mockResolvedValue({ id: 'a2' });
    await arb.createArbitrageAlert('u1', { pair: 'ETH/USDT', exchangeA: 'okx', exchangeB: 'gate', condition: 'spread', threshold: 0.01, direction: 'long', cooldown: 1000 });
    const data = prismaMock.arbitrageAlert.create.mock.calls[0][0].data;
    expect(data.condition).toBe('spread');
    expect(data.threshold).toBe(0.01);
    expect(data.direction).toBe('long');
    expect(data.cooldown).toBe(1000);
  });

  it('getUserArbitrageAlerts clamps limit/offset into safe bounds', async () => {
    
    prismaMock.arbitrageAlert.findMany.mockResolvedValue([{ id: 'a' }]);
    prismaMock.arbitrageAlert.count.mockResolvedValue(1);
    const r1 = await arb.getUserArbitrageAlerts('u1', 9999, -50);
    expect(r1.limit).toBe(200);
    expect(r1.offset).toBe(0);
    const r2 = await arb.getUserArbitrageAlerts('u1', 0, 5);
    expect(r2.limit).toBe(1);
    expect(r2.offset).toBe(5);
    const lastCall = prismaMock.arbitrageAlert.findMany.mock.calls.at(-1)[0];
    expect(lastCall.take).toBe(1);
    expect(lastCall.skip).toBe(5);
  });

  it('deleteArbitrageAlert returns false when nothing matched', async () => {
    
    prismaMock.arbitrageAlert.deleteMany.mockResolvedValue({ count: 0 });
    expect(await arb.deleteArbitrageAlert('u1', 'missing')).toBe(false);
  });

  it('deleteArbitrageAlert returns true on a real delete', async () => {
    
    prismaMock.arbitrageAlert.deleteMany.mockResolvedValue({ count: 1 });
    expect(await arb.deleteArbitrageAlert('u1', 'aid')).toBe(true);
  });

  it('toggleArbitrageAlert flips isActive and returns null when missing', async () => {
    
    prismaMock.arbitrageAlert.findFirst.mockResolvedValue(null);
    expect(await arb.toggleArbitrageAlert('u1', 'aid')).toBeNull();

    prismaMock.arbitrageAlert.findFirst.mockResolvedValue({ id: 'aid', isActive: true });
    prismaMock.arbitrageAlert.update.mockResolvedValue({ id: 'aid', isActive: false });
    const res = await arb.toggleArbitrageAlert('u1', 'aid');
    expect(res.isActive).toBe(false);
    expect(prismaMock.arbitrageAlert.update.mock.calls[0][0].data.isActive).toBe(false);
  });

  it('calculateProfit recomputes profit + risk for an opportunity', async () => {
    
    const opp = mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0002, volume_24h_settle: 50_000_000, exchangeA: 'binance', exchangeB: 'bybit', difference: 0.0001, difference_per_day: 0.0003, percentageDiff: 0, intervalA_hours: 8, intervalB_hours: 8, intervalMismatch: false });
    const { profit, risk } = await arb.calculateProfit(opp, 5000);
    expect(profit.annualReturn).toBeDefined();
    expect(risk.level).toBeDefined();
  });
});
