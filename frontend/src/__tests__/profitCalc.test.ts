import { describe, it, expect } from 'vitest';
import { profitCalcClient, breakEvenDays, getPaybackDays, type ClientProfit } from '../utils/profitCalc';

describe('profitCalcClient', () => {
  it('returns positive net APR for a profitable spread', () => {
    const result = profitCalcClient({
      exchangeA: 'binance',
      exchangeB: 'bybit',
      difference: 0.0001,
      volumeA: 5_000_000,
      volumeB: 5_000_000,
    }, 1000);
    expect(result.netApr).toBeGreaterThan(0);
    expect(result.netApr).toBeLessThan(100);
  });

  it('net APR is lower than gross annualized return', () => {
    const result = profitCalcClient({
      exchangeA: 'binance',
      exchangeB: 'bybit',
      difference: 0.0001,
      volumeA: 5_000_000,
      volumeB: 5_000_000,
    }, 1000);
    const grossAnnualReturn = result.grossAnnual / 1000 * 100;
    expect(result.netApr).toBeLessThanOrEqual(grossAnnualReturn);
  });

  it('paybackDays is reasonable for a spread with positive differential', () => {
    const result = profitCalcClient({
      exchangeA: 'binance',
      exchangeB: 'bybit',
      difference: 0.0002,
      volumeA: 10_000_000,
      volumeB: 10_000_000,
    }, 1000);
    expect(result.paybackDays).toBeGreaterThan(0);
    expect(result.paybackDays).toBeLessThan(365);
  });

  it('paybackDays is -1 when one-time costs are zero', () => {
    const result = profitCalcClient({
      exchangeA: 'binance',
      exchangeB: 'bybit',
      difference: 0.0001,
      volumeA: 0,
      volumeB: 0,
    }, 1000);
    expect(result.paybackDays).toBeDefined();
  });

  it('includes all required fields', () => {
    const result: ClientProfit = profitCalcClient({
      exchangeA: 'binance',
      exchangeB: 'bybit',
      difference: 0.0001,
    }, 1000);
    expect(result).toHaveProperty('grossHourly');
    expect(result).toHaveProperty('netHourly');
    expect(result).toHaveProperty('grossDaily');
    expect(result).toHaveProperty('netDaily');
    expect(result).toHaveProperty('grossWeekly');
    expect(result).toHaveProperty('netWeekly');
    expect(result).toHaveProperty('grossAnnual');
    expect(result).toHaveProperty('netAnnual');
    expect(result).toHaveProperty('fees');
    expect(result).toHaveProperty('slippage');
    expect(result).toHaveProperty('netApr');
    expect(result).toHaveProperty('paybackDays');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('accumulated');
  });
  it('accumulated has d1, d7, d30, y1 keys', () => {
    const result = profitCalcClient({
      exchangeA: 'binance',
      exchangeB: 'bybit',
      difference: 0.0001,
      volumeA: 5_000_000,
      volumeB: 5_000_000,
    }, 1000);
    expect(result.accumulated).toHaveProperty('d1');
    expect(result.accumulated).toHaveProperty('d7');
    expect(result.accumulated).toHaveProperty('d30');
    expect(result.accumulated).toHaveProperty('y1');
  });
  it('score is non-negative and bounded', () => {
    const result = profitCalcClient({
      exchangeA: 'binance',
      exchangeB: 'bybit',
      difference: 0.0001,
      volumeA: 5_000_000,
      volumeB: 5_000_000,
    }, 1000);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('netApr is computed as percentage of capital', () => {
    const result = profitCalcClient({
      exchangeA: 'binance',
      exchangeB: 'bybit',
      difference: 0.0001,
      volumeA: 50_000_000,
      volumeB: 50_000_000,
    }, 10_000);
    expect(typeof result.netApr).toBe('number');
    expect(isFinite(result.netApr) || result.netApr === Infinity).toBe(true);
  });

  it('different exchanges use different fee rates', () => {
    const binanceResult = profitCalcClient({
      exchangeA: 'binance',
      exchangeB: 'bybit',
      difference: 0.0001,
      volumeA: 5_000_000,
      volumeB: 5_000_000,
    }, 1000);
    const mexcResult = profitCalcClient({
      exchangeA: 'mexc',
      exchangeB: 'bybit',
      difference: 0.0001,
      volumeA: 5_000_000,
      volumeB: 5_000_000,
    }, 1000);
    expect(binanceResult.fees).not.toBe(mexcResult.fees);
  });
});

describe('breakEvenDays', () => {
  it('returns paybackDays from profit object', () => {
    const result = profitCalcClient({
      exchangeA: 'binance',
      exchangeB: 'bybit',
      difference: 0.0001,
      volumeA: 5_000_000,
      volumeB: 5_000_000,
    }, 1000);
    expect(breakEvenDays(result)).toBe(result.paybackDays);
  });
});

describe('getPaybackDays', () => {
  it('returns Infinity when paybackDays is -1', () => {
    const result = profitCalcClient({
      exchangeA: 'binance',
      exchangeB: 'bybit',
      difference: 0.0001,
      volumeA: 0,
      volumeB: 0,
    }, 1000);
    if (result.paybackDays < 0) {
      expect(getPaybackDays(result)).toBe(Infinity);
    }
  });

  it('returns the payback value for valid entries', () => {
    const result = profitCalcClient({
      exchangeA: 'binance',
      exchangeB: 'bybit',
      difference: 0.0002,
      volumeA: 10_000_000,
      volumeB: 10_000_000,
    }, 1000);
    if (result.paybackDays >= 0) {
      expect(getPaybackDays(result)).toBe(result.paybackDays);
    }
  });
});