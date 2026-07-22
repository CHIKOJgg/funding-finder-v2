import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { prisma } from './prisma.js';
import { planRank } from '../utils/planRanks.js';
import { logger } from '../utils/logger.js';
import { Plan, PlanId } from '../types/index.js';

// Annual price = 20% off the 12× monthly equivalent (billed once per year).
const annualFromMonthly = (m: number) => Math.round(m * 12 * 0.8);

// Consolidated to 2 paid tiers. Pro is the hero (lower entry price than
// the old Basic/Pro split), Pro+ is the high-value tier. Free stays free.
export const PLANS: Record<PlanId, Plan> = {
  pro: {
    monthlyPrice: 49,
    annualPrice: annualFromMonthly(49),
    price: 49,
    name: 'Pro',
    features: ['20 бирж в скане', 'AI-анализ безлимита', 'Портфель + PnL', 'Безлимитный вотчлист', 'Приоритетные обновления', 'Экспорт данных'],
  },
  proplus: {
    monthlyPrice: 149,
    annualPrice: annualFromMonthly(149),
    price: 149,
    name: 'Pro+',
    features: ['Все 25 бирж', 'Все функции Pro', 'Персональная поддержка', 'Ранний доступ к фичам', 'White-label'],
  },
};

function getApiBaseUrl(): string {
  return config.cryptoPay.network === 'mainnet'
    ? 'https://pay.crypt.bot'
    : 'https://testnet-pay.crypt.bot';
}

export async function getUser(telegramId: string) {
  let user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    user = await prisma.user.create({ data: { telegramId } });
  }
  return user;
}

export async function generateReferralLink(telegramId: string) {
  const user = await getUser(telegramId);
  // Deep link into the app's Telegram bot so /start ref_<code> fires
  // handleReferral (link + bonus) — not the Crypto Pay bot.
  return `https://t.me/${config.telegram.botUsername}?start=ref_${user.referralCode}`;
}

export async function handleReferral(newTelegramId: string, referralCode: string) {
  const referrer = await prisma.user.findUnique({ where: { referralCode } });
  if (!referrer) return false;

  const existingUser = await prisma.user.findUnique({ where: { telegramId: newTelegramId } });
  if (existingUser && existingUser.referredBy) return false;

  const newUser = await getUser(newTelegramId);

  // Double-sided incentive: the referred user gets an automatic 7-day Pro
  // trial (so they experience the full product immediately), and the referrer
  // keeps their 20% rev-share on the referral's first payment plus +1 scan.
  // Giving value to BOTH sides turns every user into a growth channel.
  const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const alreadyHasTrial = newUser.trialUsed || newUser.subscription !== 'free';

  const updates: any[] = [
    prisma.user.update({
      where: { telegramId: newTelegramId },
      data: { referredBy: referrer.id },
    }),
    prisma.user.update({
      where: { id: referrer.id },
      data: { trialScans: { increment: 1 } },
    }),
  ];

  if (!alreadyHasTrial) {
    updates.push(
      prisma.user.update({
        where: { telegramId: newTelegramId },
        data: { subscription: 'pro', trialUsed: true, trialEndsAt },
      })
    );
  }

  await prisma.$transaction(updates);

  return true;
}

export async function createCryptoPayInvoice(planId: PlanId, currency: string, orderId: string, telegramId: string, amount?: number) {
  const plan = PLANS[planId];
  const chargeAmount = amount ?? plan.monthlyPrice;

  if (!config.cryptoPay.apiToken) {
    logger.warn('Crypto Pay token missing → simulation mode');
    return {
      invoice_id: 'sim_' + Date.now(),
      hash: 'simulated',
      bot_invoice_url: `https://t.me/${config.cryptoPay.botUsername}?start=invoice_${orderId}`,
      mini_app_invoice_url: `https://t.me/${config.cryptoPay.botUsername}?start=invoice_${orderId}`,
      web_app_invoice_url: `https://t.me/${config.cryptoPay.botUsername}?start=invoice_${orderId}`,
      status: 'active',
    };
  }

  const description = `Подписка ${plan.name} — Funding Finder`;
  const payload = JSON.stringify({ orderId, telegramId, plan: plan.name });

  const res = await axios.post(
    `${getApiBaseUrl()}/api/createInvoice`,
    {
      asset: currency.toUpperCase(),
      amount: chargeAmount,
      description,
      payload,
      paid_btn_name: 'openBot',
      paid_btn_url: `https://t.me/${config.cryptoPay.botUsername}?start=ff_${orderId}`,
      allow_comments: false,
      allow_anonymous: false,
      expires_in: 3600,
    },
    {
      headers: { 'Crypto-Pay-API-Token': config.cryptoPay.apiToken },
      timeout: 30000,
    }
  );

  if (res.data.ok) {
    const result = res.data.result;
    result.invoice_id = String(result.invoice_id);
    return result;
  }
  throw new Error(res.data.error?.message || 'Crypto Pay error');
}

