import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.js';
import { prisma } from '../services/prisma.js';
import { logger } from '../utils/logger.js';

type PlanTier = 'free' | 'basic' | 'pro' | 'promax' | 'ultimate';

const PLAN_HIERARCHY: Record<PlanTier, number> = {
  free: 0,
  basic: 1,
  pro: 2,
  promax: 3,
  ultimate: 99, // Admin tier — highest privilege
};

const PLAN_LIMITS: Record<PlanTier, {
  maxExchanges: number;
  aiEnabled: boolean;
  recommendationsEnabled: boolean;
  watchlistLimit: number; // -1 = unlimited
  portfolioEnabled: boolean;
}> = {
  free: { maxExchanges: 3, aiEnabled: false, recommendationsEnabled: false, watchlistLimit: 3, portfolioEnabled: false },
  basic: { maxExchanges: 5, aiEnabled: false, recommendationsEnabled: false, watchlistLimit: 3, portfolioEnabled: false },
  pro: { maxExchanges: 12, aiEnabled: true, recommendationsEnabled: true, watchlistLimit: -1, portfolioEnabled: true },
  promax: { maxExchanges: 20, aiEnabled: true, recommendationsEnabled: true, watchlistLimit: -1, portfolioEnabled: true },
  ultimate: { maxExchanges: 25, aiEnabled: true, recommendationsEnabled: true, watchlistLimit: -1, portfolioEnabled: true },
};

/** Trial duration in days. */
export const TRIAL_DURATION_DAYS = 3;

/**
 * If the user is on a trial-derived "pro" plan whose trial window has elapsed,
 * revert them to the free plan. Returns true when a reset happened.
 */
export async function enforceTrialExpiry(userId: string): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      where: { telegramId: userId },
      select: { subscription: true, trialEndsAt: true },
    });
    if (
      user &&
      user.subscription === 'pro' &&
      user.trialEndsAt &&
      user.trialEndsAt.getTime() <= Date.now()
    ) {
      await prisma.user.update({
        where: { telegramId: userId },
        data: { subscription: 'free', trialEndsAt: null },
      });
      return true;
    }
  } catch (err) {
    logger.error({ err }, 'Trial expiry enforcement failed');
  }
  return false;
}

export function getPlanTier(subscription: string): PlanTier {
  if (subscription in PLAN_HIERARCHY) return subscription as PlanTier;
  return 'free';
}

export function requireSubscription(minimumTier: PlanTier) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: 'Authentication required' });
      }

      let user = await prisma.user.findUnique({ where: { telegramId: userId } });
      if (!user) {
        user = await prisma.user.create({
          data: { telegramId: userId, lastActive: new Date() },
        });
      }

      const userTier = getPlanTier(user.subscription);
      if (PLAN_HIERARCHY[userTier] < PLAN_HIERARCHY[minimumTier]) {
        return res.status(403).json({
          ok: false,
          error: `This feature requires ${minimumTier} subscription or higher`,
          currentPlan: user.subscription,
          requiredPlan: minimumTier,
        });
      }

      next();
    } catch (err) {
      logger.error({ err }, 'Subscription check failed');
      return res.status(500).json({ ok: false, error: 'Subscription verification failed' });
    }
  };
}

export async function getSubscriptionLimits(userId: string) {
  const user = await prisma.user.findUnique({ where: { telegramId: userId } });
  if (!user) {
    return { tier: 'free', ...PLAN_LIMITS.free };
  }
  const tier = getPlanTier(user.subscription);
  return { tier, ...PLAN_LIMITS[tier] };
}

export function getPlanLimitsForTier(tier: string) {
  const planTier = getPlanTier(tier);
  return PLAN_LIMITS[planTier];
}

/* validateExchangeCount is no longer exported — scan route uses getSubscriptionLimits inline */
