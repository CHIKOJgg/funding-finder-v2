import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { prisma } from './prisma.js';
import { logger } from '../utils/logger.js';
import { Plan, PlanId } from '../types/index.js';

export const PLANS: Record<PlanId, Plan> = {
  basic: {
    price: 29,
    name: 'Basic',
    features: ['Сканирование 3 бирж', 'Основные рекомендации', 'Обновления каждые 6 часов'],
  },
  pro: {
    price: 99,
    name: 'Pro',
    features: ['Все функции Basic', 'AI анализ', 'Приоритетные обновления', 'Экспорт данных'],
  },
  promax: {
    price: 499,
    name: 'Pro Max',
    features: ['Все функции Pro', 'Эксклюзивные сигналы', 'Персональная поддержка', 'Ранний доступ'],
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
  return `https://t.me/${config.cryptoPay.botUsername}?start=ref_${user.referralCode}`;
}

export async function handleReferral(newTelegramId: string, referralCode: string) {
  const referrer = await prisma.user.findUnique({ where: { referralCode } });
  if (!referrer) return false;

  const existingUser = await prisma.user.findUnique({ where: { telegramId: newTelegramId } });
  if (existingUser && existingUser.referredBy) return false;

  const newUser = await getUser(newTelegramId);

  // Transaction: link referral and award bonus atomically
  await prisma.$transaction([
    prisma.user.update({
      where: { telegramId: newTelegramId },
      data: { referredBy: referrer.id },
    }),
    prisma.user.update({
      where: { id: referrer.id },
      data: {
        trialScans: { increment: 1 },
      },
    }),
  ]);

  return true;
}

export async function createCryptoPayInvoice(planId: PlanId, currency: string, orderId: string, telegramId: string) {
  const plan = PLANS[planId];

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
      amount: plan.price,
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

  if (res.data.ok) return res.data.result;
  throw new Error(res.data.error?.message || 'Crypto Pay error');
}

export async function createOrder(planId: PlanId, currency: string = 'USDT', telegramId: string) {
  const plan = PLANS[planId];
  if (!plan) throw new Error('Invalid plan');

  const orderId = `order_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  try {
    const invoiceData = await createCryptoPayInvoice(planId, currency, orderId, telegramId);

    await prisma.$transaction(async (tx) => {
      await tx.order.create({
        data: {
          id: orderId,
          planId,
          userId: telegramId,
          amount: plan.price,
          currency,
          invoiceId: invoiceData.invoice_id,
        },
      });

      await tx.invoice.create({
        data: {
          orderId,
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
      invoiceId: invoiceData.invoice_id,
      amount: plan.price,
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

export async function updateOrderFromWebhook(invoiceId: string, status: string = 'paid') {
  const order = await prisma.order.findFirst({ where: { invoiceId } });
  if (!order) return null;

  if (status === 'paid') {
    // Transaction: update order, subscription, and payment record atomically
    const [updated] = await prisma.$transaction([
      prisma.order.update({
        where: { id: order.id },
        data: { status, updatedAt: new Date() },
      }),
      prisma.user.update({
        where: { telegramId: order.userId },
        data: { subscription: order.planId },
      }),
    ]);

    // Create payment history + record
    let history = await prisma.paymentHistory.findUnique({ where: { userId: order.userId } });
    if (!history) {
      history = await prisma.paymentHistory.create({
        data: { userId: order.userId },
      });
    }

    await prisma.paymentRecord.create({
      data: {
        paymentHistoryId: history.id,
        orderId: order.id,
        plan: PLANS[order.planId as PlanId]?.name || order.planId,
        amount: order.amount,
        currency: order.currency,
      },
    });

    return updated;
  }

  return prisma.order.update({
    where: { id: order.id },
    data: { status, updatedAt: new Date() },
  });
}

export function verifyCryptoPaySignature(rawBody: any, signature: string) {
  const token = config.cryptoPay.apiToken;
  if (!token) {
    logger.warn('Crypto Pay token not configured — skipping signature verification');
    return false;
  }
  const hmac = crypto.createHmac('sha256', token).update(JSON.stringify(rawBody)).digest('hex');
  if (hmac.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
}

export async function handleCryptoPayWebhook(update: any) {
  if (update.update_type === 'invoice_paid') {
    const { invoice_id } = update.payload;
    await updateOrderFromWebhook(invoice_id, 'paid');
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
