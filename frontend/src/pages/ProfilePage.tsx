import { useState, useEffect, useCallback, memo } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App';
import { useTelegram } from '../hooks/useTelegram';
import { useToast } from '../components/Toast';
import { TrialCTA } from '../components/TrialCTA';
import { CryptoCheckoutModal } from '../components/CryptoCheckoutModal';
import { QrLoginModal } from '../components/QrLoginModal';
import { WithdrawModal } from '../components/WithdrawModal';
import { apiClient } from '../api/client';
import { useT } from '../i18n';
import { PLAN_PRICES } from '../utils/plans';
import { CardSkeleton } from '../components/Skeleton';
import {
  IconChartLine,
  IconCheck,
  IconGift,
  IconLink2,
  IconMessageCircle,
  IconSend,
  IconShare2,
  IconSettings,
  IconSmartphone,
  IconStar,
  IconArrowUpRight,
  Icon,
  type IconName,
} from '../components/icons';

const SITE_URL = typeof window !== 'undefined' ? window.location.origin : 'https://funding-finder-frontend.onrender.com';

interface UserStats {
  totalScans: number;
  totalAlerts: number;
  uniqueExchanges: number;
}

const ACHIEVEMENTS = [
  { id: 'first_scan', icon: 'ScanLine', key: 'profile.achFirstScan', condition: (s: UserStats) => s.totalScans >= 1 },
  { id: 'scanner', icon: 'Bot', key: 'profile.achScanner', condition: (s: UserStats) => s.totalScans >= 10 },
  { id: 'master_scanner', icon: 'Trophy', key: 'profile.achMasterScanner', condition: (s: UserStats) => s.totalScans >= 100 },
  { id: 'alert_setter', icon: 'Bell', key: 'profile.achAlertSetter', condition: (s: UserStats) => s.totalAlerts >= 1 },
  { id: 'referral', icon: 'Users', key: 'profile.achReferral', condition: (_s: UserStats, r: number) => r >= 1 },
  { id: 'pro_user', icon: 'Star', key: 'profile.achProUser', condition: (_s: UserStats, _r: number, sub: string) => sub === 'pro' || sub === 'proplus' },
  { id: 'diversified', icon: 'Globe', key: 'profile.achDiversified', condition: (s: UserStats) => s.uniqueExchanges >= 3 },
] as { id: string; icon: IconName; key: string; condition: (s: UserStats, r: number, sub: string) => boolean }[];

let cachedProfileData: any = null;

