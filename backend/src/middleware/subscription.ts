import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.js';
import { prisma } from '../services/prisma.js';
import { logger } from '../utils/logger.js';
import { PLAN_HIERARCHY, PlanTier, getPlanTier, planRank } from '../utils/planRanks.js';

export { getPlanTier, planRank };

const PLAN_LIMITS: Record<PlanTier, {
  maxExchanges: number;
  aiEnabled: boolean;
  recommendationsEnabled: boolean;
  watchlistLimit: number; // -1 = unlimited
  portfolioEnabled: boolean;
}> = {
  // Free is the top-of-funnel hook, not a crippled demo: enough exchanges and
  // watchlist room to feel the product's value before hitting the paywall.
  // (Daily free AI tip is handled separately via `lastFreeAiAt`.)
  free: { maxExchanges: 8, aiEnabled: false, recommendationsEnabled: false, watchlistLimit: 10, portfolioEnabled: false },
  pro: { maxExchanges: 20, aiEnabled: true, recommendationsEnabled: true, watchlistLimit: -1, portfolioEnabled: true },
  proplus: { maxExchanges: 21, aiEnabled: true, recommendationsEnabled: true, watchlistLimit: -1, portfolioEnabled: true },
};

/** Trial duration in days. */
export const TRIAL_DURATION_DAYS = 3;

/** Days-before-expiry thresholds at which a reminder is sent (TG push). */
export const TRIAL_REMINDER_DAYS = [2, 1];

/** Paid subscription reminder thresholds, in days until expiry. */
export const SUBSCRIPTION_REMINDER_DAYS = [3, 1, 0];

/** Expire paid access and recover dates for legacy paid users. */
export async function enforceSubscriptionExpiry(userId: string): Promise<boolean> {
  try {
    let user = await prisma.user.findUnique({
      where: { telegramId: userId },
      select: { subscription: true, subscriptionExpiresAt: true },
    });
    if (!user || user.subscription === 'free') return false;

    // Existing paid users predate subscriptionExpiresAt. Infer a first expiry
    // from their latest paid order so the new reminder system works for them.
    if (!user.subscriptionExpiresAt) {
      const latestOrder = await prisma.order.findFirst({
        where: { userId, status: 'paid' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, billingPeriod: true },
      });
      if (latestOrder) {
        const days = latestOrder.billingPeriod === 'annual' ? 365 : 30;
        const expiresAt = new Date(latestOrder.createdAt.getTime() + days * 24 * 60 * 60 * 1000);
        user = await prisma.user.update({
          where: { telegramId: userId },
          data: { subscriptionExpiresAt: expiresAt, subscriptionReminderSent: 0 },
          select: { subscription: true, subscriptionExpiresAt: true },
        });
      }
    }

    if (user.subscriptionExpiresAt && user.subscriptionExpiresAt.getTime() <= Date.now()) {
      await prisma.user.update({
        where: { telegramId: userId },
        data: { subscription: 'free', subscriptionExpiresAt: null, subscriptionReminderSent: 0 },
      });
      logger.info({ userId }, 'Paid subscription expired');
      return true;
    }
  } catch (err) {
    logger.error({ err }, 'Paid subscription expiry enforcement failed');
  }
  return false;
}

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
      const paidOrder = await prisma.order.findFirst({
        where: { userId: userId, status: 'paid' },
        select: { id: true },
        take: 1,
      });
      if (paidOrder) return false;
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

      // Revert any trial-derived Pro whose window has elapsed before checking
      // the tier, so an expired trial can't pass a paid-feature gate.
      await enforceSubscriptionExpiry(userId);
      await enforceTrialExpiry(userId);
      user = await prisma.user.findUnique({ where: { telegramId: userId } }) ?? user;

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
  await enforceSubscriptionExpiry(userId);
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
