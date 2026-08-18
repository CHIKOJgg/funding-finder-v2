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

const PLAN_LIMITS: Record<PlanTier, {\n  maxExchanges: number;\n  aiEnabled: boolean;\n  recommendationsEnabled: boolean;\n  watchlistLimit: number; // -1 = unlimited\n  portfolioEnabled: boolean;\n}> = {\n  // Free is the top-of-funnel hook, not a crippled demo: enough exchanges and\n  // watchlist room to feel the product's value before hitting the paywall.\n  // (Daily free AI tip is handled separately via `lastFreeAiAt`.)\n  free: { maxExchanges: 4, aiEnabled: false, recommendationsEnabled: false, watchlistLimit: 10, portfolioEnabled: false },\n  pro: { maxExchanges: 9, aiEnabled: true, recommendationsEnabled: true, watchlistLimit: -1, portfolioEnabled: true },\n  proplus: { maxExchanges: 21, aiEnabled: true, recommendationsEnabled: true, watchlistLimit: -1, portfolioEnabled: true },\n};\n\n/** Trial duration in days. */\nexport const TRIAL_DURATION_DAYS = 3;\n\n/** Days-before-expiry thresholds at which a reminder is sent (TG push). */\nexport const TRIAL_REMINDER_DAYS = [2, 1];\n\n/** Paid subscription reminder thresholds, in days until expiry. */\nexport const SUBSCRIPTION_REMINDER_DAYS = [3, 1, 0];\n\n/** Expire paid access and recover dates for legacy paid users. */\nexport async function enforceSubscriptionExpiry(userId: string): Promise<boolean> {\n  try {\n    let user = await prisma.user.findUnique({\n      where: { telegramId: userId },\n      select: { subscription: true, subscriptionExpiresAt: true },\n    });\n    if (!user || user.subscription === 'free') return false;\n\n    // Existing paid users predate subscriptionExpiresAt. Infer a first expiry\n    // from their latest paid order so the new reminder system works for them.\n    if (!user.subscriptionExpiresAt) {\n      const latestOrder = await prisma.order.findFirst({\n        where: { userId, status: 'paid' },\n        orderBy: { createdAt: 'desc' },\n        select: { createdAt: true, billingPeriod: true },\n      });\n      if (latestOrder) {\n        const days = latestOrder.billingPeriod === 'annual' ? 365 : 30;\n        const expiresAt = new Date(latestOrder.createdAt.getTime() + days * 24 * 60 * 60 * 1000);\n        user = await prisma.user.update({\n          where: { telegramId: userId },\n          data: { subscriptionExpiresAt: expiresAt, subscriptionReminderSent: 0 },\n          select: { subscription: true, subscriptionExpiresAt: true },\n        });\n      }\n    }\n\n    if (user.subscriptionExpiresAt && user.subscriptionExpiresAt.getTime() <= Date.now()) {\n      await prisma.user.update({\n        where: { telegramId: userId },\n        data: { subscription: 'free', subscriptionExpiresAt: null, subscriptionReminderSent: 0 },\n      });\n      logger.info({ userId }, 'Paid subscription expired');\n      return true;\n    }\n  } catch (err) {\n    logger.error({ err }, 'Paid subscription expiry enforcement failed');\n  }\n  return false;\n}\n\n/**\n * If the user is on a trial-derived \"pro\" plan whose trial window has elapsed,\n * revert them to the free plan. Returns true when a reset happened.\n */\nexport async function enforceTrialExpiry(userId: string): Promise<boolean> {\n  try {\n    const user = await prisma.user.findUnique({\n      where: { telegramId: userId },\n      select: { subscription: true, trialEndsAt: true },\n    });\n    if (\n      user &&\n      user.subscription === 'pro' &&\n      user.trialEndsAt &&\n      user.trialEndsAt.getTime() <= Date.now()\n    ) {\n      const paidOrder = await prisma.order.findFirst({\n        where: { userId: userId, status: 'paid' },\n        select: { id: true },\n        take: 1,\n      });\n      if (paidOrder) return false;\n      await prisma.user.update({\n        where: { telegramId: userId },\n        data: { subscription: 'free', trialEndsAt: null },\n      });\n      return true;\n    }\n  } catch (err) {\n    logger.error({ err }, 'Trial expiry enforcement failed');\n  }\n  return false;\n}\n\nexport function requireSubscription(minimumTier: PlanTier) {\n  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {\n    try {\n      const userId = req.userId;\n      if (!userId) {\n        return res.status(401).json({ ok: false, error: 'Authentication required' });\n      }\n\n      // Cached: a single read per SUB_CACHE_TTL_MS window instead of 4 reads.\n      const user = await resolveSubscriptionUser(userId);\n      const sub = (req as any).user?.subscription || (req as any).user?.plan || user?.subscription || 'free';\n      const userTier = getPlanTier(sub);\n\n      if (PLAN_HIERARCHY[userTier] < PLAN_HIERARCHY[minimumTier]) {\n        return res.status(403).json({\n          ok: false,\n          error: `This feature requires ${minimumTier} subscription or higher`,\n          currentPlan: sub,\n          requiredPlan: minimumTier,\n        });\n      }\n\n      next();\n    } catch (err) {\n      logger.error({ err }, 'Subscription check failed');\n      return res.status(500).json({ ok: false, error: 'Subscription verification failed' });\n    }\n  };\n}\n\nexport async function getSubscriptionLimits(userId: string) {\n  const user = await resolveSubscriptionUser(userId);\n  const tier = getPlanTier(user?.subscription || 'free');\n  return { tier, ...PLAN_LIMITS[tier] };\n}\n\nexport function getPlanLimitsForTier(tier: string) {\n  const planTier = getPlanTier(tier);\n  return PLAN_LIMITS[planTier];\n}\n