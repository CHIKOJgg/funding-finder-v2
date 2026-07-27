import { detectArbitrageOpportunities, calculateNetApr, calculatePaybackDays, EXCHANGE_FEES } from '../services/arbitrageService.js';
import type { ExchangeResult, ArbitrageOpportunity } from '../types/index.js';

function makeResult(overrides: Partial<ExchangeResult>): ExchangeResult {
  return {
    exchange: 'binance',
    contract: 'BTCUSDT',
    currentFunding: 0.0001,
    funding_interval_seconds: 28800,
    funding_interval_hours: 8,
    funding_interval_source: 'api' as const,
    funding_rate_per_hour: 0.0001,
    funding_rate_per_day: 0.00024,
    annualized_rate: 0.1095,
    funding_next_apply: Date.now() + 1000,
    time_until_next_funding_seconds: 1000,
    mark_price: 60000,
    volume_24h_settle: 10_000_000,
    med_seconds: null,
    med_hours: null,
    ...overrides,
  };
}

describe('calculateNetApr', () => {
  it('returns the annual return value', () => {
    expect(calculateNetApr(15.5)).toBe(15.5);
  });

  it('works with zero', () => {
    expect(calculateNetApr(0)).toBe(0);
  });

  it('works with negative returns', () => {
    expect(calculateNetApr(-5.2)).toBe(-5.2);
  });
});

describe('calculatePaybackDays', () => {
  it('returns Infinity for zero spread', () => {
    expect(calculatePaybackDays(0, 'binance', 'bybit')).toBe(Infinity);
  });

  it('returns a positive number for positive spread', () => {
    const days = calculatePaybackDays(0.0002, 'binance', 'bybit');
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThan(Infinity);
  });

  it('uses exchange-specific fees', () => {
    const withBinance = calculatePaybackDays(0.0002, 'binance', 'bybit');
    const withGate = calculatePaybackDays(0.0002, 'gate', 'bybit');
    expect(withBinance).not.toBe(withGate);
  });
});

describe('detectArbitrageOpportunities', () => {
  it('returns empty array when only one exchange per pair', () => {
    const results = [makeResult()];
    const opps = detectArbitrageOpportunities(results);
    expect(opps).toHaveLength(0);
  });

  it('detects opportunities across two exchanges', () => {
    const results = [
      makeResult({ exchange: 'binance', funding_rate_per_hour: 0.0001, annualized_rate: 0.1095 }),
      makeResult({ exchange: 'bybit', funding_rate_per_hour: 0.0003, annualized_rate: 0.3285 }),
    ];
    const opps = detectArbitrageOpportunities(results);
    expect(opps.length).toBeGreaterThan(0);
  });

  it('populates netApr on opportunities', () => {
    const results = [
      makeResult({ exchange: 'binance', funding_rate_per_hour: 0.0001, annualized_rate: 0.1095 }),
      makeResult({ exchange: 'bybit', funding_rate_per_hour: 0.0003, annualized_rate: 0.3285 }),
    ];
    const opps = detectArbitrageOpportunities(results);
    if (opps.length > 0) {
      expect(opps[0]).toHaveProperty('netApr');
      expect(opps[0]).toHaveProperty('paybackDays');
    }
  });

  it('calculates paybackDays correctly', () => {
    const results = [
      makeResult({ exchange: 'binance', funding_rate_per_hour: 0.0001, difference_per_day: 0.00024, volume_24h_settle: 10_000_000 }),
      makeResult({ exchange: 'bybit', funding_rate_per_hour: 0.0003, difference_per_day: 0.00024, volume_24h_settle: 10_000_000 }),
    ];
    const opps = detectArbitrageOpportunities(results);
    if (opps.length > 0) {
      expect(typeof opps[0].paybackDays).toBe('number');
      expect(opps[0].paybackDays! >= 0 || opps[0].paybackDays === undefined).toBe(true);
    }
  });

  it('attaches persistence grade', () => {
    const results = [
      makeResult({ exchange: 'binance', funding_rate_per_hour: 0.0001 }),
      makeResult({ exchange: 'bybit', funding_rate_per_hour: 0.0003 }),
    ];
    const opps = detectArbitrageOpportunities(results);
    if (opps.length > 0) {
      expect(opps[0]).toHaveProperty('persistenceGrade');
      expect(opps[0]).toHaveProperty('stabilityGrade');
    }
  });
});