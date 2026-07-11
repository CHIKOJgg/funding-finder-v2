import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { getSubscriptionLimits } from '../middleware/subscription.js';
import { validate } from '../middleware/validation.js';
import { logger } from '../utils/logger.js';

const router = Router();

const addSchema = z.object({
  exchange: z.string().min(1),
  pair: z.string().min(1),
});

// GET /api/watchlist — list the user's starred pairs.
router.get('/watchlist', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required' });

    const items = await prisma.watchlistItem.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

    return res.json({ ok: true, items });
  } catch (err) {
    logger.error({ err }, 'Watchlist fetch error');
    return res.status(500).json({ ok: false, error: 'Failed to fetch watchlist' });
  }
});

// POST /api/watchlist — star a pair (free tier limited).
router.post('/watchlist', validate(addSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required' });

    const { exchange, pair } = req.body;

    const existing = await prisma.watchlistItem.findUnique({
      where: { userId_exchange_pair: { userId, exchange, pair } },
    });
    if (existing) {
      return res.json({ ok: true, item: existing, alreadyAdded: true });
    }

    const limits = await getSubscriptionLimits(userId);
    if (limits.watchlistLimit >= 0) {
      const count = await prisma.watchlistItem.count({ where: { userId } });
      if (count >= limits.watchlistLimit) {
        return res.status(403).json({
          ok: false,
          error: 'Watchlist limit reached',
          limit: limits.watchlistLimit,
          requiredPlan: 'pro',
        });
      }
    }

    const item = await prisma.watchlistItem.create({ data: { userId, exchange, pair } });
    return res.json({ ok: true, item });
  } catch (err) {
    logger.error({ err }, 'Watchlist add error');
    return res.status(500).json({ ok: false, error: 'Failed to add to watchlist' });
  }
});

// DELETE /api/watchlist — unstar a pair.
router.delete('/watchlist', validate(addSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required' });

    const { exchange, pair } = req.body;
    await prisma.watchlistItem.deleteMany({ where: { userId, exchange, pair } });
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'Watchlist delete error');
    return res.status(500).json({ ok: false, error: 'Failed to remove from watchlist' });
  }
});

export default router;
