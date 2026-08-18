import { Router } from 'express';
import { prisma } from '../services/prisma.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { sendError } from '../middleware/errorHandler.js';
import { enforceSubscriptionExpiry } from '../middleware/subscription.js';

const router = Router();

router.get('/profile', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return sendError(res, 401, 'Authentication required', 'AUTH_REQUIRED');
    }

    const t0 = Date.now();
    await enforceSubscriptionExpiry(userId);
    console.log(`[PERF] profile enforceSubscriptionExpiry ${Date.now() - t0}ms`);
    const t1 = Date.now();
    const user = await prisma.user.findUnique({ where: { telegramId: userId } });
    console.log(`[PERF] profile findUnique ${Date.now() - t1}ms`);
    if ((req as any)._t0) console.log(`[PERF] profile:beforeResponse ${Date.now() - (req as any)._t0}ms`);
    if (!user) {
      return sendError(res, 404, 'User not found', 'USER_NOT_FOUND');
    }

    return res.json({
      ok: true,
      subscription: user.subscription,
      subscriptionExpiresAt: user.subscriptionExpiresAt,
      balance: user.balance,
      referralCode: user.referralCode,
      trialScans: user.trialScans,
      trialUsed: user.trialUsed,
      trialEndsAt: user.trialEndsAt,
      supportTelegram: user.subscription === 'proplus' ? '@fundinganalyzerbot' : undefined,
    });
  } catch (err) {
    logger.error({ err }, 'Profile fetch error');
    return sendError(res, 500, 'Failed to fetch profile', 'PROFILE_FETCH_ERROR');
  }
});

export default router;