export function ProfilePage() {
  const { user, subscription: ctxSubscription, isWeb, refreshSubscription } = useApp();
  const { openLink } = useTelegram();
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [checkout, setCheckout] = useState<{ planId: string; planName: string; price: number } | null>(null);
  const [showQrLogin, setShowQrLogin] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const { showToast } = useToast();
  const t = useT();

  const [referralLink, setReferralLink] = useState(() => cachedProfileData?.referralLink || '');
  const [referralStats, setReferralStats] = useState(() => cachedProfileData?.referralStats || { referrals: 0, paidReferrals: 0, earnings: 0, bonusRate: 0.2 });
  const [referralCode, setReferralCode] = useState('');
  const [applyingReferral, setApplyingReferral] = useState(false);
  const [paymentHistory, setPaymentHistory] = useState<any[]>(() => cachedProfileData?.paymentHistory || []);
  const [showAllPayments, setShowAllPayments] = useState(false);
  const [selectedAchievement, setSelectedAchievement] = useState<string | null>(null);
  const [withdrawalHistory, setWithdrawalHistory] = useState<any[]>(() => cachedProfileData?.withdrawalHistory || []);
  const [balance, setBalance] = useState(() => cachedProfileData?.balance || 0);
  const [subscription, setSubscription] = useState(() => cachedProfileData?.subscription || ctxSubscription || 'free');
  const [subscriptionExpiresAt, setSubscriptionExpiresAt] = useState<string | null>(() => cachedProfileData?.subscriptionExpiresAt || null);
  const [loading, setLoading] = useState(() => !cachedProfileData);
  const [userStats, setUserStats] = useState<UserStats>(() => cachedProfileData?.userStats || { totalScans: 0, totalAlerts: 0, uniqueExchanges: 0 });

  const applyProfileData = useCallback((data: any) => {
    if (!data) return;
    const profileUser = data.user || data;
    const sub = data.subscription || profileUser.subscription || 'free';
    const subExp = data.subscriptionExpiresAt || profileUser.subscriptionExpiresAt || null;
    const bal = data.balance !== undefined ? data.balance : (profileUser.balance !== undefined ? profileUser.balance : 0);
    const link = data.referralLink || '';
    const refStats = data.referralStats || { referrals: 0, paidReferrals: 0, earnings: bal, bonusRate: 0.2 };
    const payments = data.paymentHistory || [];
    const withdrawals = data.withdrawalHistory || [];
    const stats = {
      totalScans: profileUser.totalScans || 0,
      totalAlerts: profileUser.totalAlerts || 0,
      uniqueExchanges: profileUser.uniqueExchanges || 0,
    };

    setSubscription(sub);
    setSubscriptionExpiresAt(subExp);
    setBalance(bal);
    if (link) setReferralLink(link);
    setReferralStats(refStats);
    setPaymentHistory(payments);
    setWithdrawalHistory(withdrawals);
    setUserStats(stats);

    cachedProfileData = {
      subscription: sub,
      subscriptionExpiresAt: subExp,
      balance: bal,
      referralLink: link,
      referralStats: refStats,
      paymentHistory: payments,
      withdrawalHistory: withdrawals,
      userStats: stats,
    };
  }, []);

  const loadUserData = useCallback(async (isInitial = false) => {
    try {
      if (isInitial && !cachedProfileData) {
        setLoading(true);
      }

      // Fast single request fetching unified profile bundle
      const profileRes: any = await apiClient.getProfile(true);
      if (profileRes?.ok) {
        applyProfileData(profileRes);
        setLoading(false);
        return;
      }

      // Fallback for legacy endpoints if needed
      const results = await Promise.allSettled([
        apiClient.getBalance(),
        apiClient.getReferralLink(),
        apiClient.getReferralList(),
        apiClient.getPaymentHistory(),
        apiClient.getWithdrawalHistory(),
      ]);

      const [balanceRes, referralLinkRes, referralStatsRes, paymentHistoryRes, withdrawalHistoryRes] =
        results.map((r) => r.status === 'fulfilled' ? r.value : null);

      if (balanceRes && (balanceRes as any).ok) setBalance((balanceRes as any).balance);
      if (referralLinkRes && (referralLinkRes as any).ok) setReferralLink((referralLinkRes as any).referralLink);
      if (referralStatsRes && (referralStatsRes as any).ok) {
        setReferralStats({
          referrals: (referralStatsRes as any).referrals ?? 0,
          paidReferrals: (referralStatsRes as any).paidReferrals ?? 0,
          earnings: (referralStatsRes as any).earnings ?? 0,
          bonusRate: 0.2,
        });
      }
      if (paymentHistoryRes && (paymentHistoryRes as any).ok) setPaymentHistory((paymentHistoryRes as any).payments || []);
      if (withdrawalHistoryRes && (withdrawalHistoryRes as any).ok) setWithdrawalHistory((withdrawalHistoryRes as any).withdrawals || []);
    } catch {
      if (!cachedProfileData) {
        showToast(t('profile.loadError'), 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [applyProfileData, showToast, t]);

  useEffect(() => {
    loadUserData(!cachedProfileData);
  }, [loadUserData]);

  const handleCreateOrder = useCallback(async (planId: string, planName: string, price: number) => {
    if (creatingOrder) return;
    setCreatingOrder(true);
    try {
      if (isWeb) {
        setCheckout({ planId, planName, price });
        setCreatingOrder(false);
        return;
      }

      const res: any = await apiClient.createOrder(planId);
      if (res?.ok && (res.botInvoiceUrl || res.miniAppInvoiceUrl)) {
        openLink(res.botInvoiceUrl || res.miniAppInvoiceUrl);
        showToast(t('profile.invoiceOpened'), 'success');
      } else {
        showToast(res?.error || t('profile.invoiceError'), 'error');
      }
    } catch {
      showToast(t('profile.networkError'), 'error');
    } finally {
      setCreatingOrder(false);
    }
  }, [creatingOrder, isWeb, openLink, showToast, t]);

  const handleApplyReferral = useCallback(async () => {
    if (!referralCode.trim()) {
      showToast(t('profile.enterRefCode'), 'error');
      return;
    }
    setApplyingReferral(true);
    try {
      const res: any = await apiClient.post('/referral/apply', { referralCode: referralCode.trim() });
      if (res.ok) {
        showToast(t('profile.refApplied'), 'success');
        setReferralCode('');
        loadUserData(false);
      } else {
        showToast(res.error || t('profile.refApplyError'), 'error');
      }
    } catch {
      showToast(t('profile.refNetworkError'), 'error');
    } finally {
      setApplyingReferral(false);
    }
  }, [referralCode, loadUserData, showToast, t]);

  const handleCopyLink = useCallback(() => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink);
    showToast(t('profile.linkCopied'), 'success');
  }, [referralLink, showToast, t]);

  const handleShare = useCallback(() => {
    if (!referralLink) return;
    const text = t('profile.shareText');
    const shareUrl = isWeb
      ? `${SITE_URL}?ref=${user?.referralCode || ''}`
      : referralLink;
    const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(text)}`;
    openLink(tgUrl);
  }, [referralLink, isWeb, user?.referralCode, openLink, t]);

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const isPro = subscription === 'pro' || subscription === 'proplus';
  const isProPlus = subscription === 'proplus';

  return (
    <div className="px-3 py-4 sm:px-4 sm:max-w-2xl mx-auto space-y-4">
      {/* Header Profile Card */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg text-white shadow-md"
              style={{ background: 'linear-gradient(135deg, var(--cobalt) 0%, #7047EB 100%)' }}
            >
              {(user?.firstName || user?.username || 'U')[0].toUpperCase()}
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight text-[var(--text)]">
                {user?.firstName || user?.username || 'User'}
              </h1>
              <p className="text-xs text-[var(--text-muted)]">
                {user?.username ? `@${user.username}` : `ID: ${user?.id || user?.telegramId || 'Guest'}`}
              </p>
            </div>
          </div>
          <Link
            to="/settings"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            style={{ background: 'var(--surface-2)' }}
            aria-label="Настройки"
          >
            <IconSettings size={18} />
          </Link>
        </div>
      </div>

      {/* Trial CTA Banner if free */}
      {!isPro && <TrialCTA />}

      {/* Subscription Status Card */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-[var(--text-muted)]">Текущий тариф</div>
            <div className="text-xl font-bold flex items-center gap-2 mt-0.5">
              <span className={isProPlus ? 'text-[var(--brand)]' : isPro ? 'text-[var(--cobalt-text)]' : 'text-[var(--text)]'}>
                {isProPlus ? 'Pro+' : isPro ? 'Pro' : 'Free'}
              </span>
              {isPro && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-[var(--green-soft)] text-[var(--green)]">
                  ACTIVE
                </span>
              )}
            </div>
          </div>
          {isPro && subscriptionExpiresAt && (
            <div className="text-right">
              <div className="text-[11px] text-[var(--text-muted)]">Действует до</div>
              <div className="text-xs font-semibold text-[var(--text)] mt-0.5">
                {new Date(subscriptionExpiresAt).toLocaleDateString()}
              </div>
            </div>
          )}
        </div>

        {/* Plan Upgrade Options */}
        {!isProPlus && (
          <div className="pt-2 border-t border-[var(--border)] grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {!isPro && (
              <button
                onClick={() => handleCreateOrder('pro', 'Pro', PLAN_PRICES.pro.monthly)}
                disabled={creatingOrder}
                className="btn btn-primary py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <IconStar size={14} />
                Перейти на Pro ({PLAN_PRICES.pro.monthly} USDT/мес)
              </button>
            )}
            <button
              onClick={() => handleCreateOrder('proplus', 'Pro+', PLAN_PRICES.proplus.monthly)}
              disabled={creatingOrder}
              className="btn btn-secondary py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 border-[var(--brand)] text-[var(--brand)] hover:bg-[var(--brand-soft)]"
            >
              <IconStar size={14} />
              {isPro ? 'Апгрейд до Pro+' : 'Тариф Pro+'} ({PLAN_PRICES.proplus.monthly} USDT/мес)
            </button>
          </div>
        )}
      </div>

      {/* Balance & Referral Earnings Card */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-[var(--text-muted)]">Баланс вознаграждений</div>
            <div className="text-2xl font-bold font-mono text-[var(--green)] mt-0.5">
              {balance.toFixed(2)} <span className="text-sm font-normal text-[var(--text-muted)]">USDT</span>
            </div>
          </div>
          <button
            onClick={() => setShowWithdraw(true)}
            className="btn btn-secondary py-2 px-3 text-xs font-semibold flex items-center gap-1.5"
            style={{ background: 'var(--surface-2)' }}
          >
            <IconArrowUpRight size={14} />
            Вывести
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[var(--border)] text-center">
          <div className="p-2 rounded-lg bg-[var(--surface-2)]">
            <div className="text-base font-bold font-mono text-[var(--text)]">{referralStats.referrals}</div>
            <div className="text-[10px] text-[var(--text-muted)] mt-0.5">Рефералов</div>
          </div>
          <div className="p-2 rounded-lg bg-[var(--surface-2)]">
            <div className="text-base font-bold font-mono text-[var(--cobalt-text)]">{referralStats.paidReferrals}</div>
            <div className="text-[10px] text-[var(--text-muted)] mt-0.5">Оплативших</div>
          </div>
          <div className="p-2 rounded-lg bg-[var(--surface-2)]">
            <div className="text-base font-bold font-mono text-[var(--green)]">{((referralStats.bonusRate || 0.2) * 100).toFixed(0)}%</div>
            <div className="text-[10px] text-[var(--text-muted)] mt-0.5">Бонусная ставка</div>
          </div>
        </div>

        {/* Referral Link Copy & Share */}
        {referralLink && (
          <div className="pt-2 space-y-2">
            <div className="text-xs font-medium text-[var(--text-muted)]">Ваша реферальная ссылка (20% с оплат)</div>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={referralLink}
                className="input-field flex-1 text-xs font-mono select-all"
              />
              <button
                onClick={handleCopyLink}
                className="btn btn-secondary px-3 text-xs shrink-0"
                title="Копировать ссылку"
              >
                <IconLink2 size={14} />
              </button>
              <button
                onClick={handleShare}
                className="btn btn-primary px-3 text-xs shrink-0 flex items-center gap-1"
                title="Поделиться в Telegram"
              >
                <IconShare2 size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Apply Referral Code Input */}
      {!user?.referredBy && (
        <div className="card space-y-2">
          <div className="text-xs font-medium text-[var(--text-muted)]">Есть реферальный промокод?</div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Введите код приглашения"
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value)}
              className="input-field flex-1 text-xs uppercase"
            />
            <button
              onClick={handleApplyReferral}
              disabled={applyingReferral || !referralCode.trim()}
              className="btn btn-primary px-4 text-xs font-semibold"
            >
              {applyingReferral ? 'Применение...' : 'Применить'}
            </button>
          </div>
        </div>
      )}

      {/* Withdrawal History Card */}
      {withdrawalHistory.length > 0 && (
        <div className="card space-y-2">
          <h2 className="text-sm font-semibold text-[var(--text)]">История выводов</h2>
          <div className="space-y-2">
            {withdrawalHistory.slice(0, 5).map((w: any) => (
              <div key={w.id} className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--surface-2)] text-xs">
                <div>
                  <div className="font-semibold text-[var(--text)]">
                    {w.amount} {w.currency} <span className="text-[10px] text-[var(--text-muted)] font-mono">({w.network || 'TRC20'})</span>
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] font-mono truncate max-w-[180px] sm:max-w-[260px]">
                    {w.address}
                  </div>
                </div>
                <div className="text-right">
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      w.status === 'completed'
                        ? 'bg-[var(--green-soft)] text-[var(--green)]'
                        : w.status === 'rejected'
                        ? 'bg-[var(--red-soft)] text-[var(--red)]'
                        : 'bg-[var(--amber-soft)] text-[var(--amber)]'
                    }`}
                  >
                    {w.status === 'completed' ? 'Выплачено' : w.status === 'rejected' ? 'Отклонено' : 'В обработке'}
                  </span>
                  <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                    {new Date(w.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payment History Card */}
      {paymentHistory.length > 0 && (
        <div className="card space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--text)]">История подписок</h2>
            {paymentHistory.length > 3 && (
              <button
                onClick={() => setShowAllPayments(!showAllPayments)}
                className="text-xs text-[var(--cobalt-text)] hover:underline"
              >
                {showAllPayments ? 'Свернуть' : `Все (${paymentHistory.length})`}
              </button>
            )}
          </div>
          <div className="space-y-2">
            {(showAllPayments ? paymentHistory : paymentHistory.slice(0, 3)).map((p: any) => (
              <div key={p.id || p.orderId} className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--surface-2)] text-xs">
                <div>
                  <div className="font-semibold text-[var(--text)]">{p.plan || 'Подписка'}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">{new Date(p.date || p.createdAt).toLocaleDateString()}</div>
                </div>
                <div className="font-mono font-semibold text-[var(--text)]">
                  {p.amount} {p.currency || 'USDT'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Withdraw Modal */}
      <WithdrawModal
        open={showWithdraw}
        balance={balance}
        onClose={() => setShowWithdraw(false)}
        onSuccess={() => loadUserData(false)}
      />

      {/* Web Crypto Checkout Modal */}
      {checkout && (
        <CryptoCheckoutModal
          open={Boolean(checkout)}
          planId={checkout.planId}
          planName={checkout.planName}
          price={checkout.price}
          onClose={() => setCheckout(null)}
          onSuccess={() => {
            setCheckout(null);
            refreshSubscription();
            loadUserData(false);
          }}
        />
      )}
    </div>
  );
}
