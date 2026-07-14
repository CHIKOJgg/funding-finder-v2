import request from 'supertest';
import { prismaMock as mockPrisma, createTestApp, makeAuthUser } from '../testkit';
import referralsRoutes from '../../routes/referrals.js';

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

import * as paymentService from '../../services/paymentService';

const authUser = makeAuthUser();
const mkApp = () => createTestApp(referralsRoutes, { authUser });

beforeEach(() => {
  jest.resetAllMocks();
});

describe('referrals routes', () => {
  it('GET /referral/link returns a link (200)', async () => {
    (paymentService.generateReferralLink as jest.Mock).mockResolvedValue('https://link');
    const res = await request(mkApp()).get('/referral/link');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.link).toBe('https://link');
  });

  it('GET /referral/list returns referral count (200)', async () => {
    (paymentService.getUser as jest.Mock).mockResolvedValue({ id: 'u1' });
    mockPrisma.user.count.mockResolvedValue(3);
    const res = await request(mkApp()).get('/referral/list');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.referrals).toBe(3);
  });

  it('POST /referral/apply applies a code (200)', async () => {
    (paymentService.handleReferral as jest.Mock).mockResolvedValue(true);
    const res = await request(mkApp()).post('/referral/apply').send({ referralCode: 'ABC' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /referral/apply returns 400 on empty code', async () => {
    const res = await request(mkApp()).post('/referral/apply').send({ referralCode: '' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});
