import { Router, Response } from 'express';
import { prisma } from '../services/prisma.js';
import { wsManager } from '../services/websocket.js';
import { getJobStats } from '../services/jobQueue.js';
import { getArchiveStats } from '../services/dataArchival.js';
import { cache } from '../utils/exchangeClient.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { logger } from '../utils/logger.js';

const router = Router();

// All admin routes require admin role
router.use(requireAdmin);

// GET /admin/users — list all users with pagination
router.get('/admin/users', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const search = (req.query.search as string) || '';

    const where = search
      ? {
          OR: [
            { telegramId: { contains: search, mode: 'insensitive' as const } },
            { username: { contains: search, mode: 'insensitive' as const } },
            { firstName: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          telegramId: true,
          username: true,
          firstName: true,
          role: true,
          subscription: true,
          balance: true,
          trialScans: true,
          lastActive: true,
          createdAt: true,
          _count: {
            select: {
              orders: true,
              generalAlerts: true,
              arbitrageAlerts: true,
              referrals: true,
            },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      ok: true,
      users,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error('Admin list users error:', err);
    res.status(500).json({ ok: false, error: 'Failed to list users' });
  }
});

// GET /admin/stats — system statistics
router.get('/admin/stats', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      usersToday,
      activeWeek,
      activeMonth,
      subscriptionBreakdown,
      totalOrders,
      ordersToday,
      revenue,
      revenueToday,
      totalAlerts,
      totalScans,
      archiveStats,
      jobStats,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.user.count({ where: { lastActive: { gte: weekAgo } } }),
      prisma.user.count({ where: { lastActive: { gte: monthAgo } } }),
      prisma.user.groupBy({ by: ['subscription'], _count: true }),
      prisma.order.count(),
      prisma.order.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.order.aggregate({ _sum: { amount: true } }),
      prisma.order.aggregate({ where: { createdAt: { gte: todayStart } }, _sum: { amount: true } }),
      prisma.generalAlert.count(),
      prisma.fundingRecord.count(),
      getArchiveStats().catch(() => null),
      getJobStats().catch(() => null),
    ]);

    const mem = process.memoryUsage();
    const wsStats = wsManager.getStats();

    res.json({
      ok: true,
      stats: {
        users: {
          total: totalUsers,
          today: usersToday,
          activeWeek: activeWeek,
          activeMonth: activeMonth,
          bySubscription: subscriptionBreakdown.reduce((acc: Record<string, number>, curr) => {
            acc[curr.subscription] = curr._count;
            return acc;
          }, {} as Record<string, number>),
        },
        orders: {
          total: totalOrders,
          today: ordersToday,
          revenue: revenue._sum.amount || 0,
          revenueToday: revenueToday._sum?.amount || 0,
        },
        system: {
          uptime: process.uptime(),
          memory: {
            heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
            rss: Math.round(mem.rss / 1024 / 1024),
          },
          websocket: wsStats,
          jobs: jobStats,
          archive: archiveStats,
          cacheSize: cache.size,
        },
        alerts: { total: totalAlerts },
        scans: { totalRecords: totalScans },
      },
    });
  } catch (err) {
    logger.error('Admin stats error:', err);
    res.status(500).json({ ok: false, error: 'Failed to load stats' });
  }
});

// PATCH /admin/users/:id/subscription — update user subscription
router.patch('/admin/users/:id/subscription', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { subscription } = req.body;

    const validPlans = ['free', 'basic', 'pro', 'promax'];
    if (!validPlans.includes(subscription)) {
      return res.status(400).json({ ok: false, error: `Invalid plan. Valid: ${validPlans.join(', ')}` });
    }

    const user = await prisma.user.update({
      where: { telegramId: id },
      data: { subscription },
      select: { telegramId: true, subscription: true, username: true, firstName: true },
    });

    logger.info({ adminId: req.userId, targetId: id, newPlan: subscription }, 'Admin updated user subscription');
    res.json({ ok: true, user });
  } catch (err) {
    logger.error('Admin update subscription error:', err);
    res.status(500).json({ ok: false, error: 'Failed to update subscription' });
  }
});

// PATCH /admin/users/:id/balance — update user balance
router.patch('/admin/users/:id/balance', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { balance } = req.body;

    if (typeof balance !== 'number' || balance < 0) {
      return res.status(400).json({ ok: false, error: 'Balance must be a non-negative number' });
    }

    const user = await prisma.user.update({
      where: { telegramId: id },
      data: { balance },
      select: { telegramId: true, balance: true, username: true },
    });

    logger.info({ adminId: req.userId, targetId: id, newBalance: balance }, 'Admin updated user balance');
    res.json({ ok: true, user });
  } catch (err) {
    logger.error('Admin update balance error:', err);
    res.status(500).json({ ok: false, error: 'Failed to update balance' });
  }
});

// DELETE /admin/users/:id — delete user and all associated data
router.delete('/admin/users/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({ where: { telegramId: id } });
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    await prisma.$transaction([
      prisma.generalAlert.deleteMany({ where: { userId: id } }),
      prisma.arbitrageAlert.deleteMany({ where: { userId: id } }),
      prisma.order.deleteMany({ where: { userId: id } }),
      prisma.withdrawal.deleteMany({ where: { userId: id } }),
      prisma.paymentHistory.deleteMany({ where: { userId: id } }),
      prisma.userSettings.deleteMany({ where: { userId: id } }),
      prisma.user.delete({ where: { telegramId: id } }),
    ]);

    logger.info({ adminId: req.userId, targetId: id }, 'Admin deleted user');
    res.json({ ok: true, message: 'User deleted' });
  } catch (err) {
    logger.error('Admin delete user error:', err);
    res.status(500).json({ ok: false, error: 'Failed to delete user' });
  }
});

export default router;
