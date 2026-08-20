import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { optionalAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { perUserLimiter } from '../middleware/rateLimit.js';
import { submitSupportTicket, getPredefinedTopics, buildTopicUrl } from '../services/supportService.js';
import { prisma } from '../services/prisma.js';
import { logger } from '../utils/logger.js';
import { sendError } from '../middleware/errorHandler.js';

const router = Router();

// Protect support endpoint from automated spam (max 15 requests per 15 min per IP/user)
router.use(perUserLimiter(15, 15 * 60 * 1000, 'support'));

const createTicketSchema = z.object({
  category: z.enum(['general', 'billing', 'bug', 'arbitrage', 'feature', 'faq']).default('general'),
  message: z.string().min(3, 'Message must be at least 3 characters').max(4000, 'Message cannot exceed 4000 characters'),
  name: z.string().max(100).optional(),
  contact: z.string().max(100).optional(),
  device: z.string().max(200).optional(),
  language: z.string().max(10).optional(),
});

/**
 * POST /api/support/ticket
 * Submit a support question and create a dedicated topic in the Telegram support forum.
 */
router.post('/ticket', optionalAuth, validate(createTicketSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const { category, message, name, contact, device, language } = req.body;
    let userId = req.userId;
    let subscription = 'free';
    let contactInfo = contact;
    let userName = name;

    if (userId) {
      const user = await prisma.user.findUnique({
        where: { telegramId: userId },
        select: { username: true, firstName: true, subscription: true },
      });
      if (user) {
        subscription = user.subscription || 'free';
        if (!userName && user.firstName) userName = user.firstName;
        if (!contactInfo && user.username) contactInfo = `@${user.username}`;
      }
    }

    const result = await submitSupportTicket({
      userId,
      name: userName,
      contact: contactInfo,
      category,
      message,
      subscription,
      device,
      language,
    });

    res.status(201).json(result);
  } catch (error) {
    logger.error({ err: error }, 'Failed to process support ticket');
    sendError(res, 500, 'Failed to submit support ticket', 'SUPPORT_ERROR');
  }
});

/**
 * GET /api/support/topics
 * Get list of predefined forum topics and the support group link.
 */
router.get('/topics', (_req, res) => {
  try {
    const topics = getPredefinedTopics();
    const supportGroupUrl = buildTopicUrl();
    res.json({
      ok: true,
      topics,
      supportGroupUrl,
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to get support topics');
    sendError(res, 500, 'Failed to retrieve support topics', 'SUPPORT_TOPICS_ERROR');
  }
});

export default router;
