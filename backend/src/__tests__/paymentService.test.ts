import { prismaMock } from './testkit';
import { config } from '../config/index.js';
import crypto from 'crypto';

jest.mock('../services/prisma', () => ({
  prisma: prismaMock,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
}));

import {
  verifyCryptoPaySignature,
  getUser,
  handleReferral,
  generateReferralLink,
  createOrder,
  updateOrderFromWebhook,
} from '../services/paymentService.js';

const ORIGINAL_TOKEN = config.cryptoPay.apiToken;

describe('paymentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prismaMock as any).$transaction = jest.fn((arg: any) => {
      if (typeof arg !== 'function') return Promise.resolve(arg);
      return arg(prismaMock);
    });
    config.cryptoPay.apiToken = '';
  });

  afterAll(() => {
    config.cryptoPay.apiToken = ORIGINAL_TOKEN;
  });

  describe('verifyCryptoPaySignature', () => {
    it('rejects when the API token is not configured', () => {
      expect(verifyCryptoPaySignature('body', 'sig')).toBe(false);
    });

    it('rejects a missing signature', () => {
      config.cryptoPay.apiToken = 'secret';
      expect(verifyCryptoPaySignature('body', '')).toBe(false);
    });

    it('accepts a correct HMAC-SHA256 signature over the raw body', () => {
      config.cryptoPay.apiToken = 'secret';
      const body = '{"invoice_id":123}';
      const sig = crypto.createHmac('sha256', 'secret').update(body).digest('hex');
      expect(verifyCryptoPaySignature(body, sig)).toBe(true);
    });

    it('rejects a tampered signature', () => {
      config.cryptoPay.apiToken = 'secret';
      const body = '{"invoice_id":123}';
      const sig = crypto.createHmac('sha256', 'secret').update('other').digest('hex');
      expect(verifyCryptoPaySignature(body, sig)).toBe(false);
    });
  });

  describe('getUser', () => {
    it('creates a user when none exists', async () => {
      (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.user.create as jest.Mock).mockResolvedValue({ telegramId: 'tg_9', referralCode: 'RC' });
      const user = await getUser('tg_9');
      expect(prismaMock.user.create).toHaveBeenCalled();
      expect(user.telegramId).toBe('tg_9');
    });

    it('returns the existing user without creating', async () => {
      (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({ telegramId: 'tg_9' });
      const user = await getUser('tg_9');
      expect(prismaMock.user.create).not.toHaveBeenCalled();
      expect(user.telegramId).toBe('tg_9');
    });
  });

  describe('handleReferral', () => {
    it('links a new user to the referrer and awards a trial scan', async () => {
      // user.findUnique is called twice (referrer, then existingUser).
      (prismaMock.user.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'ref-id', referralCode: 'RC' })
        .mockResolvedValueOnce(null);
      (prismaMock.user.create as jest.Mock).mockResolvedValue({ telegramId: 'tg_new' });
      (prismaMock.user.update as jest.Mock).mockResolvedValue({});

      const ok = await handleReferral('tg_new', 'RC');
      expect(ok).toBe(true);
      expect(prismaMock.user.update).toHaveBeenCalledTimes(2);
    });

    it('returns false when the referrer does not exist', async () => {
      (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(null);
      expect(await handleReferral('tg_new', 'RC')).toBe(false);
    });
  });

  describe('generateReferralLink', () => {
    it('builds a t.me referral link', async () => {
      (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({ referralCode: 'ABC' });
      const link = await generateReferralLink('tg_1');
      expect(link).toContain('https://t.me/');
      expect(link).toContain('ref_ABC');
    });
  });

  describe('createOrder', () => {
    it('creates a simulated crypto_pay order when no token is configured', async () => {
      (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.user.create as jest.Mock).mockResolvedValue({ telegramId: 'tg_1' });

      const res = await createOrder('pro', 'USDT', 'tg_1');
      expect(res.ok).toBe(true);
      expect(res.provider).toBe('crypto_pay');
      expect(res.invoiceId).toMatch(/^sim_/);
      // order.create + invoice.create happen inside the prisma transaction.
      expect(prismaMock.order.create).toHaveBeenCalled();
      expect(prismaMock.invoice.create).toHaveBeenCalled();
    });

    it('throws when the plan is invalid', async () => {
      await expect(createOrder('bogus' as any, 'USDT', 'tg_1')).rejects.toThrow(/Invalid plan/);
    });
  });

  describe('updateOrderFromWebhook', () => {
    const orderObj = { id: 'order_1', userId: 'tg_1', planId: 'pro', amount: 99, currency: 'usdt', invoiceId: 'inv_1' };

    // prismaMock shares the `findUnique` mock across ALL models, so route by the
    // where-key: `id` -> order, `userId` -> paymentHistory lookup.
    function routeFindUnique() {
      (prismaMock.order.findUnique as jest.Mock).mockImplementation((args: any) => {
        if (args?.where?.id) return Promise.resolve(orderObj);
        return Promise.resolve(null); // paymentHistory.findUnique({ where: { userId } })
      });
    }

    it('grants the subscription and records payment on paid', async () => {
      (prismaMock.order.findUnique as jest.Mock).mockResolvedValue(orderObj);
      (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({ subscription: 'free' });
      (prismaMock.user.update as jest.Mock).mockResolvedValue({});
      (prismaMock.paymentHistory.create as jest.Mock).mockResolvedValue({ id: 'ph1' });
      (prismaMock.paymentRecord.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.paymentRecord.create as jest.Mock).mockResolvedValue({});
      (prismaMock.invoice.updateMany as jest.Mock).mockResolvedValue({});

      const updated = await updateOrderFromWebhook('order_1', 'paid');
      expect(updated).toBeDefined();
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { telegramId: 'tg_1' }, data: { subscription: 'pro' } })
      );
      expect(prismaMock.paymentRecord.create).toHaveBeenCalled();
    });

    it('is idempotent: a second paid call does not create a duplicate record', async () => {
      routeFindUnique();
      (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({ subscription: 'free' });
      (prismaMock.user.update as jest.Mock).mockResolvedValue({});
      (prismaMock.paymentHistory.create as jest.Mock).mockResolvedValue({ id: 'ph1' });
      (prismaMock.paymentRecord.findUnique as jest.Mock).mockResolvedValue(null);
      const created = await updateOrderFromWebhook('order_1', 'paid');
      expect(created).toBeDefined();

      // On the second call the order is already 'paid' and a record already exists.
      (prismaMock.paymentRecord.findUnique as jest.Mock).mockResolvedValue({ id: 'pr1' });
      await updateOrderFromWebhook('order_1', 'paid');
      // Exactly one create across both calls.
      expect(prismaMock.paymentRecord.create).toHaveBeenCalledTimes(1);
    });

    it('never downgrades: buying basic over promax keeps promax', async () => {
      const cheapOrder = { ...orderObj, planId: 'basic' };
      (prismaMock.order.findUnique as jest.Mock).mockImplementation((args: any) =>
        args?.where?.id ? Promise.resolve(cheapOrder) : Promise.resolve(null)
      );
      (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({ subscription: 'promax' });
      (prismaMock.user.update as jest.Mock).mockResolvedValue({});
      (prismaMock.paymentHistory.create as jest.Mock).mockResolvedValue({ id: 'ph1' });
      (prismaMock.paymentRecord.findUnique as jest.Mock).mockResolvedValue(null);

      await updateOrderFromWebhook('order_1', 'paid');
      expect(prismaMock.user.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { subscription: 'basic' } })
      );
    });

    it('returns null when the order cannot be found', async () => {
      (prismaMock.order.findUnique as jest.Mock).mockResolvedValue(null);
      expect(await updateOrderFromWebhook('nope', 'paid')).toBeNull();
    });

    it('just updates the status for a non-paid status', async () => {
      (prismaMock.order.findUnique as jest.Mock).mockResolvedValue({ id: 'order_1', userId: 'tg_1', planId: 'pro' });
      (prismaMock.order.update as jest.Mock).mockResolvedValue({});
      (prismaMock.invoice.updateMany as jest.Mock).mockResolvedValue({});
      const updated = await updateOrderFromWebhook('order_1', 'waiting');
      // The shared `update` mock also backs order.update (which IS called);
      // instead verify no payment record was created for a non-paid status.
      expect(prismaMock.paymentRecord.create).not.toHaveBeenCalled();
      expect(updated).toBeDefined();
    });
  });
});
