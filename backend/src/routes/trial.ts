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

    // Atomic conditional update: only succeeds if trialUsed is still false.
    // This prevents two concurrent requests from both activating the trial.
    const endsAt = new Date(Date.now() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);
    const updated = await prisma.user.update({
      where: { telegramId: userId, trialUsed: false },
      data: { subscription: 'pro', trialUsed: true, trialEndsAt: endsAt },
    });

    return res.json({
      ok: true,
      active: true,
      endsAt: updated.trialEndsAt,
      daysLeft: TRIAL_DURATION_DAYS,
    });
  } catch (err: any) {
    if (err?.code === 'P2025') {
      // No row matched — trialUsed is already true or user not found.
      // Idempotent: if they're already Pro with an active trial, treat
      // re-presses as success (client may have timed out after a prior success).
      const user = await prisma.user.findUnique({
        where: { telegramId: req.userId! },
        select: { subscription: true, trialEndsAt: true },
      });
      if (user?.subscription === 'pro') {
        const endsAtMs = user.trialEndsAt ? user.trialEndsAt.getTime() : null;
        const msLeft = endsAtMs ? Math.max(0, endsAtMs - Date.now()) : 0;
        return res.json({
          ok: true,
          active: true,
          endsAt: user.trialEndsAt,
          daysLeft: endsAtMs ? Math.ceil(msLeft / (24 * 60 * 60 * 1000)) : 0,
          hoursLeft: Math.floor(msLeft / (60 * 60 * 1000)),
        });
      }
      return res.status(409).json({ ok: false, error: 'Trial already used' });
    }
    logger.error({ err }, 'Trial activation error');
    return res.status(500).json({ ok: false, error: err?.message || 'Internal error' });
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
