import request from 'supertest';
import { prismaMock as mockPrisma, createTestApp, makeAuthUser } from '../testkit';
import arbitrageRoutes from '../../routes/arbitrage.js';

jest.mock('../../services/prisma', () => ({
  prisma: mockPrisma,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn(),
}));
jest.mock('../../services/arbitrageService', () => ({
  createArbitrageAlert: jest.fn(),
  getUserArbitrageAlerts: jest.fn(),
  deleteArbitrageAlert: jest.fn(),
  toggleArbitrageAlert: jest.fn(),
  detectArbitrageOpportunities: jest.fn(),
  calculateProfit: jest.fn(),
}));
jest.mock('../../services/spotFuturesService', () => ({
  getSpotFutures: jest.fn(),
  SF_SUPPORTED_EXCHANGES: ['binance', 'bybit'],
}));
jest.mock('../../services/priceService', () => ({
  getLivePriceBatch: jest.fn(),
}));
jest.mock('../../services/scanService', () => ({
  runScan: jest.fn(),
  getCachedScan: jest.fn().mockReturnValue(null),
}));

import * as arbitrageService from '../../services/arbitrageService';
import * as scanService from '../../services/scanService';

const authUser = makeAuthUser();
const mkApp = () => createTestApp(arbitrageRoutes, { authUser });

const scanShape = {
  scanned: 0,
  highYield: [],
  mediumYield: [],
  lowYield: [],
  metrics: { intervalDistribution: {}, averageIntervalHours: 8 },
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe('arbitrage routes', () => {
  it('POST /alerts/arbitrage creates alert (200)', async () => {
    (arbitrageService.createArbitrageAlert as jest.Mock).mockResolvedValue({ id: 'arb-1' });
    const res = await request(mkApp())
      .post('/alerts/arbitrage')
      .send({ pair: 'BTCUSDT', exchangeA: 'gate', exchangeB: 'binance' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /alerts/arbitrage returns 400 on invalid body', async () => {
    const res = await request(mkApp()).post('/alerts/arbitrage').send({ pair: '' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('GET /arbitrage/opportunities returns 200', async () => {
    (scanService.runScan as jest.Mock).mockResolvedValue(scanShape);
    (arbitrageService.detectArbitrageOpportunities as jest.Mock).mockResolvedValue([]);
    const res = await request(mkApp()).get('/arbitrage/opportunities');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.opportunities)).toBe(true);
  });

  it('POST /arbitrage/calculate-profit returns 200', async () => {
    (arbitrageService.calculateProfit as jest.Mock).mockResolvedValue({
      profit: { netHourly: 1, netDaily: 2, netAnnual: 3, hourlyReturn: 0.1, annualReturn: 0.5 },
      risk: {},
    });
    const res = await request(mkApp())
      .post('/arbitrage/calculate-profit')
      .send({
        opportunity: {
          exchangeA: 'gate',
          exchangeB: 'binance',
          difference: 0.01,
          difference_per_day: 0.1,
          volumeA: 1,
          volumeB: 1,
          intervalA_hours: 8,
          intervalB_hours: 8,
          intervalMismatch: false,
          percentageDiff: 1,
        },
        capital: 1000,
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.profit).toBeDefined();
  });

  it('DELETE /alerts/arbitrage/:id returns 404 when missing', async () => {
    (arbitrageService.deleteArbitrageAlert as jest.Mock).mockResolvedValue(false);
    const res = await request(mkApp()).delete('/alerts/arbitrage/nope');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});
