import request from 'supertest';
import { prismaMock as mockPrisma, createTestApp, makeAuthUser } from '../testkit';
import historyRoutes from '../../routes/history.js';

jest.mock('../../services/prisma', () => ({
  prisma: mockPrisma,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn(),
}));

const authUser = makeAuthUser();
const mkApp = () => createTestApp(historyRoutes, { authUser });

beforeEach(() => {
  jest.resetAllMocks();
});

describe('history routes', () => {
  it('GET /history/:exchange/:contract returns records (200)', async () => {
    mockPrisma.fundingHistory.findUnique.mockResolvedValue({
      records: [{ timestamp: new Date(), funding: 0.001 }],
    });
    mockPrisma.fundingRecord.count.mockResolvedValue(1);
    const res = await request(mkApp()).get('/history/binance/BTCUSDT');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.history)).toBe(true);
  });

  it('GET /history/:exchange/:contract returns 500 on prisma error', async () => {
    mockPrisma.fundingHistory.findUnique.mockRejectedValue(new Error('db down'));
    const res = await request(mkApp()).get('/history/binance/BTCUSDT');
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });
});
