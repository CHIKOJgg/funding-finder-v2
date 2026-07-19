export type PlanTier = 'free' | 'basic' | 'pro' | 'promax' | 'ultimate';

export interface PlanLimits {
  maxExchanges: number;
  aiEnabled: boolean;
  recommendationsEnabled: boolean;
  /** Max starred pairs; -1 means unlimited */
  watchlistLimit: number;
  /** Симулятор портфеля (Paper PnL) */
  portfolioEnabled: boolean;
  /** Человекочитаемое имя самого доступного плана, открывающего фичу */
  label: string;
}

// Зеркало PLAN_LIMITS из backend/src/middleware/subscription.ts
export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: { maxExchanges: 3, aiEnabled: false, recommendationsEnabled: false, watchlistLimit: 3, portfolioEnabled: false, label: 'Free' },
  basic: { maxExchanges: 5, aiEnabled: true, recommendationsEnabled: true, watchlistLimit: 3, portfolioEnabled: false, label: 'Basic' },
  pro: { maxExchanges: 12, aiEnabled: true, recommendationsEnabled: true, watchlistLimit: -1, portfolioEnabled: true, label: 'Pro' },
  promax: { maxExchanges: 20, aiEnabled: true, recommendationsEnabled: true, watchlistLimit: -1, portfolioEnabled: true, label: 'Pro Max' },
  ultimate: { maxExchanges: 25, aiEnabled: true, recommendationsEnabled: true, watchlistLimit: -1, portfolioEnabled: true, label: 'Ultimate' },
};

const PLAN_ORDER: PlanTier[] = ['free', 'basic', 'pro', 'promax', 'ultimate'];

export function planRank(tier: string | undefined): number {
  const idx = PLAN_ORDER.indexOf((tier as PlanTier) || 'free');
  return idx < 0 ? 0 : idx;
}

export function getPlanLimits(subscription: string | undefined): PlanLimits {
  const tier = (subscription as PlanTier) in PLAN_LIMITS ? (subscription as PlanTier) : 'free';
  return PLAN_LIMITS[tier];
}

export type PaywallFeature = 'exchanges' | 'ai' | 'recommendations' | 'portfolio' | 'watchlist';

export const TRIAL_DURATION_DAYS = 7;

// Зеркало цен из backend/src/services/paymentService.ts (годовая = -20%).
export const PLAN_PRICES: Record<Exclude<PlanTier, 'free'>, { monthly: number; annual: number }> = {
  basic: { monthly: 29, annual: Math.round(29 * 12 * 0.8) },
  pro: { monthly: 99, annual: Math.round(99 * 12 * 0.8) },
  promax: { monthly: 499, annual: Math.round(499 * 12 * 0.8) },
  ultimate: { monthly: 999, annual: Math.round(999 * 12 * 0.8) },
};

export const ANNUAL_DISCOUNT_PCT = 20;
