import request from 'supertest';
import { prismaMock as mockPrisma, createTestApp, makeAuthUser } from '../testkit';
import portfolioLiveRoutes from '../../routes/portfolioLive.js';

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
const mkApp = (auth = true) => createTestApp(portfolioLiveRoutes, auth ? { authUser } : {});

beforeEach(() => {
  jest.resetAllMocks();
});

describe('portfolioLive routes', () => {
  it('GET /portfolio/live aggregates across keys (200)', async () => {
    mockPrisma.apiKey.findMany.mockResolvedValue([]);
    const res = await request(mkApp()).get('/portfolio/live');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.exchanges).toEqual([]);
  });

  it('GET /portfolio/live returns 401 without auth', async () => {
    const res = await request(mkApp(false)).get('/portfolio/live');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('POST /portfolio/auto-execute returns 400 when confirm missing', async () => {
    const res = await request(mkApp())
      .post('/portfolio/auto-execute')
      .send({ exchange: 'binance', symbol: 'BTCUSDT', side: 'long', notionalUsd: 100, confirm: false });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});
