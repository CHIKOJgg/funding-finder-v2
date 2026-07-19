import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { requireSubscription } from '../middleware/subscription.js';
import { askAIForTop3 } from '../services/aiService.js';
import { generateRecommendations } from '../utils/helpers.js';
import { prisma } from '../services/prisma.js';
import { logger } from '../utils/logger.js';
import { perUserLimiter } from '../middleware/rateLimit.js';

const router = Router();

// AI calls hit a paid model, so the /ai endpoint is capped tightly per user.
// /recommend is a free, local computation (no external cost) so it gets a much
// more generous cap. Both are scoped to this router so they never bleed into
// other /api routes.
const aiLimiter = perUserLimiter(30, 15 * 60 * 1000, 'ai');
const recommendLimiter = perUserLimiter(300, 15 * 60 * 1000, 'recommend');

const aiSchema = z.object({
  listText: z.string().min(1).max(10000),
});

const recommendSchema = z.object({
  list: z.array(z.any()),
  capital: z.number().min(100).default(1000),
});

// Free users get exactly ONE AI tip per calendar day (cheap marketing hook to
// taste Pro). Pro+ are unlimited. Returns true when the free user is allowed to
// consume their daily tip right now.
async function consumeFreeAiQuota(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { telegramId: userId },
    select: { subscription: true, lastFreeAiAt: true },
  });
  if (!user) return false;
  const tier = user.subscription;
  if (tier === 'pro' || tier === 'promax' || tier === 'ultimate') return true;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (user.lastFreeAiAt && user.lastFreeAiAt >= startOfToday) {
    return false; // already used today
  }
  await prisma.user.update({
    where: { telegramId: userId },
    data: { lastFreeAiAt: new Date() },
  });
  return true;
}

router.post('/ai', aiLimiter, validate(aiSchema), async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const allowed = await consumeFreeAiQuota(userId);
    if (!allowed) {
      return res.status(402).json({
        ok: false,
        error: 'Бесплатный AI-совет доступен 1 раз в день. Оформите Pro для безлимита.',
        code: 'FREE_AI_LIMIT',
      });
    }
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

router.post('/recommend', recommendLimiter, validate(recommendSchema), (req, res) => {
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
