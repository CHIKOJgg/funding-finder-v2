import request from 'supertest';
import { prismaMock as mockPrisma, createTestApp, makeAuthUser } from '../testkit';
import analyticsRoutes from '../../routes/analytics.js';

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
const mkApp = () => createTestApp(analyticsRoutes, { authUser });

const records = [{ timestamp: new Date('2024-01-01T00:00:00Z'), funding: 0.001 }];

beforeEach(() => {
  jest.resetAllMocks();
  mockSubscription.getPlanTier.mockImplementation((s: string) => s);
});

describe('analytics routes', () => {
  it('GET /analytics/apr requires exchange and contract (400)', async () => {
    const res = await request(mkApp()).get('/analytics/apr');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('GET /analytics/apr computes APR (200)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ subscription: 'pro' });
    mockPrisma.fundingHistory.findUnique.mockResolvedValue({ records });
    mockPrisma.contractMetadata = mockPrisma.contractMetadata || {};
    const res = await request(mkApp()).get('/analytics/apr?exchange=binance&contract=BTCUSDT');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.apr).toBeDefined();
  });

  it('GET /analytics/trends/:exchange/:contract returns trends (200)', async () => {
    mockPrisma.fundingHistory.findUnique.mockResolvedValue({ records });
    const res = await request(mkApp()).get('/analytics/trends/binance/BTCUSDT');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.trends)).toBe(true);
  });

  it('GET /analytics/top-movers returns movers (200)', async () => {
    mockPrisma.fundingHistory.findMany.mockResolvedValue([]);
    const res = await request(mkApp()).get('/analytics/top-movers');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /analytics/exchange-stats returns stats (200)', async () => {
    mockPrisma.fundingHistory.findMany.mockResolvedValue([]);
    const res = await request(mkApp()).get('/analytics/exchange-stats');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
