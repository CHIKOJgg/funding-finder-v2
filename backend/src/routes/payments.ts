import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { validate } from '../middleware/validation.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import {
  createOrder,
  getOrder,
  getInvoice,
  getInvoiceStatus,
  updateOrderFromWebhook,
  getWithdrawalHistory,
  getPaymentHistory,
  getUserBalance,
} from '../services/paymentService.js';
import { getNowPaymentsStatus, mapNowPaymentsStatus } from '../services/nowPaymentsService.js';
import { prisma } from '../services/prisma.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { sendError } from '../middleware/errorHandler.js';

const router = Router();

const createOrderSchema = z.object({
  planId: z.enum(['pro', 'proplus']),
  currency: z.string().default('USDT'),
  // Crypto gateway selection: Crypto Pay (Telegram) or NOWPayments (website).
  provider: z.enum(['crypto_pay', 'nowpayments']).optional().default('crypto_pay'),
  payCurrency: z.string().optional(),
  // Billing period: monthly (default) or annual (-20%).
  billingPeriod: z.enum(['monthly', 'annual']).optional().default('monthly'),
});

const withdrawSchema = z.object({
  amount: z.number().min(10).max(5000, 'Max 5000 USDT per withdrawal'),
  currency: z.literal('USDT').or(z.literal('usdt')),
  address: z.string().min(1),
  network: z.enum(['TRC20', 'ERC20', 'BEP20', 'BTC', 'SOL', 'TON']),
});

// Basic address format validation per network — prevents "withdraw to
// garbage" (permanently lost funds) and obvious fat-finger typos. Not a
// substitute for admin review, but it stops the worst cases.
function isPlausibleAddress(network: string, address: string): boolean {
  switch (network) {
    case 'TRC20':
      return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
    case 'ERC20':
    case 'BEP20':
      return /^0x[0-9a-fA-F]{40}$/.test(address);
    case 'BTC':
      return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(address);
    case 'SOL':
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    case 'TON':
      return /^(UQ|EQ)[A-Za-z0-9_-]{46,48}$/.test(address);
    default:
      return false;
  }
}

// Per-user daily withdrawal cap (anti-fraud; generous for a referral payout).
const DAILY_WITHDRAW_LIMIT = 20000;

router.post('/createOrder', validate(createOrderSchema), async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const { planId, currency, provider, payCurrency, billingPeriod } = req.body;
    const result = await createOrder(planId, currency, userId, { provider, payCurrency, billingPeriod });
    res.json(result);
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'CreateOrder error');
    return sendError(res, 500, 'Failed to create order', 'ORDER_CREATE_ERROR');
  }
});

router.get('/orderStatus/:orderId', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const order = await getOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });
    // Ownership check: a user may only poll their own orders.
    if (order.userId !== userId) return res.status(403).json({ ok: false, error: 'Forbidden' });

    const invoice = await getInvoice(req.params.orderId);

    // NOWPayments: poll the gateway for the latest status (fast confirmation).
    // getNowPaymentsStatus no-ops when no API key is configured (simulation).
    if (invoice?.provider === 'nowpayments' && invoice.paymentId) {
      if (['pending', 'waiting', 'confirming'].includes(order.status)) {
        const npStatus = await getNowPaymentsStatus(invoice.paymentId);
        if (npStatus) {
          const mapped = mapNowPaymentsStatus(npStatus);
          if (mapped === 'paid') {
            await updateOrderFromWebhook(order.id, 'paid', 'nowpayments');
          } else if (mapped === 'failed') {
            await updateOrderFromWebhook(order.id, 'failed', 'nowpayments');
          } else {
            await updateOrderFromWebhook(order.id, mapped, 'nowpayments');
          }
        }
      }
    } else if (order.invoiceId) {
      const invoiceStatus = await getInvoiceStatus(order.invoiceId);
      if (invoiceStatus) {
        await updateOrderFromWebhook(order.invoiceId, invoiceStatus.status);
        const updatedOrder = await getOrder(req.params.orderId);
        return res.json({ ok: true, order: updatedOrder, invoice });
      }
    }

    return res.json({ ok: true, order, invoice });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'OrderStatus error');
    return sendError(res, 500, 'Failed to fetch order status', 'ORDER_STATUS_ERROR');
  }
});

