import { prismaMock as mockPrisma } from '../testkit';
import { requireSubscription, getPlanTier } from '../../middleware/subscription.js';

jest.mock('../../services/prisma', () => ({
  prisma: mockPrisma,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn(),
}));

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

describe('subscription middleware - requireSubscription', () => {
  it('allows a user on the required plan', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ subscription: 'pro' });
    const req: any = { userId: 'u1' };
    const res = makeRes();
    const next = jest.fn();

    await requireSubscription('pro')(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('blocks a user below the required plan with 403', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ subscription: 'free' });
    const req: any = { userId: 'u1' };
    const res = makeRes();
    const next = jest.fn();

    await requireSubscription('pro')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('rejects when no user is present (401)', async () => {
    const req: any = {};
    const res = makeRes();
    const next = jest.fn();

    await requireSubscription('pro')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('getPlanTier falls back to free for unknown tiers', () => {
    expect(getPlanTier('pro')).toBe('pro');
    expect(getPlanTier('nonsense')).toBe('free');
  });
});
