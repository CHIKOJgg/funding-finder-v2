export type PlanTier = 'free' | 'pro' | 'proplus';

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
  free: { maxExchanges: 5, aiEnabled: false, recommendationsEnabled: false, watchlistLimit: 10, portfolioEnabled: false, label: 'Free' },
  pro: { maxExchanges: 15, aiEnabled: true, recommendationsEnabled: true, watchlistLimit: -1, portfolioEnabled: true, label: 'Pro' },
  proplus: { maxExchanges: 31, aiEnabled: true, recommendationsEnabled: true, watchlistLimit: -1, portfolioEnabled: true, label: 'Pro+' },
};

const PLAN_ORDER: PlanTier[] = ['free', 'pro', 'proplus'];

export function planRank(tier: string | undefined): number {
  const idx = PLAN_ORDER.indexOf((tier as PlanTier) || 'free');
  return idx < 0 ? 0 : idx;
}

export function getPlanLimits(subscription: string | undefined): PlanLimits {
  const tier = (subscription as PlanTier) in PLAN_LIMITS ? (subscription as PlanTier) : 'free';
  return PLAN_LIMITS[tier];
}

export type PaywallFeature = 'exchanges' | 'ai' | 'recommendations' | 'portfolio' | 'watchlist';

export const TRIAL_DURATION_DAYS = 3;

// Зеркало цен из backend/src/services/paymentService.ts (годовая = -20%).
export const PLAN_PRICES: Record<Exclude<PlanTier, 'free'>, { monthly: number; annual: number }> = {
  pro: { monthly: 29, annual: Math.round(29 * 12 * 0.8) },
  proplus: { monthly: 79, annual: Math.round(79 * 12 * 0.8) },
};

export const ANNUAL_DISCOUNT_PCT = 20;
