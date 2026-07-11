import { describe, it, expect } from 'vitest';
import { getPlanLimits, PlanTier } from '../utils/plans';

describe('plan limits (monetization)', () => {
  it('free tier limits watchlist to 3 and disables portfolio', () => {
    const free = getPlanLimits('free');
    expect(free.watchlistLimit).toBe(3);
    expect(free.portfolioEnabled).toBe(false);
  });

  it('pro tier has unlimited watchlist and portfolio enabled', () => {
    const pro = getPlanLimits('pro');
    expect(pro.watchlistLimit).toBe(-1);
    expect(pro.portfolioEnabled).toBe(true);
  });

  it('unknown tier falls back to free', () => {
    const fallback = getPlanLimits('nonexistent' as PlanTier);
    expect(fallback.label).toBe('Free');
  });
});
