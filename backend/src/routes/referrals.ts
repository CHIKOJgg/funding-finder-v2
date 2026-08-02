import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { generateReferralLink, handleReferral, getUser } from '../services/paymentService.js';
import { prisma } from '../services/prisma.js';
import { logger } from '../utils/logger.js';
import { sendError } from '../middleware/errorHandler.js';

const router = Router();

const applyReferralSchema = z.object({
  referralCode: z.string().min(1),
});

router.get('/referral/link', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const link = await generateReferralLink(userId);
    res.json({ ok: true, link });
  } catch (e) {
    const error = e as Error;
    sendError(res, 500, 'Failed to generate referral link', 'REFERRALS_LINK_ERROR');
  }
});

router.get('/referral/list', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const user = await getUser(userId);
    const referralCount = await prisma.user.count({ where: { referredBy: user.id } });
    // Order.userId stores the USER'S identity key (telegramId, e.g. tg_123 or
    // wallet_0x...), NOT the User.id cuid — query by telegramId.
    const paidReferrals = await prisma.order.count({
      where: { userId: user.telegramId, status: 'paid', referralCredited: true },
    });
    res.json({
      ok: true,
      referrals: referralCount,
      paidReferrals,
      earnings: user.balance,
      bonusRate: 0.2,
      referralLink: await generateReferralLink(userId),
      bonusScans: user.trialScans,
    });
  } catch (e) {
    const error = e as Error;
    sendError(res, 500, 'Failed to fetch referral list', 'REFERRALS_LIST_ERROR');
  }
});

router.post('/referral/apply', validate(applyReferralSchema), async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const { referralCode } = req.body;
    const success = await handleReferral(userId, referralCode);
    res.json({
      ok: success,
      message: success ? 'Реферал применен' : 'Неверный код',
    });
  } catch (e) {
    const error = e as Error;
    sendError(res, 500, 'Failed to apply referral', 'REFERRALS_APPLY_ERROR');
  }
});

export default router;
