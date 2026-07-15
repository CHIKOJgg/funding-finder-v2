import { describe, it, expect } from 'vitest';
import { calcFundingIncome, sideSign } from '../../../backend/src/services/portfolioPnl';

describe('calcFundingIncome (PnL simulation)', () => {
  // Perpetual convention: positive funding rate => longs PAY shorts. A long's
  // funding income is therefore negative when the rate is positive.
  it('long position pays funding when rate is positive', () => {
    const result = calcFundingIncome({
      side: 'long',
      sizeUsd: 1000,
      leverage: 2,
      ratePerHour: 0.0001, // 0.01%/h
      openedAtMs: Date.now() - 10 * 60 * 60 * 1000, // 10h ago
      nowMs: Date.now(),
    });
    expect(result.hoursHeld).toBeCloseTo(10, 5);
    // notional = 1000 * 2 = 2000; 0.0001 * 2000 * 10 = 2 USD paid -> -2.0
    expect(result.fundingIncome).toBeCloseTo(-2, 5);
    expect(result.fundingIncome).toBeLessThan(0);
    expect(result.annualizedPct).toBeCloseTo(-0.0001 * 24 * 365 * 100, 2); // ~-8.76%
  });

  it('short position receives funding when rate is positive', () => {
    const result = calcFundingIncome({
      side: 'short',
      sizeUsd: 1000,
      leverage: 1,
      ratePerHour: 0.0001,
      openedAtMs: Date.now() - 5 * 60 * 60 * 1000,
      nowMs: Date.now(),
    });
    expect(result.fundingIncome).toBeCloseTo(1000 * 0.0001 * 5, 5); // +0.5 USD
    expect(result.fundingIncome).toBeGreaterThan(0);
  });

  it('clamps hoursHeld to zero for future open times', () => {
    const result = calcFundingIncome({
      side: 'long',
      sizeUsd: 500,
      leverage: 1,
      ratePerHour: 0.001,
      openedAtMs: Date.now() + 1000,
      nowMs: Date.now(),
    });
    expect(result.hoursHeld).toBe(0);
    expect(result.fundingIncome).toBe(0);
  });

  it('sideSign maps long to -1 and short to +1', () => {
    expect(sideSign('long')).toBe(-1);
    expect(sideSign('short')).toBe(1);
  });

  it('projectedYearly scales linearly with size', () => {
    const small = calcFundingIncome({ side: 'long', sizeUsd: 100, leverage: 1, ratePerHour: 0.0002, openedAtMs: 0, nowMs: 0 });
    const big = calcFundingIncome({ side: 'long', sizeUsd: 1000, leverage: 1, ratePerHour: 0.0002, openedAtMs: 0, nowMs: 0 });
    expect(big.projectedYearly).toBeCloseTo(small.projectedYearly * 10, 5);
  });
});
