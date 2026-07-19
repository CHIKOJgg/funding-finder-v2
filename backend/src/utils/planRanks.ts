// Plan tier ranking shared by the subscription middleware and the payment
// service. Kept free of any Prisma/service imports so it can be used in the
// payment grant path without pulling in the (mocked) Prisma client.

export type PlanTier = 'free' | 'basic' | 'pro' | 'promax' | 'ultimate';

export const PLAN_HIERARCHY: Record<PlanTier, number> = {
  free: 0,
  basic: 1,
  pro: 2,
  promax: 3,
  ultimate: 99, // Admin tier — highest privilege
};

export function getPlanTier(subscription: string): PlanTier {
  if (subscription in PLAN_HIERARCHY) return subscription as PlanTier;
  return 'free';
}

/** Numeric rank of a plan tier (higher = more privileged). Unknown → free(0). */
export function planRank(plan: string): number {
  return PLAN_HIERARCHY[getPlanTier(plan)] ?? 0;
}
