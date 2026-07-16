import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { requireSubscription } from '../middleware/subscription.js';
import { askAIForTop3 } from '../services/aiService.js';
import { generateRecommendations } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';
import { perUserLimiter } from '../middleware/rateLimit.js';

const router = Router();

// AI calls cost money, so cap per user. Mounted here (not at app.use('/api'))
// so it only counts real /ai + /recommend hits, never other /api routes.
router.use(perUserLimiter(30, 15 * 60 * 1000, 'ai'));

const aiSchema = z.object({
  listText: z.string().min(1).max(10000),
});

const recommendSchema = z.object({
  list: z.array(z.any()),
  capital: z.number().min(100).default(1000),
});

router.post('/ai', requireSubscription('pro'), validate(aiSchema), async (req, res) => {
  try {
    const { listText } = req.body;
    const ai = await askAIForTop3(listText);
    // `ai` always carries a `note` explaining empty results (missing key,
    // all models unavailable, etc.) — surface it as-is so the client can tell
    // the user *why* there's no analysis instead of a generic failure.
    return res.json({ ok: true, ai });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'AI analysis error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

router.post('/recommend', validate(recommendSchema), (req, res) => {
  try {
    const { list, capital } = req.body;
    const text = generateRecommendations(list, capital);
    res.json({ ok: true, text });
  } catch (e) {
    const error = e as Error;
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

export default router;
