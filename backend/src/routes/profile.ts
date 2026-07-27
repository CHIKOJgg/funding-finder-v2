import { Router } from 'express';
import { prisma } from '../services/prisma.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { sendError } from '../middleware/errorHandler.js';

const router = Router();

router.get('/profile', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return sendError(res, 401, 'Authentication required', 'AUTH_REQUIRED');
    }

    const user = await prisma.user.findUnique({ where: { telegramId: userId } });
    if (!user) {
      return sendError(res, 404, 'User not found', 'USER_NOT_FOUND');
    }

    return res.json({
      ok: true,
      subscription: user.subscription,
      balance: user.balance,
      referralCode: user.referralCode,
      trialScans: user.trialScans,
      trialUsed: user.trialUsed,
      trialEndsAt: user.trialEndsAt,
    });
  } catch (err) {
    logger.error({ err }, 'Profile fetch error');
    return sendError(res, 500, 'Failed to fetch profile', 'PROFILE_FETCH_ERROR');
  }
});

export default router;
