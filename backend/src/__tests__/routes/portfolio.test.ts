import request from 'supertest';
import { prismaMock as mockPrisma, createTestApp, makeAuthUser } from '../testkit';
import portfolioRoutes from '../../routes/portfolio.js';

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
const mkApp = (auth = true) => createTestApp(portfolioRoutes, auth ? { authUser } : {});

beforeEach(() => {
  jest.resetAllMocks();
});

describe('portfolio routes', () => {
  it('GET /portfolio lists positions (200)', async () => {
    mockPrisma.portfolioPosition.findMany.mockResolvedValue([]);
    const res = await request(mkApp()).get('/portfolio');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.positions)).toBe(true);
  });

  it('POST /portfolio adds a position (200)', async () => {
    mockPrisma.portfolioPosition.create.mockResolvedValue({ id: 'p1' });
    const res = await request(mkApp())
      .post('/portfolio')
      .send({ exchange: 'binance', pair: 'BTCUSDT', side: 'long', sizeUsd: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /portfolio returns 401 without auth', async () => {
    const res = await request(mkApp(false))
      .post('/portfolio')
      .send({ exchange: 'binance', pair: 'BTCUSDT', side: 'long', sizeUsd: 1000 });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('POST /portfolio returns 400 on invalid body', async () => {
    const res = await request(mkApp()).post('/portfolio').send({ exchange: '', pair: '' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('DELETE /portfolio removes a position (200)', async () => {
    mockPrisma.portfolioPosition.deleteMany.mockResolvedValue({ count: 1 });
    const res = await request(mkApp()).delete('/portfolio').send({ id: 'p1' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
