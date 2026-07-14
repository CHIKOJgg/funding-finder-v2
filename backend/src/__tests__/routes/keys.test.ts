import request from 'supertest';
import { prismaMock as mockPrisma, createTestApp, makeAuthUser } from '../testkit';
import keysRoutes from '../../routes/keys.js';

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
const mkApp = (auth = true) => createTestApp(keysRoutes, auth ? { authUser } : {});

beforeEach(() => {
  jest.resetAllMocks();
});

describe('keys routes', () => {
  it('GET /keys lists connected keys (200)', async () => {
    mockPrisma.apiKey.findMany.mockResolvedValue([]);
    const res = await request(mkApp()).get('/keys');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.keys)).toBe(true);
  });

  it('POST /keys adds an encrypted key (200)', async () => {
    mockPrisma.apiKey.create.mockResolvedValue({
      id: 'k1',
      exchange: 'binance',
      label: null,
      permissions: 'read',
      createdAt: new Date(),
    });
    const res = await request(mkApp())
      .post('/keys')
      .send({ exchange: 'binance', apiKey: 'ak', secret: 'sec' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /keys returns 401 without auth', async () => {
    const res = await request(mkApp(false)).post('/keys').send({ exchange: 'binance', apiKey: 'ak', secret: 'sec' });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('POST /keys returns 400 for invalid exchange', async () => {
    const res = await request(mkApp())
      .post('/keys')
      .send({ exchange: 'bogus', apiKey: 'ak', secret: 'sec' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('DELETE /keys/:id removes a key (200)', async () => {
    mockPrisma.apiKey.deleteMany.mockResolvedValue({ count: 1 });
    const res = await request(mkApp()).delete('/keys/k1').send({ id: 'k1' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
