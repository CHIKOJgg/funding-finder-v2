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
import { logger } from '../utils/logger.js';

const router = Router();

const createOrderSchema = z.object({
  planId: z.enum(['basic', 'pro', 'promax']),
  currency: z.string().default('USDT'),
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
    const { planId, currency } = req.body;
    const result = await createOrder(planId, currency, userId);
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

    if (order.invoiceId) {
      const invoiceStatus = await getInvoiceStatus(order.invoiceId);
      if (invoiceStatus) {
        await updateOrderFromWebhook(order.invoiceId, invoiceStatus.status);
        return res.json({ ok: true, order: { ...order, status: invoiceStatus.status } });
      }
    }

    return res.json({ ok: true, order });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'OrderStatus error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

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
