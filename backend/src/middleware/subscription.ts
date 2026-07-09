import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.js';
import { prisma } from '../services/prisma.js';
import { logger } from '../utils/logger.js';

type PlanTier = 'free' | 'basic' | 'pro' | 'promax';

const PLAN_HIERARCHY: Record<PlanTier, number> = {
  free: 0,
  basic: 1,
  pro: 2,
  promax: 3,
};

const PLAN_LIMITS: Record<PlanTier, { maxExchanges: number; aiEnabled: boolean; recommendationsEnabled: boolean }> = {
  free: { maxExchanges: 1, aiEnabled: false, recommendationsEnabled: false },
  basic: { maxExchanges: 3, aiEnabled: false, recommendationsEnabled: false },
  pro: { maxExchanges: 5, aiEnabled: true, recommendationsEnabled: true },
  promax: { maxExchanges: 5, aiEnabled: true, recommendationsEnabled: true },
};

function getPlanTier(subscription: string): PlanTier {
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

/* validateExchangeCount is no longer exported — scan route uses getSubscriptionLimits inline */
