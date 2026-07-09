import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import {
  updateOrderFromWebhook,
  verifyCryptoPaySignature,
  handleCryptoPayWebhook,
} from '../services/paymentService.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const webhookRouter = Router();

// Idempotency with Promise-based lock to prevent race conditions
const processingWebhooks = new Map<string, Promise<any>>();
const processedWebhooks = new Map<string, number>();
const WEBHOOK_IDEMPOTENCY_TTL = 60 * 60 * 1000; // 1 hour

function isWebhookProcessed(webhookId: string): boolean {
  const timestamp = processedWebhooks.get(webhookId);
  if (!timestamp) return false;
  if (Date.now() - timestamp > WEBHOOK_IDEMPOTENCY_TTL) {
    processedWebhooks.delete(webhookId);
    return false;
  }
  return true;
}

function markWebhookProcessed(webhookId: string): void {
  processedWebhooks.set(webhookId, Date.now());
  if (processedWebhooks.size > 1000) {
    const cutoff = Date.now() - WEBHOOK_IDEMPOTENCY_TTL;
    for (const [id, ts] of processedWebhooks) {
      if (ts < cutoff) processedWebhooks.delete(id);
    }
  }
}

const webhookSchema = z.object({
  orderId: z.string().min(1),
  status: z.string().optional(),
  tx: z.record(z.any()).optional(),
});

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

webhookRouter.post('/payment', validate(webhookSchema), async (req, res) => {
  const token = req.headers['x-webhook-token'] as string;
  if (!token || !timingSafeEqual(token, config.webhook.secret)) {
    logger.warn('Invalid webhook token');
    return res.status(401).json({ ok: false, error: 'invalid token' });
  }

  const { orderId, status, tx } = req.body;

  // Idempotency check with lock
  if (isWebhookProcessed(orderId)) {
    logger.debug({ orderId }, 'Duplicate payment webhook, skipping');
    return res.json({ ok: true, message: 'Already processed' });
  }

  // If currently being processed, wait for it
  const existing = processingWebhooks.get(orderId);
  if (existing) {
    await existing;
    return res.json({ ok: true, message: 'Already processed' });
  }

  // Lock and process
  const processPromise = (async () => {
    try {
      const order = await updateOrderFromWebhook(orderId, status || 'paid');
      if (!order) throw new Error('Order not found');
      markWebhookProcessed(orderId);
      logger.info({ orderId, status: order.status }, 'Order updated via webhook');
      return order;
    } finally {
      processingWebhooks.delete(orderId);
    }
  })();

  processingWebhooks.set(orderId, processPromise);

  try {
    const order = await processPromise;
    res.json({ ok: true, order });
  } catch (e) {
    const error = e as Error;
    res.status(error.message === 'Order not found' ? 404 : 500).json({ ok: false, error: error.message });
  }
});

webhookRouter.post('/crypto-pay', async (req, res) => {
  try {
    const signature = req.headers['crypto-pay-api-signature'] as string;
    if (!verifyCryptoPaySignature(req.body, signature)) {
      logger.warn('Invalid Crypto Pay webhook signature');
      return res.status(401).json({ ok: false, error: 'Invalid signature' });
    }

    const webhookId = req.body.update_id || `cp_${req.body.payload?.invoice_id}_${Date.now()}`;

    // Idempotency with lock
    if (isWebhookProcessed(webhookId)) {
      logger.debug({ webhookId }, 'Duplicate Crypto Pay webhook, skipping');
      return res.json({ ok: true, message: 'Already processed' });
    }

    const existing = processingWebhooks.get(webhookId);
    if (existing) {
      await existing;
      return res.json({ ok: true, message: 'Already processed' });
    }

    const processPromise = (async () => {
      try {
        logger.info({ body: req.body }, 'Crypto Pay webhook received');
        const result = await handleCryptoPayWebhook(req.body);
        if (result.success) {
          markWebhookProcessed(webhookId);
        }
        return result;
      } finally {
        processingWebhooks.delete(webhookId);
      }
    })();

    processingWebhooks.set(webhookId, processPromise);

    const result = await processPromise;
    if (result.success) {
      res.json({ ok: true, message: 'Webhook processed successfully' });
    } else {
      res.status(400).json({ ok: false, error: 'Not processed' });
    }
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Crypto Pay webhook error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

export default webhookRouter;
