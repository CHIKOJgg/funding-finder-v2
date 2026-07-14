import { Router } from 'express';
import { prisma } from '../services/prisma.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { enforceTrialExpiry, TRIAL_DURATION_DAYS } from '../middleware/subscription.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Activate the free Pro trial (one-time).
router.post('/trial/activate', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Authentication required' });
    }

    const user = await prisma.user.findUnique({ where: { telegramId: userId } });
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    if (user.trialUsed) {
      // Idempotent: if the trial is already active (a prior press succeeded
      // server-side but the client saw a timeout/error), treat the re-press as
      // a success instead of rejecting it with 409.
      if (user.subscription === 'pro') {
        const endsAt = user.trialEndsAt ? user.trialEndsAt.getTime() : null;
        const msLeft = endsAt ? Math.max(0, endsAt - Date.now()) : 0;
        return res.json({
          ok: true,
          active: true,
          endsAt: user.trialEndsAt,
          daysLeft: endsAt ? Math.ceil(msLeft / (24 * 60 * 60 * 1000)) : 0,
          hoursLeft: Math.floor(msLeft / (60 * 60 * 1000)),
        });
      }
      return res.status(409).json({ ok: false, error: 'Trial already used' });
    }

    if (user.subscription === 'pro') {
      return res.status(409).json({ ok: false, error: 'Already on Pro plan' });
    }

    const endsAt = new Date(Date.now() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);

    const updated = await prisma.user.update({
      where: { telegramId: userId },
      data: { subscription: 'pro', trialUsed: true, trialEndsAt: endsAt },
    });

    return res.json({
      ok: true,
      active: true,
      endsAt: updated.trialEndsAt,
      daysLeft: TRIAL_DURATION_DAYS,
    });
  } catch (err) {
    const error = err as Error;
    logger.error({ err: error }, 'Trial activation error');
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Current trial status (also reflects expiry-driven downgrade).
router.get('/trial/status', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Authentication required' });
    }

    await enforceTrialExpiry(userId);

    const user = await prisma.user.findUnique({
      where: { telegramId: userId },
      select: { subscription: true, trialUsed: true, trialEndsAt: true },
    });
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const active = user.subscription === 'pro' && user.trialEndsAt !== null && user.trialEndsAt.getTime() > Date.now();
    const now = Date.now();
    const endsAt = user.trialEndsAt ? user.trialEndsAt.getTime() : null;
    const msLeft = endsAt ? Math.max(0, endsAt - now) : 0;
    const daysLeft = endsAt ? Math.ceil(msLeft / (24 * 60 * 60 * 1000)) : 0;

    return res.json({
      ok: true,
      active,
      used: user.trialUsed,
      endsAt: user.trialEndsAt,
      daysLeft,
      hoursLeft: Math.floor(msLeft / (60 * 60 * 1000)),
    });
  } catch (err) {
    const error = err as Error;
    logger.error({ err: error }, 'Trial status error');
    return res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;
