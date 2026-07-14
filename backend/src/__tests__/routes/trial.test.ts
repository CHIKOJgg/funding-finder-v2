import request from 'supertest';
import { prismaMock as mockPrisma, createTestApp, makeAuthUser } from '../testkit';
import trialRoutes from '../../routes/trial.js';

jest.mock('../../services/prisma', () => ({
  prisma: mockPrisma,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn(),
}));

var mockSubscription: any;
jest.mock('../../middleware/subscription', () => {
  mockSubscription = {
    requireSubscription: jest.fn(() => (_req: any, _res: any, next: any) => next()),
    getSubscriptionLimits: jest.fn(),
    enforceTrialExpiry: jest.fn().mockResolvedValue(false),
    getPlanTier: jest.fn((s: string) => s),
    getPlanLimitsForTier: jest.fn(() => ({})),
    TRIAL_DURATION_DAYS: 3,
  };
  return mockSubscription;
});

const authUser = makeAuthUser();
const mkApp = (auth = true) => createTestApp(trialRoutes, auth ? { authUser } : {});

beforeEach(() => {
  jest.resetAllMocks();
});

describe('trial routes', () => {
  it('POST /trial/activate activates the trial (200)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ subscription: 'free', trialUsed: false });
    mockPrisma.user.update.mockResolvedValue({ trialEndsAt: new Date() });
    const res = await request(mkApp()).post('/trial/activate');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.active).toBe(true);
  });

  it('POST /trial/activate returns 401 without auth', async () => {
    const res = await request(mkApp(false)).post('/trial/activate');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('POST /trial/activate returns 409 when already used', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ subscription: 'free', trialUsed: true });
    const res = await request(mkApp()).post('/trial/activate');
    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
  });

  it('GET /trial/status returns status (200)', async () => {
    mockSubscription.enforceTrialExpiry.mockResolvedValue(false);
    mockPrisma.user.findUnique.mockResolvedValue({
      subscription: 'pro',
      trialUsed: true,
      trialEndsAt: new Date(Date.now() + 2 * 24 * 3600 * 1000),
    });
    const res = await request(mkApp()).get('/trial/status');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.active).toBe(true);
  });
});
