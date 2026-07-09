import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { generateReferralLink, handleReferral, getUser } from '../services/paymentService.js';
import { prisma } from '../services/prisma.js';
import { logger } from '../utils/logger.js';

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
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.get('/referral/list', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const user = await getUser(userId);
    const referralCount = await prisma.user.count({ where: { referredBy: user.id } });
    res.json({
      ok: true,
      referrals: referralCount,
      bonusScans: user.trialScans,
    });
  } catch (e) {
    const error = e as Error;
    res.status(500).json({ ok: false, error: error.message });
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
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;
