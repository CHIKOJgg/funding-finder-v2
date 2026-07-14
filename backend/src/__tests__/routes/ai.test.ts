import request from 'supertest';
import { prismaMock as mockPrisma, createTestApp, makeAuthUser } from '../testkit';
import aiRoutes from '../../routes/ai.js';

jest.mock('../../services/prisma', () => ({
  prisma: mockPrisma,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn(),
}));
jest.mock('../../services/aiService', () => ({
  askAIForTop3: jest.fn(),
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

import * as aiService from '../../services/aiService';

const authUser = makeAuthUser();
const mkApp = () => createTestApp(aiRoutes, { authUser });

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

describe('ai routes', () => {
  it('POST /ai returns 200 with analysis', async () => {
    (aiService.askAIForTop3 as jest.Mock).mockResolvedValue({ note: 'analysis' });
    const res = await request(mkApp()).post('/ai').send({ listText: 'BTC gate 0.01' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.ai).toEqual({ note: 'analysis' });
  });

  it('POST /ai returns 400 when listText is empty', async () => {
    const res = await request(mkApp()).post('/ai').send({ listText: '' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('POST /recommend returns 200 with generated text', async () => {
    const recItem = {
      contract: 'BTCUSDT',
      exchange: 'gate',
      currentFunding: 0.0001,
      funding_rate_per_hour: 0.00001,
      funding_rate_per_day: 0.0002,
      annualized_rate: 0.07,
      volume_24h_settle: 1000000,
      funding_interval_seconds: 28800,
      funding_interval_source: 'default',
    };
    const res = await request(mkApp())
      .post('/recommend')
      .send({ list: [recItem], capital: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.text).toBe('string');
  });

  it('POST /recommend returns 400 when capital below minimum', async () => {
    const res = await request(mkApp())
      .post('/recommend')
      .send({ list: [], capital: 50 });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});
