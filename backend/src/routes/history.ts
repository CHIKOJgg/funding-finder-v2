import { Router } from 'express';
import { prisma } from '../services/prisma.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.get('/history/:exchange/:contract', async (req, res) => {
  try {
    const { exchange, contract } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;
    const key = `${exchange}:${contract}`;

    const [doc, total] = await Promise.all([
      prisma.fundingHistory.findUnique({
        where: { key },
        include: {
          records: {
            orderBy: { timestamp: 'desc' },
            take: limit,
            skip: offset,
          },
        },
      }),
      prisma.fundingRecord.count({
        where: { fundingHistory: { key } },
      }),
    ]);

    res.json({
      ok: true,
      history: doc?.records || [],
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error, exchange: req.params.exchange, contract: req.params.contract }, 'History fetch error');
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;
