import { prismaMock as mockPrisma } from '../testkit';
import { requireAdmin } from '../../middleware/admin.js';

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

describe('admin middleware - requireAdmin', () => {
  it('allows an admin user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    const req: any = { userId: 'admin-1' };
    const res = makeRes();
    const next = jest.fn();

    await requireAdmin(req as any, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('rejects a non-admin user with 403', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: 'user' });
    const req: any = { userId: 'user-1' };
    const res = makeRes();
    const next = jest.fn();

    await requireAdmin(req as any, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('rejects when no user is present (401)', async () => {
    const req: any = {};
    const res = makeRes();
    const next = jest.fn();

    await requireAdmin(req as any, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
