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

// GET /users — list all users with pagination
router.get('/users', async (req: AuthenticatedRequest, res: Response) => {
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

// GET /stats — system statistics
router.get('/stats', async (req: AuthenticatedRequest, res: Response) => {
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

// PATCH /users/:id/subscription — update user subscription
router.patch('/users/:id/subscription', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { subscription } = req.body;

    const validPlans = ['free', 'pro', 'proplus'];
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

// PATCH /users/:id/balance — update user balance
router.patch('/users/:id/balance', async (req: AuthenticatedRequest, res: Response) => {
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

// GET /metrics — business/funnel dashboard (CMO plan stage 6).
// Tracks the conversion funnel from signup → trial → paid, ARPPU, retention
// and referral performance so growth decisions aren't made blind.
router.get('/metrics', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const twoMonthsAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const [
      newUsersToday,
      newUsers7d,
      newUsers30d,
      trialUsers,
      trialUsedUsers,
      paidOrders,
      payingUsers,
      revenue,
      referredUsers,
      referredPaid,
      authBreakdown,
      cohort7,
      cohort30,
    ] = await Promise.all([
      prisma.user.count({ where: { createdAt: { gte: dayAgo } } }),
      prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.user.count({ where: { createdAt: { gte: monthAgo } } }),
      // Users currently on a paid plan (pro/proplus) — active paying base.
      prisma.user.count({ where: { subscription: { in: ['pro', 'proplus'] } } }),
      // Ever activated a trial.
      prisma.user.count({ where: { trialUsed: true } }),
      prisma.order.count({ where: { status: 'paid' } }),
      prisma.user.count({ where: { orders: { some: { status: 'paid' } } } }),
      prisma.order.aggregate({ where: { status: 'paid' }, _sum: { amount: true } }),
      // Users acquired via a referral.
      prisma.user.count({ where: { referredBy: { not: null } } }),
      prisma.user.count({ where: { referredBy: { not: null }, orders: { some: { status: 'paid' } } } }),
      prisma.user.groupBy({ by: ['authProvider'], _count: true }),
      // Retention: of users created 30–60d ago, how many were active in last 7d.
      prisma.user.count({ where: { createdAt: { gte: twoMonthsAgo, lt: monthAgo }, lastActive: { gte: weekAgo } } }),
      prisma.user.count({ where: { createdAt: { gte: twoMonthsAgo, lt: monthAgo }, lastActive: { gte: monthAgo } } }),
    ]);

    const cohortTotal = await prisma.user.count({ where: { createdAt: { gte: twoMonthsAgo, lt: monthAgo } } });
    const arppu = payingUsers > 0 ? (revenue._sum.amount || 0) / payingUsers : 0;
    const trialToPaid = trialUsedUsers > 0 ? (payingUsers / trialUsedUsers) * 100 : 0;
    const refConv = referredUsers > 0 ? (referredPaid / referredUsers) * 100 : 0;

    res.json({
      ok: true,
      metrics: {
        acquisition: {
          newUsersToday,
          newUsers7d,
          newUsers30d,
        },
        funnel: {
          paidBase: trialUsers,
          trialActivated: trialUsedUsers,
          paidOrders,
          payingUsers,
          trialToPaidPct: Number(trialToPaid.toFixed(1)),
          arppu: Number(arppu.toFixed(2)),
          totalRevenue: revenue._sum.amount || 0,
        },
        retention: {
          d7Pct: cohortTotal > 0 ? Number(((cohort7 / cohortTotal) * 100).toFixed(1)) : 0,
          d30Pct: cohortTotal > 0 ? Number(((cohort30 / cohortTotal) * 100).toFixed(1)) : 0,
        },
        referrals: {
          referredUsers,
          referredPaid,
          conversionPct: Number(refConv.toFixed(1)),
        },
        acquisitionBySource: authBreakdown.reduce((acc: Record<string, number>, curr) => {
          acc[curr.authProvider || 'unknown'] = curr._count;
          return acc;
        }, {} as Record<string, number>),
      },
    });
  } catch (err) {
    logger.error('Admin metrics error:', err);
    res.status(500).json({ ok: false, error: 'Failed to load metrics' });
  }
});

// GET /funnel — self-hosted event funnel + A/B breakdown (CMO growth loop).
// Reads the privacy-first FunnelEvent table (no PII) and returns stage counts,
// conversion between stages, a by-source split and an A/B variant comparison so
// landing-page headline tests can be judged on real downstream conversion.
const FUNNEL_STAGES = ['landing_view', 'app_open', 'scan_run', 'paywall_view', 'trial_start', 'paid'] as const;

router.get('/funnel', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [byEvent, bySource, byVariant, paidOrders] = await Promise.all([
      prisma.funnelEvent.groupBy({
        by: ['event'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      prisma.funnelEvent.groupBy({
        by: ['source'],
        where: { createdAt: { gte: since }, source: { not: null } },
        _count: { _all: true },
      }),
      // Per-variant landing→app conversion (the A/B metric that matters).
      prisma.funnelEvent.groupBy({
        by: ['variant', 'event'],
        where: { createdAt: { gte: since }, variant: { not: null } },
        _count: { _all: true },
      }),
      prisma.order.count({ where: { status: 'paid', createdAt: { gte: since } } }),
    ]);

    const counts: Record<string, number> = {};
    for (const row of byEvent) counts[row.event] = row._count._all;
    // 'paid' is also backed by real orders so it stays accurate even if a
    // client-side 'paid' ping is missed.
    counts.paid = Math.max(counts.paid || 0, paidOrders);

    const sourceBreakdown: Record<string, number> = {};
    for (const row of bySource) sourceBreakdown[row.source || 'unknown'] = row._count._all;

    // Build per-variant conversion: landing_view -> app_open -> trial_start.
    const variantAgg: Record<string, Record<string, number>> = {};
    for (const row of byVariant) {
      const v = row.variant || 'unknown';
      variantAgg[v] = variantAgg[v] || {};
      variantAgg[v][row.event] = row._count._all;
    }
    const variantComparison = Object.entries(variantAgg).map(([variant, ev]) => {
      const landing = ev.landing_view || 0;
      const appOpen = ev.app_open || 0;
      const trial = ev.trial_start || 0;
      return {
        variant,
        landingView: landing,
        appOpen,
        trialStart: trial,
        landingToAppPct: landing > 0 ? Number(((appOpen / landing) * 100).toFixed(1)) : 0,
        appToTrialPct: appOpen > 0 ? Number(((trial / appOpen) * 100).toFixed(1)) : 0,
      };
    });

    const step = (a: number, b: number) => (a > 0 ? Number(((b / a) * 100).toFixed(1)) : 0);
    const funnel = FUNNEL_STAGES.map((stage, i) => {
      const value = counts[stage] || 0;
      const prev = i > 0 ? counts[FUNNEL_STAGES[i - 1]] || 0 : 0;
      return {
        stage,
        value,
        conversionFromPrevPct: i > 0 ? step(prev, value) : 100,
      };
    });

    res.json({
      ok: true,
      windowDays: 30,
      funnel,
      sourceBreakdown,
      variantComparison,
      totalLandingViews: counts.landing_view || 0,
    });
  } catch (err) {
    logger.error('Admin funnel error:', err);
    res.status(500).json({ ok: false, error: 'Failed to load funnel' });
  }
});

// DELETE /users/:id — delete user and all associated data
router.delete('/users/:id', async (req: AuthenticatedRequest, res: Response) => {
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
