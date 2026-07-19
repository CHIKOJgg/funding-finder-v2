import { prismaMock } from './testkit';
import { config } from '../config/index.js';

const mockTx = jest.fn();
jest.mock('axios');
jest.mock('../services/prisma', () => ({
  prisma: new Proxy(prismaMock, {
    get(target, prop) {
      if (prop === '$transaction') return mockTx;
      if (prop === '$queryRaw' || prop === '$queryRawUnsafe' || prop === '$executeRaw') return jest.fn();
      return (target as any)[prop];
    },
  }),
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
}));

import crypto from 'crypto';
import {
  createNowPaymentsPayment,
  verifyNowPaymentsSignature,
  mapNowPaymentsStatus,
  handleNowPaymentsWebhook,
} from '../services/nowPaymentsService.js';

const ORIGINAL_IPN = config.nowPayments.ipnSecret;

describe('nowPaymentsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTx.mockImplementation((arg: any) =>
      typeof arg === 'function' ? arg(prismaMock) : Promise.resolve(arg)
    );
    config.nowPayments.ipnSecret = '';
  });

  afterAll(() => {
    config.nowPayments.ipnSecret = ORIGINAL_IPN;
  });

  describe('mapNowPaymentsStatus', () => {
    it('maps paid-family statuses to paid', () => {
      expect(mapNowPaymentsStatus('finished')).toBe('paid');
      expect(mapNowPaymentsStatus('confirmed')).toBe('paid');
      expect(mapNowPaymentsStatus('sending')).toBe('paid');
    });
    it('maps failed-family statuses to failed', () => {
      expect(mapNowPaymentsStatus('failed')).toBe('failed');
      expect(mapNowPaymentsStatus('expired')).toBe('failed');
    });
    it('maps confirming and waiting appropriately', () => {
      expect(mapNowPaymentsStatus('confirming')).toBe('confirming');
      expect(mapNowPaymentsStatus('waiting')).toBe('waiting');
      expect(mapNowPaymentsStatus('partially_paid')).toBe('waiting');
    });
  });

  describe('verifyNowPaymentsSignature', () => {
    it('rejects when the IPN secret is not configured', () => {
      expect(verifyNowPaymentsSignature('body', 'sig')).toBe(false);
    });

    it('accepts a correct HMAC-SHA512 signature', () => {
      config.nowPayments.ipnSecret = 'topsecret';
      const body = 'order_id=order_1&payment_status=finished';
      const sig = crypto.createHmac('sha512', 'topsecret').update(body).digest('hex');
      expect(verifyNowPaymentsSignature(body, sig)).toBe(true);
    });

    it('rejects a tampered signature', () => {
      config.nowPayments.ipnSecret = 'topsecret';
      const body = 'order_id=order_1';
      const sig = crypto.createHmac('sha512', 'topsecret').update('different').digest('hex');
      expect(verifyNowPaymentsSignature(body, sig)).toBe(false);
    });
  });

  describe('createNowPaymentsPayment', () => {
    it('returns a simulated payment when no API key is configured', async () => {
      const plan = { price: 99, name: 'Pro', features: [] };
      const p = await createNowPaymentsPayment(plan as any, 'pro', 'usdt', 'order_1');
      expect(p.simulated).toBe(true);
      expect(p.payCurrency).toBe('USDT');
      expect(p.paymentId).toMatch(/^sim_/);
    });
  });

  describe('handleNowPaymentsWebhook', () => {
    // With per-model mocks, set both `order` and `invoice` findUnique.
    function routeFindUnique(order: any, invoice: any) {
      (prismaMock.order.findUnique as jest.Mock).mockImplementation((args: any) => {
        if (args?.where?.id || args?.where?.invoiceId) return Promise.resolve(order);
        return Promise.resolve(null);
      });
      (prismaMock.order.findFirst as jest.Mock).mockImplementation((args: any) =>
        args?.where?.invoiceId ? Promise.resolve(order) : Promise.resolve(null)
      );
      (prismaMock.invoice.findUnique as jest.Mock).mockImplementation((args: any) =>
        args?.where?.orderId ? Promise.resolve(invoice) : Promise.resolve(null)
      );
    }

    it('ignores an update with no identifiers', async () => {
      const res = await handleNowPaymentsWebhook({});
      expect(res).toEqual({ success: false, processed: false });
    });

    it('ignores an unknown order', async () => {
      (prismaMock.order.findUnique as jest.Mock).mockResolvedValue(null);
      const res = await handleNowPaymentsWebhook({ order_id: 'missing', payment_status: 'finished' });
      expect(res).toEqual({ success: false, processed: false });
    });

    it('reflects confirming status without granting', async () => {
      routeFindUnique({ id: 'order_1', userId: 'tg_1', planId: 'pro' }, null);
      (prismaMock.invoice.updateMany as jest.Mock).mockResolvedValue({});
      (prismaMock.order.update as jest.Mock).mockResolvedValue({});
      const res = await handleNowPaymentsWebhook({ order_id: 'order_1', payment_status: 'confirming' });
      expect(res.success).toBe(true);
      expect(res.processed).toBe(false);
      expect(res.status).toBe('confirming');
    });

    it('does not grant when the paid amount is too low', async () => {
      routeFindUnique(
        { id: 'order_1', userId: 'tg_1', planId: 'pro', amount: 99 },
        { payAmount: 99 }
      );
      (prismaMock.invoice.updateMany as jest.Mock).mockResolvedValue({});

      const res = await handleNowPaymentsWebhook({ order_id: 'order_1', payment_status: 'finished', actually_paid: 50 });
      expect(res.success).toBe(false);
      expect(res.processed).toBe(false);
    });
  });
});
