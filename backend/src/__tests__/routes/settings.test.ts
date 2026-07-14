import request from 'supertest';
import { prismaMock as mockPrisma, createTestApp, makeAuthUser } from '../testkit';
import settingsRoutes from '../../routes/settings.js';

jest.mock('../../services/prisma', () => ({
  prisma: mockPrisma,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn(),
}));

const authUser = makeAuthUser();
const mkApp = (auth = true) => createTestApp(settingsRoutes, auth ? { authUser } : {});

beforeEach(() => {
  jest.resetAllMocks();
});

describe('settings routes', () => {
  it('GET /settings returns (creating if missing) (200)', async () => {
    mockPrisma.userSettings.findUnique.mockResolvedValue(null);
    mockPrisma.userSettings.create.mockResolvedValue({ theme: 'auto' });
    const res = await request(mkApp()).get('/settings');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('PUT /settings updates settings (200)', async () => {
    mockPrisma.userSettings.upsert.mockResolvedValue({ theme: 'dark' });
    const res = await request(mkApp()).put('/settings').send({ theme: 'dark' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /settings returns 401 without auth', async () => {
    const res = await request(mkApp(false)).get('/settings');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('PUT /settings returns 400 for invalid email', async () => {
    const res = await request(mkApp()).put('/settings').send({ emailAddress: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('POST /settings/reset resets to defaults (200)', async () => {
    mockPrisma.userSettings.upsert.mockResolvedValue({ theme: 'auto' });
    const res = await request(mkApp()).post('/settings/reset');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
