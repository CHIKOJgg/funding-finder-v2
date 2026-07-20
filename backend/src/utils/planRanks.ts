// Plan tier ranking shared by the subscription middleware and the payment
// service. Kept free of any Prisma/service imports so it can be used in the
// payment grant path without pulling in the (mocked) Prisma client.

export type PlanTier = 'free' | 'pro' | 'proplus';

// Consolidated to 3 tiers (CMO: 5 was choice paralysis, and the old entry
// price was too high). Legacy values are mapped so existing DB rows / webhooks
// keep working without a migration.
export const PLAN_HIERARCHY: Record<PlanTier, number> = {
  free: 0,
  pro: 1,
  proplus: 2,
};

const LEGACY_TO_TIER: Record<string, PlanTier> = {
  basic: 'pro',
  promax: 'proplus',
  ultimate: 'proplus',
};

export function getPlanTier(subscription: string): PlanTier {
  if (subscription in PLAN_HIERARCHY) return subscription as PlanTier;
  if (subscription in LEGACY_TO_TIER) return LEGACY_TO_TIER[subscription];
  return 'free';
}

/** Numeric rank of a plan tier (higher = more privileged). Unknown → free(0). */
export function planRank(plan: string): number {
  return PLAN_HIERARCHY[getPlanTier(plan)] ?? 0;
}
