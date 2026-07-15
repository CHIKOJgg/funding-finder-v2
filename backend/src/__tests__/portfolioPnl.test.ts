import { calcFundingIncome, sideSign, PnlInput } from '../services/portfolioPnl.js';

describe('portfolioPnl', () => {
  // Crypto perpetual convention: a positive funding rate means longs PAY shorts.
  // So a long's funding income is negative when the rate is positive, and a
  // short's is positive. sideSign encodes this: long -> -1, short -> +1.
  it('sideSign maps long->-1 and short->+1', () => {
    expect(sideSign('long')).toBe(-1);
    expect(sideSign('short')).toBe(1);
  });

  it('computes accumulated funding cost for a long paying positive funding', () => {
    const openedAt = 1_000_000;
    const now = openedAt + 10 * 3600 * 1000; // 10 hours held
    const input: PnlInput = {
      side: 'long',
      sizeUsd: 1000,
      leverage: 2,
      ratePerHour: 0.0001,
      openedAtMs: openedAt,
      nowMs: now,
    };
    const r = calcFundingIncome(input);
    expect(r.hoursHeld).toBeCloseTo(10, 5);
    // notional = 1000 * 2 = 2000; 0.0001 * 2000 * 10 = 2 USD, long PAYS -> -2
    expect(r.fundingIncome).toBeCloseTo(-2, 6);
    expect(r.annualizedPct).toBeCloseTo(-0.0001 * 24 * 365 * 100, 4);
    expect(r.projectedYearly).toBeCloseTo(-0.0001 * 2000 * 24 * 365, 4);
  });

  it('credits income for a short receiving positive funding', () => {
    const input: PnlInput = {
      side: 'short',
      sizeUsd: 1000,
      leverage: 1,
      ratePerHour: 0.0002,
      openedAtMs: 0,
      nowMs: 3600 * 1000, // 1 hour
    };
    const r = calcFundingIncome(input);
    expect(r.fundingIncome).toBeCloseTo(0.2, 6);
    expect(r.annualizedPct).toBeGreaterThan(0);
  });

  it('clamps hoursHeld to zero for a future open time', () => {
    const r = calcFundingIncome({
      side: 'long',
      sizeUsd: 500,
      leverage: 1,
      ratePerHour: 0.0001,
      openedAtMs: 10_000,
      nowMs: 5_000,
    });
    expect(r.hoursHeld).toBe(0);
    expect(r.fundingIncome).toBe(0);
  });

  it('defaults nowMs to Date.now() without throwing', () => {
    const r = calcFundingIncome({
      side: 'long',
      sizeUsd: 100,
      leverage: 1,
      ratePerHour: 0.0001,
      openedAtMs: Date.now() - 3600 * 1000,
    });
    expect(r.hoursHeld).toBeGreaterThan(0);
  });
});
