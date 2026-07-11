import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { requireSubscription } from '../middleware/subscription.js';
import { validate } from '../middleware/validation.js';
import { calcFundingIncome } from '../services/portfolioPnl.js';
import { logger } from '../utils/logger.js';

const router = Router();

const createSchema = z.object({
  exchange: z.string().min(1),
  pair: z.string().min(1),
  side: z.enum(['long', 'short']).default('long'),
  sizeUsd: z.number().positive().max(1_000_000_000),
  leverage: z.number().positive().max(1000).default(1),
});

const deleteSchema = z.object({
  id: z.string().min(1),
});

// Resolve the latest known hourly funding rate for a pair from history.
async function getLatestRatePerHour(exchange: string, pair: string): Promise<number> {
  try {
    const history = await prisma.fundingHistory.findUnique({
      where: { key: `${exchange}:${pair}` },
      include: { records: { orderBy: { timestamp: 'desc' }, take: 1 } },
    });
    if (history && history.records.length > 0) {
      const funding = history.records[0].funding;
      // Assume standard 8h settlement when interval is unknown.
      return funding / 8;
    }
  } catch (err) {
    logger.debug({ err: (err as Error).message }, 'Portfolio rate lookup failed');
  }
  return 0;
}

// GET /api/portfolio — Pro only. Lists positions with simulated PnL.
router.get('/portfolio', requireSubscription('pro'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required' });

    const positions = await prisma.portfolioPosition.findMany({
      where: { userId, closedAt: null },
      orderBy: { openedAt: 'desc' },
    });

    const enriched = await Promise.all(
      positions.map(async (p) => {
        const ratePerHour = await getLatestRatePerHour(p.exchange, p.pair);
        const pnl = calcFundingIncome({
          side: p.side as 'long' | 'short',
          sizeUsd: p.sizeUsd,
          leverage: p.leverage,
          ratePerHour,
          openedAtMs: p.openedAt.getTime(),
        });
        return { ...p, ratePerHour, pnl };
      })
    );

    return res.json({ ok: true, positions: enriched });
  } catch (err) {
    logger.error({ err }, 'Portfolio fetch error');
    return res.status(500).json({ ok: false, error: 'Failed to fetch portfolio' });
  }
});

// POST /api/portfolio — Pro only. Add a paper position.
router.post('/portfolio', requireSubscription('pro'), validate(createSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required' });

    const { exchange, pair, side, sizeUsd, leverage } = req.body;
    const position = await prisma.portfolioPosition.create({
      data: { userId, exchange, pair, side, sizeUsd, leverage },
    });
    return res.json({ ok: true, position });
  } catch (err) {
    logger.error({ err }, 'Portfolio add error');
    return res.status(500).json({ ok: false, error: 'Failed to add position' });
  }
});

// DELETE /api/portfolio — Pro only. Remove a paper position.
router.delete('/portfolio', requireSubscription('pro'), validate(deleteSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required' });

    await prisma.portfolioPosition.deleteMany({ where: { id: req.body.id, userId } });
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'Portfolio delete error');
    return res.status(500).json({ ok: false, error: 'Failed to remove position' });
  }
});

export default router;
