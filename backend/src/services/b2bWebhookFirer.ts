// Fires B2B webhook subscriptions when alerts trigger. HMAC-SHA256 signs each
// payload so partners can verify authenticity. Fire-and-forget with retry.

import crypto from 'crypto';
import { prisma } from './prisma.js';
import { logger } from '../utils/logger.js';

const WEBHOOK_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;

interface WebhookPayload {
  event: string;
  timestamp: number;
  data: Record<string, any>;
}

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

async function fireOneWebhook(
  webhook: { id: string; url: string; secret: string },
  payload: WebhookPayload,
): Promise<boolean> {
  const body = JSON.stringify(payload);
  const signature = signPayload(body, webhook.secret);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

      const resp = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': payload.event,
          'User-Agent': 'FundingFinder-B2B/1.0',
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (resp.ok) {
        await prisma.b2bWebhook.update({
          where: { id: webhook.id },
          data: { lastFiredAt: new Date(), fireCount: { increment: 1 } },
        });
        return true;
      }

      logger.warn(
        { webhookId: webhook.id, status: resp.status, attempt },
        'B2B webhook returned non-200'
      );
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        logger.error(
          { webhookId: webhook.id, err: (err as Error).message },
          'B2B webhook delivery failed after retries'
        );
        await prisma.b2bWebhook.update({
          where: { id: webhook.id },
          data: { failCount: { increment: 1 } },
        }).catch(() => {});
        return false;
      }
    }
  }
  return false;
}

export async function fireB2bWebhooks(
  event: string,
  data: Record<string, any>,
): Promise<void> {
  try {
    const webhooks = await prisma.b2bWebhook.findMany({
      where: {
        isActive: true,
        events: { has: event },
      },
      select: { id: true, url: true, secret: true },
    });

    if (webhooks.length === 0) return;

    const payload: WebhookPayload = {
      event,
      timestamp: Date.now(),
      data,
    };

    // Fire all matching webhooks in parallel (best-effort)
    await Promise.allSettled(
      webhooks.map((wh) => fireOneWebhook(wh, payload))
    );

    logger.debug({ event, webhookCount: webhooks.length }, 'B2B webhooks fired');
  } catch (err) {
    logger.error({ err, event }, 'Failed to fire B2B webhooks');
  }
}

/** Convenience: fire for a general (funding rate) alert trigger */
export async function fireFundingRateWebhook(triggered: {
  pair: string;
  exchange: string;
  currentRate: number;
  threshold: number;
  condition: string;
}): Promise<void> {
  await fireB2bWebhooks('funding_rate', triggered);
}

/** Convenience: fire for an arbitrage alert trigger */
export async function fireArbitrageWebhook(triggered: {
  pair: string;
  exchangeA: string;
  exchangeB: string;
  difference: number;
  threshold: number;
}): Promise<void> {
  await fireB2bWebhooks('arbitrage', triggered);
}
