import request from 'supertest';
import { prismaMock as mockPrisma, createTestApp, makeAuthUser } from '../testkit';
import watchlistRoutes from '../../routes/watchlist.js';

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
const mkApp = (auth = true) => createTestApp(watchlistRoutes, auth ? { authUser } : {});

beforeEach(() => {
  jest.resetAllMocks();
  mockSubscription.getSubscriptionLimits.mockResolvedValue({
    tier: 'pro',
    maxExchanges: 25,
    watchlistLimit: -1,
    aiEnabled: true,
    recommendationsEnabled: true,
    portfolioEnabled: true,
  });
});

describe('watchlist routes', () => {
  it('GET /watchlist lists items (200)', async () => {
    mockPrisma.watchlistItem.findMany.mockResolvedValue([]);
    const res = await request(mkApp()).get('/watchlist');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('POST /watchlist adds an item (200)', async () => {
    mockPrisma.watchlistItem.findUnique.mockResolvedValue(null);
    mockPrisma.watchlistItem.create.mockResolvedValue({ id: 'w1' });
    const res = await request(mkApp()).post('/watchlist').send({ exchange: 'gate', pair: 'BTCUSDT' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /watchlist returns 401 without auth', async () => {
    const res = await request(mkApp(false)).post('/watchlist').send({ exchange: 'gate', pair: 'BTCUSDT' });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('POST /watchlist returns 400 on invalid body', async () => {
    const res = await request(mkApp()).post('/watchlist').send({ exchange: '', pair: '' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('POST /watchlist returns 403 when limit reached', async () => {
    mockSubscription.getSubscriptionLimits.mockResolvedValue({
      tier: 'free',
      maxExchanges: 3,
      watchlistLimit: 0,
      aiEnabled: false,
      recommendationsEnabled: false,
      portfolioEnabled: false,
    });
    mockPrisma.watchlistItem.findUnique.mockResolvedValue(null);
    mockPrisma.watchlistItem.count.mockResolvedValue(1);
    const res = await request(mkApp()).post('/watchlist').send({ exchange: 'gate', pair: 'BTCUSDT' });
    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
  });

  it('DELETE /watchlist removes an item (200)', async () => {
    mockPrisma.watchlistItem.deleteMany.mockResolvedValue({ count: 1 });
    const res = await request(mkApp()).delete('/watchlist').send({ exchange: 'gate', pair: 'BTCUSDT' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
