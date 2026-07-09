import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { requireSubscription } from '../middleware/subscription.js';
import { askAIForTop3 } from '../services/aiService.js';
import { generateRecommendations } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';

const router = Router();

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
    if (ai && ai.text) return res.json({ ok: true, ai });
    return res.json({ ok: true, ai: { text: null, note: 'AI returned no text or not configured' } });
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
