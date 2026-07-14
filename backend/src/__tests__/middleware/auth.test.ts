import { prismaMock as mockPrisma } from '../testkit';
import { authenticate } from '../../middleware/auth.js';
import jwt from 'jsonwebtoken';
import { config } from '../../config/index.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';

var mockSubscription: any;
jest.mock('../../services/prisma', () => ({
  prisma: mockPrisma,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn(),
}));
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

const SECRET = config.jwt.secret;

function makeRes() {
  const res: any = {
    statusCode: 0,
    status(code: number) {
      this.statusCode = code;
      return res;
    },
    json() {
      return res;
    },
  };
  return res;
}

beforeEach(() => {
  jest.resetAllMocks();
  mockSubscription.enforceTrialExpiry.mockResolvedValue(false);
});

describe('auth middleware - authenticate', () => {
  it('accepts a valid Bearer JWT and sets req.userId', async () => {
    const token = jwt.sign({ sub: 'user-1', provider: 'wallet' }, SECRET, { expiresIn: '1h' });
    mockPrisma.user.upsert.mockResolvedValue({});

    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req as AuthenticatedRequest, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe('user-1');
  });

  it('rejects an invalid token with 401', async () => {
    const req: any = { headers: { authorization: 'Bearer not-a-real-token' } };
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req as AuthenticatedRequest, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('rejects a missing token with 401 (falls back to Telegram init data)', async () => {
    const req: any = { headers: {} };
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req as AuthenticatedRequest, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
