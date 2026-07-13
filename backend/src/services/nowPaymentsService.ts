import crypto from 'crypto';
import axios from 'axios';
import { config } from '../config/index.js';
import { prisma } from './prisma.js';
import { logger } from '../utils/logger.js';
import { Plan, PlanId } from '../types/index.js';

const NP_BASE = config.nowPayments.baseUrl;

export interface NowPaymentsPayment {
  paymentId: string;
  payAddress: string;
  payAmount: number;
  payCurrency: string;
  invoiceUrl: string | null;
  status: string;
  simulated: boolean;
}

/**
 * Create a NOWPayments payment for the given plan. Returns the deposit address
 * and hosted invoice URL the user pays to. Falls back to a simulation object
 * when no API key is configured, so the full checkout flow can be exercised in
 * development without a real gateway.
 */
export async function createNowPaymentsPayment(
  plan: Plan,
  planId: PlanId,
  payCurrency: string,
  orderId: string
): Promise<NowPaymentsPayment> {
  if (!config.nowPayments.apiKey) {
    logger.warn('NOWPayments API key missing → simulation mode');
    return {
      paymentId: `sim_${Date.now()}`,
      payAddress: 'SIM_WALLET_ADDRESS',
      payAmount: plan.price,
      payCurrency: payCurrency.toUpperCase(),
      invoiceUrl: null,
      status: 'waiting',
      simulated: true,
    };
  }

  const ipnCallbackUrl = config.apiBaseUrl
    ? `${config.apiBaseUrl.replace(/\/$/, '')}/api/webhook/nowpayments`
    : undefined;

  const description = `Funding Finder — ${plan.name}`;

  const res = await axios.post(
    `${NP_BASE}/payment`,
    {
      price_amount: plan.price,
      price_currency: 'usd',
      pay_currency: payCurrency.toLowerCase(),
      order_id: orderId,
      order_description: description,
      ipn_callback_url: ipnCallbackUrl,
      // success_url is where NOWPayments redirects after payment.
      success_url: config.ai.appUrl || undefined,
    },
    {
      headers: {
        'x-api-key': config.nowPayments.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  const data = res.data;
  return {
    paymentId: String(data.payment_id),
    payAddress: data.pay_address,
    payAmount: parseFloat(data.pay_amount),
    payCurrency: data.pay_currency,
    invoiceUrl: data.invoice_url || null,
    status: data.payment_status || 'waiting',
    simulated: false,
  };
}

/**
 * Verify the NOWPayments IPN signature.
 *
 * NOWPayments signs the *raw request body* with HMAC-SHA512 using the IPN
 * secret (header `x-nowpayments-sig`). We must verify against the exact bytes
 * that were signed, so the raw body is passed through untouched.
 */
export function verifyNowPaymentsSignature(rawBody: string | Buffer, signature: string): boolean {
  const secret = config.nowPayments.ipnSecret;
  if (!secret) {
    logger.warn('NOWPayments IPN secret not configured — rejecting webhook');
    return false;
  }
  if (!signature || typeof signature !== 'string') return false;

  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const hmac = crypto.createHmac('sha512', secret).update(payload).digest('hex');
  if (hmac.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
}

/** Map a NOWPayments payment_status to our internal order status. */
export function mapNowPaymentsStatus(paymentStatus: string): 'waiting' | 'confirming' | 'paid' | 'failed' {
  switch ((paymentStatus || '').toLowerCase()) {
    case 'finished':
    case 'confirmed':
    case 'sending':
      return 'paid';
    case 'failed':
    case 'expired':
    case 'refunded':
      return 'failed';
    case 'confirming':
      return 'confirming';
    case 'waiting':
    case 'partially_paid':
    default:
      return 'waiting';
  }
}

interface NowPaymentsUpdate {
  payment_id?: string | number;
  payment_status?: string;
  order_id?: string;
  actually_paid?: string | number;
  pay_amount?: string | number;
  pay_currency?: string;
}

/**
 * Process a NOWPayments IPN. Returns `{ success, processed, status }`.
 * `processed` is true only when the order was actually granted (paid) or
 * failed — callers use it for idempotency bookkeeping.
 */
export async function handleNowPaymentsWebhook(update: NowPaymentsUpdate) {
  const paymentId = update.payment_id ? String(update.payment_id) : undefined;
  const orderId = update.order_id;
  if (!paymentId && !orderId) {
    logger.warn('NOWPayments webhook: missing payment_id and order_id');
    return { success: false, processed: false };
  }

  const status = mapNowPaymentsStatus(update.payment_status || '');

  // Locate the order.
  const order = orderId
    ? await prisma.order.findUnique({ where: { id: orderId } })
    : await prisma.order.findFirst({ where: { invoiceId: paymentId } });
  if (!order) {
    logger.warn({ paymentId, orderId }, 'NOWPayments webhook: order not found');
    return { success: false, processed: false };
  }

  // Always reflect the latest raw status on the invoice (for polling/display).
  await prisma.invoice.updateMany({
    where: { orderId: order.id },
    data: { status: update.payment_status || undefined },
  });

  if (status === 'waiting' || status === 'confirming') {
    await prisma.order.update({ where: { id: order.id }, data: { status } });
    return { success: true, processed: false, status };
  }

  if (status === 'failed') {
    await prisma.order.update({ where: { id: order.id }, data: { status: 'failed' } });
    return { success: true, processed: true, status: 'failed' };
  }

  // status === 'paid'
  // Verify the paid amount matches the expected crypto amount (with tolerance).
  const invoice = await prisma.invoice.findUnique({ where: { orderId: order.id } });
  const expected = invoice?.payAmount;
  const actuallyPaid = update.actually_paid != null ? parseFloat(String(update.actually_paid)) : undefined;
  if (expected && actuallyPaid != null) {
    // Allow a small tolerance for network fees / rate drift.
    if (actuallyPaid < expected * 0.99) {
      logger.error(
        { paymentId, actuallyPaid, expected },
        'NOWPayments webhook: paid amount below expected'
      );
      return { success: false, processed: false, status: 'paid' };
    }
  }

  // Grant the subscription. updateOrderFromWebhook handles the transaction.
  const { updateOrderFromWebhook } = await import('./paymentService.js');
  await updateOrderFromWebhook(order.id, 'paid', 'nowpayments');
  return { success: true, processed: true, status: 'paid' };
}

/** Fetch the current status of a payment from NOWPayments (used for polling). */
export async function getNowPaymentsStatus(paymentId: string): Promise<string | null> {
  if (!config.nowPayments.apiKey) return null;
  try {
    const res = await axios.get(`${NP_BASE}/payment/${paymentId}`, {
      headers: { 'x-api-key': config.nowPayments.apiKey },
      timeout: 10000,
    });
    if (res.data?.payment_status) return res.data.payment_status;
    return null;
  } catch {
    return null;
  }
}

/**
 * Background reconciliation: for every still-open NOWPayments order, ask the
 * API for its current status. This guarantees fast confirmation even if an IPN
 * is delayed or dropped, and is the safety net behind the webhook.
 */
export async function reconcileNowPaymentsOrders(): Promise<number> {
  if (!config.nowPayments.apiKey) return 0;

  const since = new Date(Date.now() - 2 * 60 * 60 * 1000); // last 2h
  const openOrders = await prisma.order.findMany({
    where: {
      status: { in: ['pending', 'waiting', 'confirming'] },
      createdAt: { gte: since },
      invoice: { provider: 'nowpayments', paymentId: { not: null } },
    },
    include: { invoice: true },
  });

  let updated = 0;
  for (const order of openOrders) {
    const paymentId = order.invoice?.paymentId;
    if (!paymentId) continue;
    const status = await getNowPaymentsStatus(paymentId);
    if (!status) continue;

    await prisma.invoice.updateMany({
      where: { orderId: order.id },
      data: { status },
    });

    const mapped = mapNowPaymentsStatus(status);
    if (mapped === 'paid') {
      const { updateOrderFromWebhook } = await import('./paymentService.js');
      await updateOrderFromWebhook(order.id, 'paid', 'nowpayments');
      updated++;
    } else if (mapped === 'failed') {
      await prisma.order.update({ where: { id: order.id }, data: { status: 'failed' } });
      updated++;
    } else {
      await prisma.order.update({ where: { id: order.id }, data: { status: mapped } });
    }
  }
  return updated;
}
