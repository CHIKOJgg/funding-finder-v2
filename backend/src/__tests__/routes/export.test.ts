import request from 'supertest';
import { prismaMock as mockPrisma, createTestApp, makeAuthUser } from '../testkit';
import exportRoutes from '../../routes/export.js';

jest.mock('../../services/prisma', () => ({
  prisma: mockPrisma,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn(),
}));

const authUser = makeAuthUser();
const mkApp = (auth = true) => createTestApp(exportRoutes, auth ? { authUser } : {});

beforeEach(() => {
  jest.resetAllMocks();
});

describe('export routes', () => {
  it('GET /export/csv returns CSV (200)', async () => {
    mockPrisma.fundingHistory.findMany.mockResolvedValue([]);
    const res = await request(mkApp()).get('/export/csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
  });

  it('GET /export/csv returns 401 without auth', async () => {
    const res = await request(mkApp(false)).get('/export/csv');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('GET /export/csv returns 400 for out-of-range days', async () => {
    const res = await request(mkApp()).get('/export/csv?days=0');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});
