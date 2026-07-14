import request from 'supertest';
import { prismaMock as mockPrisma, createTestApp, makeAuthUser } from '../testkit';
import scanRoutes from '../../routes/scan.js';

jest.mock('../../services/prisma', () => ({
  prisma: mockPrisma,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn(),
}));
jest.mock('../../services/scanService', () => ({
  runScan: jest.fn(),
  getCachedScan: jest.fn(),
}));
jest.mock('../../services/websocket', () => ({
  wsManager: { broadcast: jest.fn() },
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

import * as scanService from '../../services/scanService';

const authUser = makeAuthUser();

function mkApp(auth = true) {
  return createTestApp(scanRoutes, auth ? { authUser } : {});
}

const scanResult = {
  scanned: 1,
  highYield: [{ contract: 'BTCUSDT', exchange: 'gate', funding_rate_per_hour: 0.0001 }],
  mediumYield: [],
  lowYield: [],
  metrics: { intervalDistribution: {}, averageIntervalHours: 8 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSubscription.getSubscriptionLimits.mockResolvedValue({
    tier: 'pro',
    maxExchanges: 25,
    watchlistLimit: -1,
    aiEnabled: true,
    recommendationsEnabled: true,
    portfolioEnabled: true,
  });
});

describe('scan routes', () => {
  it('POST /scan returns 200 with scanned results', async () => {
    (scanService.getCachedScan as jest.Mock).mockReturnValue(null);
    (scanService.runScan as jest.Mock).mockResolvedValue(scanResult);

    const res = await request(mkApp()).post('/scan').send({ exchanges: ['gate'] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.result).toEqual(scanResult);
  });

  it('POST /scan rejects invalid exchanges with 400', async () => {
    const res = await request(mkApp()).post('/scan').send({ exchanges: ['not-a-real-exchange'] });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('POST /scan returns 403 when exchange count exceeds plan limit', async () => {
    mockSubscription.getSubscriptionLimits.mockResolvedValue({
      tier: 'free',
      maxExchanges: 1,
      watchlistLimit: 3,
      aiEnabled: false,
      recommendationsEnabled: false,
      portfolioEnabled: false,
    });

    const res = await request(mkApp()).post('/scan').send({ exchanges: ['gate', 'binance'] });
    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
  });

  it('POST /scan serves cached result without re-running scan', async () => {
    (scanService.getCachedScan as jest.Mock).mockReturnValue({ result: scanResult, ageMs: 1000 });
    (scanService.runScan as jest.Mock).mockResolvedValue(scanResult);

    const res = await request(mkApp()).post('/scan').send({ exchanges: ['gate'] });
    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(scanService.runScan).not.toHaveBeenCalled();
  });
});
