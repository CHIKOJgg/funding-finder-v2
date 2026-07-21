import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { prisma } from '../services/prisma.js';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

const router = Router();

const MAX_WEBHOOKS_PER_USER = 10;

const registerSchema = z.object({
  url: z.string().url('Must be a valid URL').refine(
    (u) => u.startsWith('https://'),
    'Webhook URL must use HTTPS'
  ),
  events: z.array(
    z.enum(['funding_rate', 'arbitrage', 'spread_alert'])
  ).min(1).max(5).default(['funding_rate', 'arbitrage']),
  label: z.string().max(60).optional(),
});

const updateSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.enum(['funding_rate', 'arbitrage', 'spread_alert'])).min(1).max(5).optional(),
  isActive: z.boolean().optional(),
  label: z.string().max(60).optional(),
});

/**
 * @swagger
 * /v1/b2b-webhooks:
 *   post:
 *     tags: [B2B Webhooks]
 *     summary: Register a new webhook
 *     description: >
 *       Register a callback URL to receive HMAC-signed POST notifications
 *       when funding rate alerts or arbitrage opportunities trigger. The
 *       webhook secret is returned ONCE — store it securely. Each user can
 *       register up to 10 webhooks.
 *     security:
 *       - telegramAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url]
 *             properties:
 *               url:
 *                 type: string
 *                 format: uri
 *                 description: HTTPS callback URL
 *                 example: "https://your-server.com/webhooks/funding"
 *               events:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [funding_rate, arbitrage, spread_alert]
 *                 default: [funding_rate, arbitrage]
 *               label:
 *                 type: string
 *                 maxLength: 60
 *                 description: Human-readable name for this webhook
 *     responses:
 *       200:
 *         description: Webhook registered
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 id:
 *                   type: string
 *                 secret:
 *                   type: string
 *                   description: "HMAC-SHA256 signing key — shown ONCE, store securely"
 *                 url:
 *                   type: string
 *                 events:
 *                   type: array
 *                   items:
 *                     type: string
 *       400:
 *         description: Validation error
 *       429:
 *         description: Too many webhooks (max 10 per user)
 */
router.post('/b2b-webhooks', validate(registerSchema), async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const { url, events, label } = req.body;

    const count = await prisma.b2bWebhook.count({ where: { userId } });
    if (count >= MAX_WEBHOOKS_PER_USER) {
      return res.status(429).json({
        ok: false,
        error: `Maximum ${MAX_WEBHOOKS_PER_USER} webhooks per user`,
      });
    }

    // Generate a unique HMAC signing key for this webhook
    const secret = crypto.randomBytes(32).toString('hex');

    const webhook = await prisma.b2bWebhook.create({
      data: { userId, url, events, label: label ?? null, secret },
    });

    logger.info({ webhookId: webhook.id, userId, url, events }, 'B2B webhook registered');

    return res.json({
      ok: true,
      id: webhook.id,
      secret, // shown once
      url: webhook.url,
      events: webhook.events,
      label: webhook.label,
      createdAt: webhook.createdAt,
    });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'B2B webhook registration failed');
    return res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * @swagger
 * /v1/b2b-webhooks:
 *   get:
 *     tags: [B2B Webhooks]
 *     summary: List your webhooks
 *     description: Returns all webhooks registered by the authenticated user.
 *     security:
 *       - telegramAuth: []
 *     responses:
 *       200:
 *         description: List of webhooks
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 webhooks:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       url:
 *                         type: string
 *                       events:
 *                         type: array
 *                         items:
 *                           type: string
 *                       isActive:
 *                         type: boolean
 *                       label:
 *                         type: string
 *                       lastFiredAt:
 *                         type: string
 *                         format: date-time
 *                       fireCount:
 *                         type: integer
 *                       failCount:
 *                         type: integer
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 */
router.get('/b2b-webhooks', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const webhooks = await prisma.b2bWebhook.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        url: true,
        events: true,
        isActive: true,
        label: true,
        lastFiredAt: true,
        fireCount: true,
        failCount: true,
        createdAt: true,
      },
    });

    return res.json({ ok: true, webhooks });
  } catch (e) {
    const error = e as Error;
    return res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * @swagger
 * /v1/b2b-webhooks/{id}:
 *   patch:
 *     tags: [B2B Webhooks]
 *     summary: Update a webhook
 *     security:
 *       - telegramAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               url:
 *                 type: string
 *                 format: uri
 *               events:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [funding_rate, arbitrage, spread_alert]
 *               isActive:
 *                 type: boolean
 *               label:
 *                 type: string
 *     responses:
 *       200:
 *         description: Webhook updated
 *       404:
 *         description: Webhook not found
 */
router.patch('/b2b-webhooks/:id', validate(updateSchema), async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const { id } = req.params;

    const existing = await prisma.b2bWebhook.findFirst({ where: { id, userId } });
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Webhook not found' });
    }

    const updated = await prisma.b2bWebhook.update({
      where: { id },
      data: req.body,
      select: {
        id: true, url: true, events: true, isActive: true, label: true,
        lastFiredAt: true, fireCount: true, failCount: true, createdAt: true,
      },
    });

    return res.json({ ok: true, webhook: updated });
  } catch (e) {
    const error = e as Error;
    return res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * @swagger
 * /v1/b2b-webhooks/{id}:
 *   delete:
 *     tags: [B2B Webhooks]
 *     summary: Delete a webhook
 *     security:
 *       - telegramAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Webhook deleted
 *       404:
 *         description: Webhook not found
 */
router.delete('/b2b-webhooks/:id', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const { id } = req.params;

    const existing = await prisma.b2bWebhook.findFirst({ where: { id, userId } });
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Webhook not found' });
    }

    await prisma.b2bWebhook.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (e) {
    const error = e as Error;
    return res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * @swagger
 * /v1/b2b-webhooks/{id}/rotate-secret:
 *   post:
 *     tags: [B2B Webhooks]
 *     summary: Rotate webhook signing secret
 *     description: Generate a new HMAC secret for the webhook. The old secret is immediately invalidated.
 *     security:
 *       - telegramAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: New secret generated
 *       404:
 *         description: Webhook not found
 */
router.post('/b2b-webhooks/:id/rotate-secret', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const { id } = req.params;

    const existing = await prisma.b2bWebhook.findFirst({ where: { id, userId } });
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Webhook not found' });
    }

    const newSecret = crypto.randomBytes(32).toString('hex');
    await prisma.b2bWebhook.update({ where: { id }, data: { secret: newSecret } });

    return res.json({ ok: true, secret: newSecret });
  } catch (e) {
    const error = e as Error;
    return res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;
