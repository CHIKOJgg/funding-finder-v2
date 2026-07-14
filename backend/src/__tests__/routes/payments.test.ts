import request from 'supertest';
import { prismaMock as mockPrisma, createTestApp, makeAuthUser } from '../testkit';
import paymentsRoutes from '../../routes/payments.js';

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
}));
jest.mock('../../services/nowPaymentsService', () => ({
  getNowPaymentsStatus: jest.fn(),
  mapNowPaymentsStatus: jest.fn(),
  verifyNowPaymentsSignature: jest.fn(),
  handleNowPaymentsWebhook: jest.fn(),
}));

import * as paymentService from '../../services/paymentService';

const authUser = makeAuthUser();
const mkApp = () => createTestApp(paymentsRoutes, { authUser });

beforeEach(() => {
  jest.resetAllMocks();
});

describe('payments routes', () => {
  it('POST /createOrder creates an order (200)', async () => {
    (paymentService.createOrder as jest.Mock).mockResolvedValue({ ok: true, order: { id: 'o1' } });
    const res = await request(mkApp()).post('/createOrder').send({ planId: 'pro' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /balance returns the user balance (200)', async () => {
    (paymentService.getUserBalance as jest.Mock).mockResolvedValue(10);
    const res = await request(mkApp()).get('/balance');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.balance).toBe(10);
  });

  it('GET /orderStatus/:id returns 404 when order missing', async () => {
    (paymentService.getOrder as jest.Mock).mockResolvedValue(null);
    const res = await request(mkApp()).get('/orderStatus/nope');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('GET /invoice/:id returns 404 when invoice missing', async () => {
    (paymentService.getInvoice as jest.Mock).mockResolvedValue(null);
    const res = await request(mkApp()).get('/invoice/nope');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('POST /withdraw returns 400 when amount below minimum', async () => {
    const res = await request(mkApp())
      .post('/withdraw')
      .send({ amount: 5, currency: 'USDT', address: '0xabc', network: 'eth' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('GET /paymentHistory returns 200', async () => {
    (paymentService.getPaymentHistory as jest.Mock).mockResolvedValue({ history: [], total: 0 });
    const res = await request(mkApp()).get('/paymentHistory');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
