import { Router, Request } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import {
  updateOrderFromWebhook,
  verifyCryptoPaySignature,
  handleCryptoPayWebhook,
} from '../services/paymentService.js';
import { config } from '../config/index.js';
import { getRedis } from '../utils/redis.js';
import { logger } from '../utils/logger.js';

const webhookRouter = Router();

const redis = getRedis();

const WEBHOOK_IDEMPOTENCY_TTL = 60 * 60 * 1000; // 1 hour

// ---- Idempotency -----------------------------------------------------------
// When Redis is available we use it as the source of truth so that concurrent
// deliveries across multiple app instances are de-duplicated correctly.
// Without Redis we fall back to the in-memory maps below (single instance).

const processingWebhooks = new Map<string, Promise<any>>();
const processedWebhooks = new Map<string, number>();

function isWebhookProcessedLocal(webhookId: string): boolean {
  const timestamp = processedWebhooks.get(webhookId);
  if (!timestamp) return false;
  if (Date.now() - timestamp > WEBHOOK_IDEMPOTENCY_TTL) {
    processedWebhooks.delete(webhookId);
    return false;
  }
  return true;
}

function markWebhookProcessedLocal(webhookId: string): void {
  processedWebhooks.set(webhookId, Date.now());
  if (processedWebhooks.size > 1000) {
    const cutoff = Date.now() - WEBHOOK_IDEMPOTENCY_TTL;
    for (const [id, ts] of processedWebhooks) {
      if (ts < cutoff) processedWebhooks.delete(id);
    }
  }
}

async function isWebhookProcessed(webhookId: string): Promise<boolean> {
  if (redis) {
    try {
      return (await redis.get(`wh:done:${webhookId}`)) !== null;
    } catch {
      return isWebhookProcessedLocal(webhookId);
    }
  }
  return isWebhookProcessedLocal(webhookId);
}

async function markWebhookProcessed(webhookId: string): Promise<void> {
  if (redis) {
    try {
      await redis.set(`wh:done:${webhookId}`, '1', 'PX', WEBHOOK_IDEMPOTENCY_TTL);
      return;
    } catch {
      /* fall through to local */
    }
  }
  markWebhookProcessedLocal(webhookId);
}

/**
 * Acquire a processing lock. Returns true when the caller may proceed.
 * With Redis this is a cross-instance lock (SET NX); locally it checks the
 * in-memory promise map. Callers that receive false should treat the webhook
 * as already handled (Crypto Pay retries, so this is safe).
 */
async function acquireWebhookLock(webhookId: string): Promise<boolean> {
  if (redis) {
    try {
      const lock = await redis.set(
        `wh:lock:${webhookId}`,
        '1',
        'PX',
        WEBHOOK_IDEMPOTENCY_TTL,
        'NX'
      );
      if (lock === 'OK') return true;
      // Lock held by another instance (or our own). Treat as in-progress.
      return false;
    } catch {
      /* fall through to local */
    }
  }
  if (isWebhookProcessedLocal(webhookId)) return false;
  if (processingWebhooks.has(webhookId)) return false;
  return true;
}

async function releaseWebhookLock(webhookId: string): Promise<void> {
  if (redis) {
    try {
      await redis.del(`wh:lock:${webhookId}`);
    } catch {
      /* best effort */
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

function getRawBody(req: Request): Buffer | string {
  const raw = (req as any).rawBody;
  if (raw) return raw as Buffer;
  // Fallback: re-stringify parsed body (legacy path, less reliable).
  return JSON.stringify(req.body);
}

webhookRouter.post('/payment', validate(webhookSchema), async (req, res) => {
  const token = req.headers['x-webhook-token'] as string;
  if (!token || !timingSafeEqual(token, config.webhook.secret)) {
    logger.warn('Invalid webhook token');
    return res.status(401).json({ ok: false, error: 'invalid token' });
  }

  const { orderId, status } = req.body;

  // Idempotency check
  if (await isWebhookProcessed(orderId)) {
    logger.debug({ orderId }, 'Duplicate payment webhook, skipping');
    return res.json({ ok: true, message: 'Already processed' });
  }

  const locked = await acquireWebhookLock(orderId);
  if (!locked) {
    return res.json({ ok: true, message: 'Already processed' });
  }

  const processPromise = (async () => {
    try {
      const order = await updateOrderFromWebhook(orderId, status || 'paid');
      if (!order) throw new Error('Order not found');
      await markWebhookProcessed(orderId);
      logger.info({ orderId, status: order.status }, 'Order updated via webhook');
      return order;
    } finally {
      processingWebhooks.delete(orderId);
      await releaseWebhookLock(orderId);
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
    if (!verifyCryptoPaySignature(getRawBody(req), signature)) {
      logger.warn('Invalid Crypto Pay webhook signature');
      return res.status(401).json({ ok: false, error: 'Invalid signature' });
    }

    const update = req.body;
    const webhookId =
      update?.update_id?.toString() ||
      `cp_${update?.payload?.invoice_id}_${Date.now()}`;

    // Idempotency check
    if (await isWebhookProcessed(webhookId)) {
      logger.debug({ webhookId }, 'Duplicate Crypto Pay webhook, skipping');
      return res.json({ ok: true, message: 'Already processed' });
    }

    const locked = await acquireWebhookLock(webhookId);
    if (!locked) {
      return res.json({ ok: true, message: 'Already processed' });
    }

    const processPromise = (async () => {
      try {
        logger.info({ body: update }, 'Crypto Pay webhook received');
        const result = await handleCryptoPayWebhook(update);
        if (result.success) {
          await markWebhookProcessed(webhookId);
        }
        return result;
      } finally {
        processingWebhooks.delete(webhookId);
        await releaseWebhookLock(webhookId);
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
