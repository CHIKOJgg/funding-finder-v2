import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.js';
import { prisma } from '../services/prisma.js';
import { logger } from '../utils/logger.js';
import { PLAN_HIERARCHY, PlanTier, getPlanTier, planRank } from '../utils/planRanks.js';

export { getPlanTier, planRank };

// In-memory cache of a user's effective subscription (after expiry/trial
// enforcement). Collapses the 4 DB reads that `requireSubscription` and
// `getSubscriptionLimits` performed on EVERY gated request (findUnique + enforce
// expiry + enforce trial + re-read) into a single read per SUB_CACHE_TTL_MS
// window. Busted explicitly on plan changes (see clearSubscriptionCache) so a
// just-paid upgrade is reflected immediately, and self-heals after the TTL for
// the rare downgrade case.
const SUB_CACHE_TTL_MS = 30_000;
const subCache = new Map<string, { user: any; cachedAt: number }>();

/** Drop any cached subscription state for a user (call after plan changes). */
export function clearSubscriptionCache(userId: string): void {
  subCache.delete(userId);
}

/**
 * Resolve the user (creating the row if missing) and run expiry/trial
 * enforcement, returning the post-enforcement user. Cached per-user for
 * SUB_CACHE_TTL_MS to avoid hammering the DB on every gated request.
 */
async function resolveSubscriptionUser(userId: string): Promise<any> {
  const cached = subCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < SUB_CACHE_TTL_MS) {
    return cached.user;
  }
  let user = await prisma.user.findUnique({ where: { telegramId: userId } }).catch(() => null);
  if (!user) {
    user = await prisma.user.create({ data: { telegramId: userId, lastActive: new Date() } }).catch(() => null);
  }
  await enforceSubscriptionExpiry(userId).catch(() => {});
  await enforceTrialExpiry(userId).catch(() => {});
  user = (await prisma.user.findUnique({ where: { telegramId: userId } }).catch(() => null)) ?? user;
  const safeUser = user || { telegramId: userId, subscription: 'free' };
  subCache.set(userId, { user: safeUser, cachedAt: Date.now() });
  return safeUser;
}

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
  free: { maxExchanges: 4, aiEnabled: false, recommendationsEnabled: false, watchlistLimit: 10, portfolioEnabled: false },
  pro: { maxExchanges: 12, aiEnabled: true, recommendationsEnabled: true, watchlistLimit: -1, portfolioEnabled: true },
  proplus: { maxExchanges: 31, aiEnabled: true, recommendationsEnabled: true, watchlistLimit: -1, portfolioEnabled: true },
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

      // Cached: a single read per SUB_CACHE_TTL_MS window instead of 4 reads.
      const user = await resolveSubscriptionUser(userId);
      const sub = (req as any).user?.subscription || (req as any).user?.plan || user?.subscription || 'free';
      const userTier = getPlanTier(sub);

      if (PLAN_HIERARCHY[userTier] < PLAN_HIERARCHY[minimumTier]) {
        return res.status(403).json({
          ok: false,
          error: `This feature requires ${minimumTier} subscription or higher`,
          currentPlan: sub,
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
  const user = await resolveSubscriptionUser(userId);
  const tier = getPlanTier(user?.subscription || 'free');
  return { tier, ...PLAN_LIMITS[tier] };
}

export function getPlanLimitsForTier(tier: string) {
  const planTier = getPlanTier(tier);
  return PLAN_LIMITS[planTier];
}

/* validateExchangeCount is no longer exported — scan route uses getSubscriptionLimits inline */