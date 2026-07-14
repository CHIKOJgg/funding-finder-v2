import request from 'supertest';
import { prismaMock as mockPrisma, createTestApp, makeAuthUser } from '../testkit';
import profileRoutes from '../../routes/profile.js';

jest.mock('../../services/prisma', () => ({
  prisma: mockPrisma,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn(),
}));

const authUser = makeAuthUser();
const mkApp = (auth = true) => createTestApp(profileRoutes, auth ? { authUser } : {});

beforeEach(() => {
  jest.resetAllMocks();
});

describe('profile routes', () => {
  it('GET /profile returns the profile (200)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      subscription: 'pro',
      balance: 0,
      referralCode: 'RC',
      trialScans: 0,
      trialUsed: false,
      trialEndsAt: null,
    });
    const res = await request(mkApp()).get('/profile');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.subscription).toBe('pro');
  });

  it('GET /profile returns 401 without auth', async () => {
    const res = await request(mkApp(false)).get('/profile');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('GET /profile returns 404 when user missing', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const res = await request(mkApp()).get('/profile');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});
