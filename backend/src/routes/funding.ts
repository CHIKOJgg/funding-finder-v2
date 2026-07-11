import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { getFundingCalendar } from '../services/fundingCalendar.js';
import { logger } from '../utils/logger.js';

const router = Router();

const scheduleSchema = z.object({
  exchanges: z.array(z.enum(['gate', 'binance', 'bybit', 'mexc', 'okx'])).max(5).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

router.get('/funding/schedule', validate(scheduleSchema), async (req, res) => {
  try {
    const exchanges = (req.query.exchanges as string | undefined)
      ?.split(',')
      .map((e) => e.trim())
      .filter(Boolean) || ['gate', 'binance', 'bybit', 'mexc', 'okx'];
    const limit = parseInt(req.query.limit as string) || 12;

    const { events, scanned, stale } = await getFundingCalendar(exchanges, limit);

    return res.json({ ok: true, events, scanned, stale });
  } catch (err) {
    const error = err as Error;
    logger.error({ err: error }, 'Funding schedule error');
    return res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;