export async function createOrder(
  planId: PlanId,
  currency: string = 'USDT',
  telegramId: string,
  options?: {
    provider?: 'crypto_pay' | 'nowpayments';
    payCurrency?: string;
    billingPeriod?: 'monthly' | 'annual';
  }
) {
  const plan = PLANS[planId];
  if (!plan) throw new Error('Invalid plan');

  const billingPeriod = options?.billingPeriod || 'monthly';
  const amount = billingPeriod === 'annual' ? plan.annualPrice : plan.monthlyPrice;

  const provider = options?.provider || 'crypto_pay';
  const orderId = `order_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  try {
    // Ensure the user row exists (Order.userId is an FK to User.telegramId)
    await getUser(telegramId);

    // ---- NOWPayments (website / non-Telegram crypto checkout) ----
    if (provider === 'nowpayments') {
      const { createNowPaymentsPayment } = await import('./nowPaymentsService.js');
      const payCurrency = (options?.payCurrency || 'usdt').toLowerCase();
      const np = await createNowPaymentsPayment(plan, planId, payCurrency, orderId, amount);

      await prisma.$transaction(async (tx) => {
        await tx.order.create({
          data: {
            id: orderId,
            planId,
            userId: telegramId,
            amount,
            currency: payCurrency,
            invoiceId: np.paymentId,
            billingPeriod,
            status: 'waiting',
          },
        });

        await tx.invoice.create({
          data: {
            orderId,
            provider: 'nowpayments',
            invoiceId: np.paymentId,
            paymentId: np.paymentId,
            payAddress: np.payAddress,
            payCurrency: np.payCurrency,
            payAmount: np.payAmount,
            orderDescription: `Funding Finder — ${plan.name}`,
            status: np.status,
          },
        });
      });

      return {
        ok: true,
        orderId,
        provider: 'nowpayments',
        invoiceId: np.paymentId,
        paymentId: np.paymentId,
        amount,
        billingPeriod,
        currency: payCurrency,
        payAddress: np.payAddress,
        payAmount: np.payAmount,
        payCurrency: np.payCurrency,
        invoiceUrl: np.invoiceUrl,
        status: np.status,
        simulated: np.simulated,
      };
    }

    // ---- Crypto Pay (Telegram mini-app) ----
    const invoiceData = await createCryptoPayInvoice(planId, currency, orderId, telegramId, amount);

    await prisma.$transaction(async (tx) => {
      await tx.order.create({
        data: {
          id: orderId,
          planId,
          userId: telegramId,
          amount,
          currency,
          billingPeriod,
          invoiceId: invoiceData.invoice_id,
        },
      });

      await tx.invoice.create({
        data: {
          orderId,
          provider: 'crypto_pay',
          invoiceId: invoiceData.invoice_id,
          hash: invoiceData.hash,
          botInvoiceUrl: invoiceData.bot_invoice_url,
          miniAppInvoiceUrl: invoiceData.mini_app_invoice_url,
          webAppInvoiceUrl: invoiceData.web_app_invoice_url,
          status: invoiceData.status,
        },
      });
    });

    return {
      ok: true,
      orderId,
      provider: 'crypto_pay',
      invoiceId: invoiceData.invoice_id,
      amount,
      billingPeriod,
      currency,
      botInvoiceUrl: invoiceData.bot_invoice_url,
      miniAppInvoiceUrl: invoiceData.mini_app_invoice_url,
      webAppInvoiceUrl: invoiceData.web_app_invoice_url,
    };
  } catch (err: any) {
    logger.error(`Order creation failed: ${err.message}`);
    return { ok: false, error: err.message, orderId };
  }
}

export async function getOrder(orderId: string) {
  return prisma.order.findUnique({ where: { id: orderId } });
}

export async function getInvoice(orderId: string) {
  return prisma.invoice.findUnique({ where: { orderId } });
}

export async function updateOrderFromWebhook(
  lookup: string,
  status: string = 'paid',
  provider?: string
) {
  // `lookup` may be the order id (NOWPayments / generic webhook) or the
  // Crypto Pay invoice id — resolve either way.
  let order = await prisma.order.findUnique({ where: { id: lookup } });
  if (!order) order = await prisma.order.findFirst({ where: { invoiceId: lookup } });
  if (!order) return null;

  if (status === 'refunded' || status === 'failed') {
    // Refund / failed payment: revoke the granted plan if the user is still on
    // it (never downgrade a user who has since upgraded to a higher tier).
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { telegramId: order.userId } });
      if (!user) return null;
      if (user.subscription === order.planId && order.planId !== 'free') {
        await tx.user.update({
          where: { telegramId: order.userId },
          data: { subscription: 'free' },
        });
        logger.info({ userId: order.userId, plan: order.planId }, 'Subscription revoked after refund/failure');
      }
      await tx.order.update({
        where: { id: order.id },
        data: { status, updatedAt: new Date() },
      });
      await tx.invoice.updateMany({ where: { orderId: order.id }, data: { status } });
      return order;
    });
    return result;
  }

  if (status === 'paid') {
    // Idempotent grant. The whole thing runs in one transaction so concurrent
    // calls (webhook + status poll + reconcile) cannot double-credit. The
    // PaymentRecord.orderId unique index is the ultimate guard, but we also
    // short-circuit when the order is already marked paid.
    const result = await prisma.$transaction(async (tx) => {
      const currentOrder = await tx.order.findUnique({ where: { id: order.id } });
      if (!currentOrder) return null;

      // Re-read inside the transaction to get the freshest subscription.
      const user = await tx.user.findUnique({ where: { telegramId: order.userId } });
      if (!user) return null;

      const newRank = planRank(order.planId);
      const currentRank = planRank(user.subscription);

      await tx.order.update({
        where: { id: order.id },
        data: { status: 'paid', updatedAt: new Date() },
      });

      // Only upgrade (never downgrade) the subscription.
      if (newRank > currentRank) {
        await tx.user.update({
          where: { telegramId: order.userId },
          data: { subscription: order.planId },
        });
      }

      // Upsert the payment record so a replayed webhook can't create a duplicate.
      let history = await tx.paymentHistory.findUnique({ where: { userId: order.userId } });
      if (!history) {
        history = await tx.paymentHistory.create({ data: { userId: order.userId } });
      }

      const existing = await tx.paymentRecord.findUnique({ where: { orderId: order.id } });
      if (!existing) {
        await tx.paymentRecord.create({
          data: {
            paymentHistoryId: history.id,
            orderId: order.id,
            plan: PLANS[order.planId as PlanId]?.name || order.planId,
            amount: order.amount,
            currency: order.currency,
          },
        });
      }

      await tx.invoice.updateMany({
        where: { orderId: order.id },
        data: { status: 'paid' },
      });

      // Credit the referrer a percentage of the referral's FIRST payment.
      // A percentage (vs the old flat $5) gives ambassadors real upside and a
      // stronger incentive to drive paying users. Guarded by `referralCredited`
      // so a replayed webhook can't double-pay. Amount is capped at the plan
      // price (no negative or absurd values).
      if (!currentOrder.referralCredited && user.referredBy) {
        const REFERRAL_RATE = 0.2; // 20% of first payment
        const bonus = Math.max(0, Math.min(REFERRAL_RATE * order.amount, order.amount));
        await tx.user.update({
          where: { id: user.referredBy },
          data: { balance: { increment: bonus } },
        });
        await tx.order.update({
          where: { id: order.id },
          data: { referralCredited: true },
        });
        logger.info({ referrerId: user.referredBy, orderId: order.id, bonus }, 'Referral bonus (20% of first payment) credited to balance');
      }

      return currentOrder;
    });

    return result;
  }

  await prisma.invoice.updateMany({
    where: { orderId: order.id },
    data: { status },
  });

  return prisma.order.update({
    where: { id: order.id },
    data: { status, updatedAt: new Date() },
  });
}

/**
 * Verify the Crypto Pay webhook signature.
 *
 * Crypto Pay signs the *raw bytes* of the request body with HMAC-SHA256 using
 * the API token as key (header `Crypto-Pay-API-Signature`). We must verify
 * against the raw body, not a re-serialized copy, since re-stringifying a
 * parsed object can reorder keys / change whitespace and break the check.
 */
export function verifyCryptoPaySignature(rawBody: string | Buffer, signature: string) {
  const token = config.cryptoPay.apiToken;
  if (!token) {
    logger.warn('Crypto Pay token not configured — skipping signature verification');
    return false;
  }
  if (!signature || typeof signature !== 'string') return false;

  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const hmac = crypto.createHmac('sha256', token).update(payload).digest('hex');
  if (hmac.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
}

/** Allow a tiny float tolerance when comparing paid vs expected amounts. */
function amountsMatch(expected: number, paid: number): boolean {
  return Number.isFinite(paid) && Math.abs(expected - paid) < 0.01;
}

export async function handleCryptoPayWebhook(update: any) {
  if (update?.update_type === 'invoice_paid') {
    const payload = update.payload || {};
    const invoiceId = payload.invoice_id;
    const paidAmount = parseFloat(payload.amount);

    const order = await prisma.order.findFirst({ where: { invoiceId } });
    if (!order) {
      logger.warn({ invoiceId }, 'Crypto Pay webhook: order not found');
      return { success: false };
    }

    // Never grant a subscription if the paid amount doesn't match the plan.
    if (!amountsMatch(order.amount, paidAmount)) {
      logger.error(
        { invoiceId, paidAmount, expected: order.amount },
        'Crypto Pay webhook: paid amount does not match order'
      );
      return { success: false };
    }

    await updateOrderFromWebhook(invoiceId, 'paid');
    return { success: true };
  }
  return { success: false };
}

export async function getWithdrawalHistory(userId: string, limit: number = 50, offset: number = 0) {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const safeOffset = Math.max(offset, 0);
  const [withdrawals, total] = await Promise.all([
    prisma.withdrawal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
      skip: safeOffset,
    }),
    prisma.withdrawal.count({ where: { userId } }),
  ]);
  return { withdrawals, total, limit: safeLimit, offset: safeOffset };
}

export async function getPaymentHistory(userId: string, limit: number = 50, offset: number = 0) {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const safeOffset = Math.max(offset, 0);
  const history = await prisma.paymentHistory.findUnique({
    where: { userId },
    include: {
      payments: {
        orderBy: { date: 'desc' },
        take: safeLimit,
        skip: safeOffset,
      },
    },
  });
  const total = history
    ? await prisma.paymentRecord.count({ where: { paymentHistoryId: history.id } })
    : 0;
  return { payments: history?.payments || [], total, limit: safeLimit, offset: safeOffset };
}

export async function getUserBalance(userId: string) {
  const user = await getUser(userId);
  return user.balance;
}

export async function updateUserBalance(userId: string, amount: number) {
  return prisma.user.update({
    where: { telegramId: userId },
    data: { balance: { increment: amount } },
  });
}

export async function getInvoiceStatus(invoiceId: string) {
  if (!config.cryptoPay.apiToken) return null;

  try {
    const res = await axios.get(
      `${getApiBaseUrl()}/api/getInvoices`,
      {
        params: { invoice_ids: invoiceId },
        headers: { 'Crypto-Pay-API-Token': config.cryptoPay.apiToken },
        timeout: 10000,
      }
    );

    if (res.data.ok && res.data.result?.items?.length > 0) {
      return res.data.result.items[0];
    }
    return null;
  } catch {
    return null;
  }
}
