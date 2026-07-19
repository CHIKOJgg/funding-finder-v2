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
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

const createOrderSchema = z.object({
  planId: z.enum(['basic', 'pro', 'promax', 'ultimate']),
  currency: z.string().default('USDT'),
  // Crypto gateway selection: Crypto Pay (Telegram) or NOWPayments (website).
  provider: z.enum(['crypto_pay', 'nowpayments']).optional().default('crypto_pay'),
  payCurrency: z.string().optional(),
});

const withdrawSchema = z.object({
  amount: z.number().min(10),
  currency: z.string().min(1),
  address: z.string().min(1),
  network: z.string().min(1),
});

router.post('/createOrder', validate(createOrderSchema), async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const { planId, currency, provider, payCurrency } = req.body;
    const result = await createOrder(planId, currency, userId, { provider, payCurrency });
    res.json(result);
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'CreateOrder error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

router.get('/orderStatus/:orderId', async (req, res) => {
  try {
    const order = await getOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });

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
        return res.json({ ok: true, order: { ...order, status: invoiceStatus.status }, invoice });
      }
    }

    return res.json({ ok: true, order, invoice });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'OrderStatus error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
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
      res.status(500).json({ ok: false, error: error.message });
    }
  });
}

router.post('/withdraw', validate(withdrawSchema), async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const { amount, currency, address, network } = req.body;

    const { prisma } = await import('../services/prisma.js');
    const result = await prisma.$transaction(async (tx: any) => {
      const user = await tx.user.findUnique({ where: { telegramId: userId } });
      if (!user || user.balance < amount) {
        throw new Error('Insufficient balance');
      }

      await tx.user.update({
        where: { telegramId: userId },
        data: { balance: { decrement: amount } },
      });

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
    res.status(500).json({ ok: false, error: error.message || String(error) });
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
    res.status(500).json({ ok: false, error: error.message || String(error) });
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
    res.status(500).json({ ok: false, error: error.message || String(error) });
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
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

router.get('/invoice/:orderId', async (req, res) => {
  try {
    const invoice = await getInvoice(req.params.orderId);
    if (!invoice) return res.status(404).json({ ok: false, error: 'Invoice not found' });
    res.json({ ok: true, invoice });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'GetInvoice error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

export default router;
