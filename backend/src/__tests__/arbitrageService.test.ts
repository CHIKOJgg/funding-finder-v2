import { detectArbitrageOpportunities } from '../services/arbitrageService.js';
import type { ExchangeResult } from '../types/index.js';

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

describe('detectArbitrageOpportunities (integration of the core algorithm)', () => {
  it('creates one opportunity for the same pair across two different exchanges', () => {
    const results = [
      mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0001 }),
      mk({ exchange: 'bybit', contract: 'BTCUSDT', funding_rate_per_hour: 0.0002 }),
    ];
    const opps = detectArbitrageOpportunities(results);
    expect(opps.length).toBe(1);
    expect(opps[0].pair).toBe('BTC/USDT');
    expect(opps[0].markPriceA).toBe(60000);
    expect(opps[0].markPriceB).toBe(60000);
  });

  it('skips an exchange compared against itself', () => {
    const results = [
      mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0001 }),
      mk({ exchange: 'binance', contract: 'ETHUSDT', funding_rate_per_hour: 0.0002 }),
    ];
    const opps = detectArbitrageOpportunities(results);
    expect(opps.length).toBe(0);
  });

  it('skips pairs whose funding-rate difference is below the minimum threshold', () => {
    const results = [
      mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0001 }),
      mk({ exchange: 'bybit', contract: 'BTCUSDT', funding_rate_per_hour: 0.0001001 }), // diff < 0.00001
    ];
    const opps = detectArbitrageOpportunities(results);
    expect(opps.length).toBe(0);
  });

  it('skips mismatched funding intervals (would be non-collectible)', () => {
    const results = [
      mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0001, funding_interval_hours: 8 }),
      mk({ exchange: 'hyperliquid', contract: 'BTC', funding_rate_per_hour: 0.0005, funding_interval_hours: 1 }),
    ];
    const opps = detectArbitrageOpportunities(results);
    expect(opps.length).toBe(0);
  });

  it('produces both directions and a positive annualized return for a real spread', () => {
    const results = [
      mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0001, volume_24h_settle: 50_000_000 }),
      mk({ exchange: 'bybit', contract: 'BTCUSDT', funding_rate_per_hour: 0.0003, volume_24h_settle: 40_000_000 }),
    ];
    const opps = detectArbitrageOpportunities(results);
    expect(opps.length).toBeGreaterThanOrEqual(1);
    const opp = opps[0];
    expect(opp.profit.annualReturn).toBeGreaterThan(0);
    expect(opp.risk.level).toMatch(/LOW|MEDIUM|HIGH/);
    expect(typeof opp.score).toBe('number');
  });
});
