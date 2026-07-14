import request from 'supertest';
import { prismaMock as mockPrisma, createTestApp, makeAuthUser } from '../testkit';
import adminRoutes from '../../routes/admin.js';

jest.mock('../../services/prisma', () => ({
  prisma: mockPrisma,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn(),
}));

var mockJobQueue: any;
jest.mock('../../services/jobQueue', () => {
  mockJobQueue = {
    getJobStats: jest.fn().mockResolvedValue({}),
    scanQueue: null,
    alertQueue: null,
    initJobQueues: jest.fn(),
  };
  return mockJobQueue;
});

var mockDataArchival: any;
jest.mock('../../services/dataArchival', () => {
  mockDataArchival = {
    getArchiveStats: jest.fn().mockResolvedValue(null),
    startDataArchival: jest.fn(),
    stopDataArchival: jest.fn(),
  };
  return mockDataArchival;
});

var mockAdmin: any;
jest.mock('../../middleware/admin', () => {
  mockAdmin = {
    requireAdmin: jest.fn((_req: any, _res: any, next: any) => next()),
  };
  return mockAdmin;
});

const authUser = makeAuthUser();
const mkApp = () => createTestApp(adminRoutes, { authUser });

beforeEach(() => {
  jest.resetAllMocks();
  mockAdmin.requireAdmin.mockImplementation((_req: any, _res: any, next: any) => next());
  mockJobQueue.getJobStats.mockResolvedValue({});
  mockDataArchival.getArchiveStats.mockResolvedValue(null);
});

describe('admin routes', () => {
  it('GET /admin/users lists users (200)', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.user.count.mockResolvedValue(0);
    const res = await request(mkApp()).get('/admin/users');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /admin/stats returns stats (200)', async () => {
    mockPrisma.user.count.mockResolvedValue(0);
    mockPrisma.user.groupBy.mockResolvedValue([]);
    mockPrisma.order.count.mockResolvedValue(0);
    mockPrisma.order.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    mockPrisma.generalAlert.count.mockResolvedValue(0);
    mockPrisma.fundingRecord.count.mockResolvedValue(0);
    const res = await request(mkApp()).get('/admin/stats');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.stats).toBeDefined();
  });

  it('PATCH /admin/users/:id/subscription updates plan (200)', async () => {
    mockPrisma.user.update.mockResolvedValue({ telegramId: 'u1', subscription: 'pro' });
    const res = await request(mkApp()).patch('/admin/users/u1/subscription').send({ subscription: 'pro' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('PATCH /admin/users/:id/subscription rejects invalid plan (400)', async () => {
    const res = await request(mkApp()).patch('/admin/users/u1/subscription').send({ subscription: 'diamond' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('DELETE /admin/users/:id deletes a user (200)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ telegramId: 'u1' });
    mockPrisma.$transaction.mockResolvedValue(undefined);
    const res = await request(mkApp()).delete('/admin/users/u1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
