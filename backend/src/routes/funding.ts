import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { getFundingCalendar } from '../services/fundingCalendar.js';
import { SUPPORTED_EXCHANGES } from '../exchanges/index.js';
import { logger } from '../utils/logger.js';
import { sendError } from '../middleware/errorHandler.js';

const router = Router();

const scheduleSchema = z.object({
  // Comma-separated CSV string (e.g. "binance,bybit") — parsed in the handler.
  exchanges: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

router.get('/funding/schedule', validate(scheduleSchema, 'query'), async (req, res) => {
  try {
    const exchanges = (req.query.exchanges as string | undefined)
      ?.split(',')
      .map((e) => e.trim())
      .filter(Boolean) || SUPPORTED_EXCHANGES;
    const limit = parseInt(req.query.limit as string) || 12;

    const { events, scanned, stale } = await getFundingCalendar(exchanges, limit);

    return res.json({ ok: true, events, scanned, stale });
  } catch (err) {
    const error = err as Error;
    logger.error({ err: error }, 'Funding schedule error');
    return sendError(res, 500, 'Failed to fetch funding schedule', 'FUNDING_SCHEDULE_ERROR');
  }
});

export default router;