// Dev-only helper: simulate a successful payment so the full checkout flow can
// be tested without a real crypto gateway. Never available in production.
if (!config.isProduction) {
  router.post('/simulate/:orderId', async (req, res) => {
    try {
      const order = await getOrder(req.params.orderId);
      if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });
      const updated = await updateOrderFromWebhook(order.id, 'paid', 'nowpayments');
      res.json({ ok: true, order: updated });
    } catch (e) {
      const error = e as Error;
      logger.error({ err: error }, 'Simulate payment error');
      return sendError(res, 500, 'Failed to simulate payment', 'SIMULATE_ERROR');
    }
  });
}

router.post('/withdraw', validate(withdrawSchema), async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const { amount, currency, address, network } = req.body;

    if (!isPlausibleAddress(network, address)) {
      return sendError(res, 400, `Address does not look like a valid ${network} address`, 'WITHDRAW_ADDRESS_INVALID');
    }

    // Daily cap: sum of today's withdrawals (created, not only completed).
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const todayTotal = await prisma.withdrawal.aggregate({
      where: { userId, createdAt: { gte: dayStart } },
      _sum: { amount: true },
    });
    if ((todayTotal._sum.amount || 0) + amount > DAILY_WITHDRAW_LIMIT) {
      return sendError(res, 400, 'Daily withdrawal limit exceeded', 'WITHDRAW_DAILY_LIMIT');
    }

    const result = await prisma.$transaction(async (tx) => {
      // Atomic conditional decrement: the balance check and the deduction
      // happen in ONE statement, so two concurrent withdrawals can never both
      // pass the check and drive the balance negative (the old read-then-
      // update pattern was racy under Postgres READ COMMITTED).
      const updated = await tx.user.updateMany({
        where: { telegramId: userId, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      });
      if (updated.count === 0) {
        throw new Error('Insufficient balance');
      }

      const withdrawal = await tx.withdrawal.create({
        data: {
          id: `withdraw_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
          userId,
          amount,
          currency,
          address,
          network,
          status: 'pending',
          transactionId: null,
        },
      });

      return withdrawal;
    });

    logger.info(`Withdrawal created for ${userId}: ${amount} ${currency}`);
    res.json({ ok: true, transactionId: result.transactionId || result.id });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Withdraw error');
    const msg = error.message === 'Insufficient balance' ? 'Insufficient balance' : 'Failed to create withdrawal';
    return sendError(res, error.message === 'Insufficient balance' ? 400 : 500, msg, 'WITHDRAW_ERROR');
  }
});

router.get('/withdrawalHistory', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await getWithdrawalHistory(userId, limit, offset);
    res.json({ ok: true, ...result });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'WithdrawalHistory error');
    return sendError(res, 500, 'Failed to fetch withdrawal history', 'WITHDRAWAL_HISTORY_ERROR');
  }
});

router.get('/paymentHistory', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await getPaymentHistory(userId, limit, offset);
    res.json({ ok: true, ...result });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'PaymentHistory error');
    return sendError(res, 500, 'Failed to fetch payment history', 'PAYMENT_HISTORY_ERROR');
  }
});

router.get('/balance', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const balance = await getUserBalance(userId);
    res.json({ ok: true, balance });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Balance error');
    return sendError(res, 500, 'Failed to fetch balance', 'BALANCE_ERROR');
  }
});

router.get('/invoice/:orderId', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const invoice = await getInvoice(req.params.orderId);
    if (!invoice) return res.status(404).json({ ok: false, error: 'Invoice not found' });
    // Ownership check: a user may only fetch their own invoices.
    const order = await getOrder(invoice.orderId);
    if (!order || order.userId !== userId) return res.status(403).json({ ok: false, error: 'Forbidden' });
    res.json({ ok: true, invoice });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'GetInvoice error');
    return sendError(res, 500, 'Failed to fetch invoice', 'INVOICE_ERROR');
  }
});

export default router;
