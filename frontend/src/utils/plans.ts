export type PlanTier = 'free' | 'basic' | 'pro' | 'promax' | 'ultimate';

export interface PlanLimits {
  maxExchanges: number;
  aiEnabled: boolean;
  recommendationsEnabled: boolean;
  /** Человекочитаемое имя самого доступного плана, открывающего фичу */
  label: string;
}

// Зеркало PLAN_LIMITS из backend/src/middleware/subscription.ts
export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: { maxExchanges: 1, aiEnabled: false, recommendationsEnabled: false, label: 'Free' },
  basic: { maxExchanges: 3, aiEnabled: false, recommendationsEnabled: false, label: 'Basic' },
  pro: { maxExchanges: 5, aiEnabled: true, recommendationsEnabled: true, label: 'Pro' },
  promax: { maxExchanges: 5, aiEnabled: true, recommendationsEnabled: true, label: 'Pro Max' },
  ultimate: { maxExchanges: 5, aiEnabled: true, recommendationsEnabled: true, label: 'Ultimate' },
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

export type PaywallFeature = 'exchanges' | 'ai' | 'recommendations';
