import { Router } from 'express';
import { prisma } from '../services/prisma.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { sendError } from '../middleware/errorHandler.js';
import { enforceSubscriptionExpiry, getSubscriptionLimits } from '../middleware/subscription.js';
import { getPaymentHistory, getWithdrawalHistory } from '../services/paymentService.js';
import { config } from '../config/index.js';
import { SUPPORTED_EXCHANGES } from '../exchanges/index.js';

const router = Router();

router.get('/profile', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return sendError(res, 401, 'Authentication required', 'AUTH_REQUIRED');
    }

    await enforceSubscriptionExpiry(userId);
    const user = await prisma.user.findUnique({ where: { telegramId: userId } });
    if (!user) {
      return sendError(res, 404, 'User not found', 'USER_NOT_FOUND');
    }

    const limits = await getSubscriptionLimits(userId).catch(() => ({ maxExchanges: 4 }));
    const allowedExchanges = limits.maxExchanges || 4;

    // Parallelize all secondary lookups so total DB latency is minimal
    const [referralCount, referredUsers, paymentsRes, withdrawalsRes, arbAlertsCount, genAlertsCount] = await Promise.all([
      prisma.user.count({ where: { referredBy: user.id } }).catch(() => 0),
      prisma.user.findMany({ where: { referredBy: user.id }, select: { telegramId: true } }).catch(() => []),
      getPaymentHistory(userId, 10, 0).catch(() => ({ payments: [], total: 0 })),
      getWithdrawalHistory(userId, 10, 0).catch(() => ({ withdrawals: [], total: 0 })),
      prisma.arbitrageAlert.count({ where: { userId } }).catch(() => 0),
      prisma.generalAlert.count({ where: { userId } }).catch(() => 0),
    ]);

    const safeReferredUsers = Array.isArray(referredUsers) ? referredUsers : [];
    const referredIds = safeReferredUsers.map((r: any) => r?.telegramId).filter(Boolean);
    const paidReferrals = referredIds.length > 0
      ? await prisma.order.count({
          where: { userId: { in: referredIds }, status: 'paid', referralCredited: true },
        }).catch(() => 0)
      : 0;

    const botUser = config.telegram.botUsername || 'FundingFinderBot';
    const referralLink = `https://t.me/${botUser}?start=ref_${user.referralCode}`;
    const totalAlerts = (arbAlertsCount || 0) + (genAlertsCount || 0);

    return res.json({
      ok: true,
      user: {
        id: user.telegramId,
        firstName: user.firstName,
        username: user.username,
        email: user.email,
        subscription: user.subscription,
        subscriptionExpiresAt: user.subscriptionExpiresAt,
        balance: user.balance,
        referralCode: user.referralCode,
        trialScans: user.trialScans,
        trialUsed: user.trialUsed,
        trialEndsAt: user.trialEndsAt,
        totalScans: Math.max(user.trialScans || 0, 1),
        totalAlerts,
        uniqueExchanges: allowedExchanges,
        allowedExchanges,
        totalSupportedExchanges: SUPPORTED_EXCHANGES.length,
      },
      subscription: user.subscription,
      subscriptionExpiresAt: user.subscriptionExpiresAt,
      balance: user.balance,
      referralCode: user.referralCode,
      referralLink,
      referralStats: {
        referrals: referralCount || 0,
        paidReferrals,
        earnings: user.balance,
        bonusRate: 0.2,
      },
      paymentHistory: paymentsRes?.payments || [],
      withdrawalHistory: withdrawalsRes?.withdrawals || [],
      trialScans: user.trialScans,
      trialUsed: user.trialUsed,
      trialEndsAt: user.trialEndsAt,
      supportTelegram: user.subscription === 'proplus' ? '@fundinganalyzerbot' : undefined,
    });
  } catch (err) {
    logger.error({ err }, 'Profile fetch error');
    return sendError(res, 500, 'Failed to fetch profile', 'PROFILE_FETCH_ERROR');
  }
});

export default router;
