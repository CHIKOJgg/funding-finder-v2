import { Router } from 'express';
import { prisma } from '../services/prisma.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.get('/profile', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Authentication required' });
    }

    const user = await prisma.user.findUnique({ where: { telegramId: userId } });
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
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
    return res.status(500).json({ ok: false, error: 'Failed to fetch profile' });
  }
});

export default router;
