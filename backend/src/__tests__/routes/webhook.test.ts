import request from 'supertest';
import { prismaMock as mockPrisma, createTestApp, makeAuthUser } from '../testkit';
import webhookRoutes from '../../routes/webhook.js';

jest.mock('../../services/prisma', () => ({
  prisma: mockPrisma,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn(),
}));
jest.mock('../../services/paymentService', () => ({
  createOrder: jest.fn(),
  getOrder: jest.fn(),
  getInvoice: jest.fn(),
  getInvoiceStatus: jest.fn(),
  updateOrderFromWebhook: jest.fn(),
  getWithdrawalHistory: jest.fn(),
  getPaymentHistory: jest.fn(),
  getUserBalance: jest.fn(),
  generateReferralLink: jest.fn(),
  handleReferral: jest.fn(),
  getUser: jest.fn(),
  verifyCryptoPaySignature: jest.fn(),
  handleCryptoPayWebhook: jest.fn(),
}));
jest.mock('../../services/nowPaymentsService', () => ({
  getNowPaymentsStatus: jest.fn(),
  mapNowPaymentsStatus: jest.fn(),
  verifyNowPaymentsSignature: jest.fn(),
  handleNowPaymentsWebhook: jest.fn(),
}));

import * as paymentService from '../../services/paymentService';
import * as nowPaymentsService from '../../services/nowPaymentsService';

const authUser = makeAuthUser();
const mkApp = () => createTestApp(webhookRoutes, { authUser });
const TOKEN = process.env.WEBHOOK_SECRET || 'test-webhook-secret-at-least-32-chars-long!!';

beforeEach(() => {
  jest.resetAllMocks();
});

describe('webhook routes', () => {
  it('POST /payment updates an order (200)', async () => {
    (paymentService.updateOrderFromWebhook as jest.Mock).mockResolvedValue({ id: 'o1', status: 'paid' });
    const res = await request(mkApp())
      .post('/payment')
      .set('x-webhook-token', TOKEN)
      .send({ orderId: 'o1', status: 'paid' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /payment returns 401 on bad token', async () => {
    const res = await request(mkApp()).post('/payment').set('x-webhook-token', 'wrong').send({ orderId: 'o1' });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('POST /crypto-pay processes webhook (200)', async () => {
    (paymentService.verifyCryptoPaySignature as jest.Mock).mockReturnValue(true);
    (paymentService.handleCryptoPayWebhook as jest.Mock).mockResolvedValue({ success: true });
    const res = await request(mkApp())
      .post('/crypto-pay')
      .set('crypto-pay-api-signature', 'sig')
      .send({ update_id: 1, payload: { invoice_id: 'inv1' } });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /crypto-pay returns 401 on invalid signature', async () => {
    (paymentService.verifyCryptoPaySignature as jest.Mock).mockReturnValue(false);
    const res = await request(mkApp()).post('/crypto-pay').set('crypto-pay-api-signature', 'bad').send({});
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('POST /nowpayments processes webhook (200)', async () => {
    (nowPaymentsService.verifyNowPaymentsSignature as jest.Mock).mockReturnValue(true);
    (nowPaymentsService.handleNowPaymentsWebhook as jest.Mock).mockResolvedValue({ success: true });
    const res = await request(mkApp())
      .post('/nowpayments')
      .set('x-nowpayments-sig', 'sig')
      .send({ payment_id: 'p1', payment_status: 'paid' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /nowpayments returns 401 on invalid signature', async () => {
    (nowPaymentsService.verifyNowPaymentsSignature as jest.Mock).mockReturnValue(false);
    const res = await request(mkApp()).post('/nowpayments').set('x-nowpayments-sig', 'bad').send({});
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });
});
