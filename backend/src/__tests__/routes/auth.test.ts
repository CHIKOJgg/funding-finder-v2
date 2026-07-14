import request from 'supertest';
import { prismaMock as mockPrisma, createTestApp, makeAuthUser } from '../testkit';
import authRoutes from '../../routes/auth.js';

jest.mock('../../services/prisma', () => ({
  prisma: mockPrisma,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn(),
}));
jest.mock('../../services/authService', () => ({
  issueSiweNonce: jest.fn(),
  verifySiweSignature: jest.fn(),
  verifyGoogleIdToken: jest.fn(),
  signAuthToken: jest.fn(),
  verifyAuthToken: jest.fn(),
}));

var mockAuth: any;
jest.mock('../../middleware/auth', () => {
  mockAuth = {
    authenticate: jest.fn((req: any, _res: any, next: any) => {
      req.user = { id: 'me' };
      req.userId = 'me';
      next();
    }),
    optionalAuth: jest.fn((_req: any, _res: any, next: any) => next()),
    validateExchangeList: jest.fn((_req: any, _res: any, next: any) => next()),
  };
  return mockAuth;
});

import * as authService from '../../services/authService';

const VALID_ADDRESS = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';

beforeEach(() => {
  jest.resetAllMocks();
  mockAuth.authenticate.mockImplementation((req: any, _res: any, next: any) => {
    req.user = { id: 'me' };
    req.userId = 'me';
    next();
  });
  mockAuth.optionalAuth.mockImplementation((_req: any, _res: any, next: any) => next());
  mockAuth.validateExchangeList.mockImplementation((_req: any, _res: any, next: any) => next());
});

describe('auth routes', () => {
  it('GET /config returns public config (200)', async () => {
    const res = await request(createTestApp(authRoutes)).get('/config');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /wallet/nonce returns a nonce for a valid address (200)', async () => {
    (authService.issueSiweNonce as jest.Mock).mockResolvedValue('nonce-123');
    const res = await request(createTestApp(authRoutes)).get(`/wallet/nonce?address=${VALID_ADDRESS}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.nonce).toBe('nonce-123');
  });

  it('POST /wallet/verify returns a token on success (200)', async () => {
    (authService.verifySiweSignature as jest.Mock).mockResolvedValue({ ok: true, address: VALID_ADDRESS });
    mockPrisma.user.upsert.mockResolvedValue({ telegramId: `wallet_${VALID_ADDRESS}`, authProvider: 'wallet' });
    (authService.signAuthToken as jest.Mock).mockReturnValue('jwt-token');
    const res = await request(createTestApp(authRoutes))
      .post('/wallet/verify')
      .send({ message: 'msg', signature: 'sig' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.token).toBe('jwt-token');
  });

  it('POST /wallet/verify returns 401 on invalid signature', async () => {
    (authService.verifySiweSignature as jest.Mock).mockResolvedValue({ ok: false, reason: 'bad' });
    const res = await request(createTestApp(authRoutes))
      .post('/wallet/verify')
      .send({ message: 'msg', signature: 'sig' });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('GET /me returns the user (200)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      telegramId: 'me',
      subscription: 'pro',
      walletAddress: VALID_ADDRESS,
    });
    const res = await request(createTestApp(authRoutes)).get('/me');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /me returns 404 when user missing', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const res = await request(createTestApp(authRoutes)).get('/me');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('POST /dev-guest issues a session (200)', async () => {
    mockPrisma.user.upsert.mockResolvedValue({ telegramId: 'web_dev_x', authProvider: 'email' });
    (authService.signAuthToken as jest.Mock).mockReturnValue('jwt-token');
    const res = await request(createTestApp(authRoutes)).post('/dev-guest');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.token).toBe('jwt-token');
  });
});
