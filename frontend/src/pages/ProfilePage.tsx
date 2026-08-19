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
      if (referralLinkRes && (referralLinkRes as any).ok) setReferralLink((referralLinkRes as any).link);
      if (referralStatsRes && (referralStatsRes as any).ok) {
        setReferralStats({
          referrals: (referralStatsRes as any).referrals || 0,
          paidReferrals: (referralStatsRes as any).paidReferrals || 0,
          earnings: (referralStatsRes as any).earnings || 0,
          bonusRate: (referralStatsRes as any).bonusRate ?? 0.2,
        });
      }
      if (paymentHistoryRes && (paymentHistoryRes as any).ok) setPaymentHistory((paymentHistoryRes as any).payments || []);
      if (withdrawalHistoryRes && (withdrawalHistoryRes as any).ok) setWithdrawalHistory((withdrawalHistoryRes as any).withdrawals || []);
    } catch (error) {
      console.error('Failed to load user data:', error);
      if (!cachedProfileData) {
        showToast(t('profile.loadError'), 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [applyProfileData, showToast, t]);

  useEffect(() => {
    loadUserData(!cachedProfileData);
  }, [user?.id, ctxSubscription, loadUserData]);

  // Scroll to the subscription section when arriving from a paywall link
  useEffect(() => {
    if (window.location.hash === '#subscription') {
      const el = document.getElementById('subscription');
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Deep link from the marketing landing page: `/?plan=pro` (or `proplus`)
  // opens the checkout modal directly so a visitor who clicked "Открыть в PWA"
  // lands straight on payment. Only fires once the user is known.
  useEffect(() => {
    const plan = new URLSearchParams(window.location.search).get('plan');
    if (!plan || (plan !== 'pro' && plan !== 'proplus')) return;
    if (!user?.id) return;
    const price = PLAN_PRICES[plan as 'pro' | 'proplus']?.monthly ?? 0;
    const name = plan === 'pro' ? 'Pro' : 'Pro+';
    openCheckout(plan, name, price);
  }, [user?.id]);

  const handleCreateOrder = useCallback(async (planId: string) => {
    // Guard against double-tap: two concurrent orders = two invoices/charges.
    if (creatingOrder) return;
    setCreatingOrder(true);
    try {
      const response: any = await apiClient.createOrder(planId);
      if (response.ok) {
        if (response.alreadyEntitled) {
          await loadUserData();
          showToast(t('profile.planSwitchedNoPayment'), 'success');
          return;
        }
        const invoiceUrl = response.botInvoiceUrl || response.miniAppInvoiceUrl || response.webAppInvoiceUrl;
        if (invoiceUrl) {
          // window.open is blocked inside the Telegram webview; openLink falls
          // back to tg.openLink() inside Telegram and window.open elsewhere.
          openLink(invoiceUrl);
        }
        showToast(t('profile.paymentCreated'), 'success');
      } else {
        showToast(t('profile.paymentError') + response.error, 'error');
      }
    } catch (error) {
      showToast(t('app.networkError', { error: (error as Error).message }), 'error');
    } finally {
      setCreatingOrder(false);
    }
  }, [creatingOrder, openLink, showToast, t, loadUserData]);

  // Website: open the crypto checkout modal instead of the Telegram invoice.
  const openCheckout = useCallback((planId: string, planName: string, price: number) => {
    setCheckout({ planId, planName, price });
  }, []);

  const handleCheckoutPaid = useCallback(() => {
    setCheckout(null);
    refreshSubscription();
    loadUserData();
  }, [refreshSubscription, loadUserData]);

  const handleApplyReferral = useCallback(async () => {
    if (!referralCode.trim()) {
      showToast(t('profile.referralRequired'), 'error');
      return;
    }
    setApplyingReferral(true);
    try {
      const response: any = await apiClient.post('/referral/apply', { referralCode: referralCode.trim() });
      if (response.ok) {
        showToast(t('profile.referralApplied'), 'success');
        setReferralCode('');
        loadUserData();
      } else {
        showToast(response.error || t('profile.referralInvalid'), 'error');
      }
    } catch (error) {
      showToast(t('app.networkError', { error: (error as Error).message }), 'error');
    } finally {
      setApplyingReferral(false);
    }
  }, [referralCode, showToast, t, loadUserData]);

  if (loading) {
    return (
      <div className="px-3 py-4 sm:px-4 space-y-3">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="px-3 py-4 sm:px-4">
      <div className="card relative">
        <Link
          to="/settings"
          className="absolute top-4 right-4 w-9 h-9 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}
          aria-label={t('profile.settingsLink')}
          title={t('profile.settingsLink')}
        >
          <IconSettings size={18} />
        </Link>
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold shrink-0"
            style={{ background: 'var(--brand)', color: 'var(--on-brand)' }}
          >
            {(user?.firstName || 'U').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 pr-10">
            <div className="font-semibold truncate">{user?.firstName || t('header.user')}</div>
            <div className="text-sm text-muted truncate">{user?.username ? '@' + user.username : user?.id}</div>
            <div className="flex items-center gap-1 mt-2 overflow-x-auto pr-1">
              {ACHIEVEMENTS.map((ach) => {
                const unlocked = ach.condition(userStats, referralStats.referrals, subscription);
                return (
                  <button
                    key={ach.id}
                    onClick={() => setSelectedAchievement(selectedAchievement === ach.id ? null : ach.id)}
                    className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                    style={{ color: unlocked ? 'var(--amber)' : 'var(--text3)', background: unlocked ? 'var(--amber-soft)' : 'var(--surface-2)', opacity: unlocked ? 1 : 0.55 }}
                    title={t(ach.key)}
                    aria-label={t(ach.key)}
                  >
                    <Icon name={ach.icon} size={15} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        {selectedAchievement && (
          <div className="mb-3 rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--amber-soft)', color: 'var(--text)' }}>
            <strong>{t(ACHIEVEMENTS.find((ach) => ach.id === selectedAchievement)?.key || '')}</strong>
            <div className="text-muted mt-1">{t('profile.achievementHint')}</div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div className="rounded-xl p-3 flex flex-col justify-between" style={{ background: 'var(--surface-2)' }}>
            <div>
              <div className="text-xs text-muted">{t('profile.balance')}</div>
              <div className="text-lg font-bold stat">{balance.toFixed(2)} <span className="text-sm font-medium">USDT</span></div>
            </div>
            <button
              onClick={() => setShowWithdraw(true)}
              className="mt-2 text-xs py-1.5 px-2.5 rounded-lg font-semibold flex items-center justify-center gap-1 transition-all"
              style={{ background: 'var(--brand)', color: 'var(--on-brand)' }}
            >
              <IconArrowUpRight size={13} /> {t('profile.withdraw') || 'Вывести'}
            </button>
          </div>
          <div className="rounded-xl p-3 flex flex-col justify-between" style={{ background: 'var(--surface-2)' }}>
            <div>
              <div className="text-xs text-muted">{t('profile.referrals')}</div>
              <div className="text-lg font-bold stat">{referralStats.referrals}</div>
            </div>
            <div className="text-xs text-muted mt-2">
              +{Math.round((referralStats.bonusRate || 0.2) * 100)}% бонус
            </div>
          </div>
        </div>
      </div>

      {/* Usage Dashboard */}
      <div className="card">
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
          <IconChartLine size={18} style={{ color: 'var(--brand)' }} /> {t('profile.dashboard')}
        </h2>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-2)' }}>
            <div className="text-xs text-muted">{t('profile.scansCount')}</div>
            <div className="text-lg font-bold stat">{userStats.totalScans}</div>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-2)' }}>
            <div className="text-xs text-muted">{t('profile.alertsCount')}</div>
            <div className="text-lg font-bold stat">{userStats.totalAlerts}</div>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-2)' }}>
            <div className="text-xs text-muted">{t('profile.exchangesCount')}</div>
            <div className="text-lg font-bold stat">{userStats.uniqueExchanges}</div>
          </div>
        </div>
      </div>

      {!(subscription !== 'free' && subscriptionExpiresAt) && <div className="card">
          <h2 className="text-base font-semibold mb-1 text-[var(--text)] flex items-center gap-2">
            <IconGift size={18} style={{ color: 'var(--brand)' }} /> {t('profile.trialTitle')}
          </h2>
          <p className="text-sm text-muted mb-3">{t('profile.trialDesc')}</p>
        <TrialCTA />
      </div>}

      <div className="card">
          <h2 className="text-base font-semibold mb-1 text-[var(--text)] flex items-center gap-2">
            <IconGift size={18} style={{ color: 'var(--brand)' }} /> {t('profile.referralTitle')}
          </h2>
          <p className="text-sm text-muted mb-3">{t('profile.referralDesc', { rate: Math.round((referralStats.bonusRate || 0.2) * 100) })}</p>

        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-2)' }}>
            <div className="text-xs text-muted">{t('profile.referrals')}</div>
            <div className="text-lg font-bold stat">{referralStats.referrals}</div>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-2)' }}>
            <div className="text-xs text-muted">{t('profile.paidReferrals')}</div>
            <div className="text-lg font-bold stat">{referralStats.paidReferrals}</div>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
            <div className="text-xs">{t('profile.earnings')}</div>
            <div className="text-lg font-bold stat">{referralStats.earnings.toFixed(2)} <span className="text-sm font-medium">USDT</span></div>
          </div>
        </div>

        <div className="flex gap-2 mb-3">
          <input
            type="text"
              placeholder={t('profile.referralPlaceholder')}
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value)}
            className="input-field flex-1 text-sm"
          />
          <button
            onClick={handleApplyReferral}
            disabled={applyingReferral || !referralCode.trim()}
            className="btn btn-primary text-sm py-2 w-auto px-4"
          >
            {applyingReferral ? '...' : t('profile.apply')}
          </button>
        </div>

        <button
          onClick={() => {
            navigator.clipboard.writeText(referralLink);
            showToast(t('profile.linkCopied'), 'success');
          }}
          className="btn btn-secondary text-sm py-2 w-full flex items-center justify-center gap-2"
        >
          <IconLink2 size={16} /> {t('profile.copyLink')}
        </button>
        <div className="grid grid-cols-4 gap-2 mt-2">
          <button
            onClick={async () => {
              const { telegramShareUrl } = await import('../utils/shareLinks');
              const payload = { text: t('profile.shareText'), url: referralLink || SITE_URL, referralCode: user?.referralCode, utm: { source: 'miniapp', medium: 'share', campaign: 'referral_telegram' } };
              window.open(telegramShareUrl(payload), '_blank', 'noopener');
            }}
            className="btn btn-secondary py-2 flex items-center justify-center"
            title={t('profile.shareTelegram')}
            aria-label={t('profile.shareTelegram')}
          >
            <IconSend size={17} />
          </button>
          <button
            onClick={async () => {
              const { twitterShareUrl } = await import('../utils/shareLinks');
              const payload = { text: t('profile.shareText'), url: referralLink || SITE_URL, referralCode: user?.referralCode, utm: { source: 'miniapp', medium: 'share', campaign: 'referral_twitter' } };
              window.open(twitterShareUrl(payload), '_blank', 'noopener');
            }}
            className="btn btn-secondary py-2 flex items-center justify-center text-base font-bold"
            title={t('profile.shareX')}
            aria-label={t('profile.shareX')}
          >
            X
          </button>
          <button
            onClick={async () => {
              const { whatsappShareUrl } = await import('../utils/shareLinks');
              const payload = { text: t('profile.shareText'), url: referralLink || SITE_URL, referralCode: user?.referralCode, utm: { source: 'miniapp', medium: 'share', campaign: 'referral_whatsapp' } };
              window.open(whatsappShareUrl(payload), '_blank', 'noopener');
            }}
            className="btn btn-secondary py-2 flex items-center justify-center"
            title={t('profile.shareWhatsApp')}
            aria-label={t('profile.shareWhatsApp')}
          >
            <IconMessageCircle size={17} />
          </button>
          <button
            onClick={async () => {
              const { telegramShareUrl, copyShareText } = await import('../utils/shareLinks');
              const payload = { text: t('profile.shareText'), url: referralLink || SITE_URL, referralCode: user?.referralCode, utm: { source: 'miniapp', medium: 'share', campaign: 'referral' } };
              // Mobile: use native share sheet; Desktop: open Telegram share URL; Fallback: clipboard
              if (/Mobi|Android/i.test(navigator.userAgent)) {
                navigator.share({ title: 'Funding Finder', text: t('profile.shareText'), url: payload.url }).catch(() => {
                  window.open(telegramShareUrl(payload), '_blank', 'noopener');
                });
              } else {
                await copyShareText(payload);
                showToast(t('profile.linkCopied'), 'success');
              }
            }}
            className="btn btn-secondary py-2 flex items-center justify-center"
            title={t('profile.share')}
            aria-label={t('profile.share')}
          >
            <IconShare2 size={17} />
          </button>
        </div>
        {referralLink && (
          <div className="mt-2 text-sm break-all" style={{ color: 'var(--brand)' }}>{referralLink}</div>
        )}
        <p className="text-xs text-muted mt-3">{t('profile.referralEarnHint', { rate: Math.round((referralStats.bonusRate || 0.2) * 100) })}</p>
      </div>

      <div className="rounded-2xl p-4 mb-4" style={{ background: 'var(--surface)' }}>
        <div className="flex items-center gap-3">
          <IconSmartphone size={28} style={{ color: 'var(--brand)' }} />
          <div className="flex-1">
            <div className="font-semibold text-sm">{t('profile.qrLoginTitle')}</div>
            <div className="text-xs text-muted">{t('profile.qrLoginDesc')}</div>
          </div>
          <button
            onClick={() => setShowQrLogin(true)}
            className="btn btn-secondary text-xs py-1.5 px-3"
          >
            {t('profile.qrLoginBtn')}
          </button>
        </div>
      </div>

      <div id="subscription" className="scroll-mt-4">
        <div className="mb-4">
          <div className="rounded-2xl p-5 relative overflow-hidden"
                style={{ background: 'var(--brand)', color: 'var(--on-brand)' }}>
            <div className="text-xs font-semibold uppercase tracking-wide opacity-80">{t('profile.yourPlan')}</div>
            <div className="text-2xl font-bold mt-1 capitalize">{planLabel(subscription)}</div>
            <p className="text-sm opacity-90 mt-2">
              {t('profile.planDesc')}
            </p>
            {subscription !== 'free' && subscriptionExpiresAt && (
              <p className="text-sm opacity-90 mt-2">
                {t('profile.subscriptionUntil')}: {new Date(subscriptionExpiresAt).toLocaleDateString()}
              </p>
            )}
            {subscription === 'proplus' && (
              <a href="https://t.me/fundinganalyzerbot" target="_blank" rel="noopener noreferrer"
                 className="inline-flex items-center gap-1.5 mt-2 text-sm font-semibold underline opacity-95 hover:opacity-100">
                <IconSmartphone size={14} />
                @fundinganalyzerbot — {t('profile.prioritySupport') || 'приоритетная поддержка'}
              </a>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3">
        <PlanCard
          planId="pro"
          name="Pro"
          price={49}
          tagline={t('profile.planTaglinePro')}
          featured
          features={['profile.feat12ex', 'profile.featAi', 'profile.featCsv', 'profile.featPriority']}
          currentPlan={subscription}
          busy={creatingOrder}
          onSelect={(pid, pname, pprice) => (isWeb ? openCheckout(pid, pname, pprice) : handleCreateOrder(pid))}
        />
        <PlanCard
          planId="proplus"
          name="Pro+"
          price={149}
          tagline={t('profile.planTaglineProMax')}
          features={['profile.feat20ex', 'profile.featAllPro', 'profile.featAnalytics', 'profile.featSupport', 'profile.featEarly']}
          currentPlan={subscription}
          busy={creatingOrder}
          onSelect={(pid, pname, pprice) => (isWeb ? openCheckout(pid, pname, pprice) : handleCreateOrder(pid))}
        />
      </div>
      </div>

      <div className="card">
          <h2 className="text-base font-semibold mb-2">{t('profile.planHeader')}</h2>
        <p className="text-sm text-muted mb-2">
          {t('profile.freeDesc')}
        </p>
        <p className="text-xs text-muted">
          {t('profile.cryptoNote')}
        </p>
      </div>

      <div className="card">
          <h2 className="text-base font-semibold mb-3">{t('profile.paymentHistory')}</h2>
          {paymentHistory.length === 0 ? (
            <div className="text-center py-6 text-muted">{t('profile.noPayments')}</div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
             {paymentHistory.slice(0, showAllPayments ? paymentHistory.length : 3).map((payment) => (
              <div key={payment.id} className="flex justify-between items-center py-3">
                <div>
                  <div className="font-medium">{planLabel(payment.plan)}</div>
                  <div className="text-sm text-muted">{new Date(payment.date).toLocaleDateString()}</div>
                </div>
                <div className="text-right font-bold stat">{payment.amount} {payment.currency}</div>
              </div>
            ))}
           </div>
         )}
          {paymentHistory.length > 3 && (
            <button
              onClick={() => setShowAllPayments((value) => !value)}
              className="btn btn-secondary text-sm py-2 w-full mt-3"
            >
              {showAllPayments ? t('profile.showRecent') : t('profile.showAll')}
            </button>
          )}
      </div>

      <div className="card">
          <h2 className="text-base font-semibold mb-3">{t('profile.withdrawalHistory')}</h2>
          {withdrawalHistory.length === 0 ? (
            <div className="text-center py-6 text-muted">{t('profile.noWithdrawals')}</div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {withdrawalHistory.map((withdrawal) => {
              const isCompleted = withdrawal.status === 'completed';
              const isRejected = withdrawal.status === 'rejected';
              const statusColor = isCompleted ? 'var(--green)' : isRejected ? 'var(--red)' : 'var(--amber)';
              const statusBg = isCompleted ? 'var(--green-soft)' : isRejected ? 'var(--red-soft)' : 'var(--amber-soft)';
              const statusLabel = isCompleted ? 'Выполнен' : isRejected ? 'Отклонён' : 'В обработке';

              return (
                <div key={withdrawal.id} className="flex justify-between items-center py-3">
                  <div>
                    <div className="font-medium stat">{withdrawal.amount} {withdrawal.currency} ({withdrawal.network})</div>
                    <div className="text-xs text-muted font-mono mt-0.5">
                      {withdrawal.address.substring(0, 8)}…{withdrawal.address.substring(withdrawal.address.length - 6)}
                    </div>
                    {withdrawal.transactionId && (
                      <div className="text-[11px] text-muted font-mono mt-0.5 truncate max-w-[200px]" title={withdrawal.transactionId}>
                        Tx: {withdrawal.transactionId.substring(0, 10)}…
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted mb-1">{new Date(withdrawal.createdAt).toLocaleDateString()}</div>
                    <span
                      className="text-[11px] px-2 py-0.5 rounded font-semibold"
                      style={{ color: statusColor, background: statusBg }}
                    >
                      {statusLabel}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="text-center py-2">
        <Link to="/terms" className="text-sm hover:underline mx-2" style={{ color: 'var(--brand)' }}>{t('profile.termsLink')}</Link>
        <span className="text-muted">·</span>
        <Link to="/privacy" className="text-sm hover:underline mx-2" style={{ color: 'var(--brand)' }}>{t('profile.privacyLink')}</Link>
      </div>

      {checkout && (
        <CryptoCheckoutModal
          open={!!checkout}
          planId={checkout.planId}
          planName={checkout.planName}
          price={checkout.price}
          onClose={() => setCheckout(null)}
          onPaid={handleCheckoutPaid}
        />
      )}

      {showWithdraw && (
        <WithdrawModal
          open={showWithdraw}
          balance={balance}
          onClose={() => setShowWithdraw(false)}
          onSuccess={() => loadUserData()}
        />
      )}

      {showQrLogin && (
        <QrLoginModal onClose={() => setShowQrLogin(false)} />
      )}
    </div>
  );
}

function planLabel(plan: string): string {
  switch (plan.toLowerCase().replace(/\s/g, '')) {
    case 'pro': return 'Pro';
    case 'proplus':
    case 'pro+': return 'Pro+';
    default: return 'Free';
  }
}

const PlanCard = memo(function PlanCard({
  planId,
  name,
  price,
  tagline,
  features,
  featured = false,
  currentPlan,
  onSelect,
  busy = false,
}: {
  planId: string;
  name: string;
  price: number;
  tagline?: string;
  features: string[];
  featured?: boolean;
  currentPlan: string;
  onSelect: (planId: string, name: string, price: number) => void;
  busy?: boolean;
}) {
  const t = useT();
  const isCurrent = currentPlan === planId;

  return (
    <div
      className={`relative rounded-2xl p-5 transition-all duration-200 ${
        featured
          ? 'mt-4 border border-[var(--brand)]'
          : 'border border-[var(--border)]'
      }`}
      style={{ background: 'var(--surface)', color: 'var(--text)' }}
    >
      {featured && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1"
             style={{ background: 'var(--brand)', color: 'var(--on-brand)' }}>
          <IconStar size={12} fill="currentColor" /> {t('profile.popular')}
        </div>
      )}

      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-lg font-bold text-[var(--text)]">{name}</h3>
        {tagline && (
          <span className={`chip ${featured ? 'chip-brand' : ''}`}>{tagline}</span>
        )}
      </div>

        <div className="my-3 flex items-end gap-1">
          <span className="text-3xl font-extrabold stat text-[var(--text)]">{price} <span className="text-base font-medium">USDT</span></span>
          <span className="text-sm text-muted mb-1">/ {t('profile.period')}</span>
        </div>

      <ul className="space-y-2 mb-4">
        {features.map((feature, idx) => (
          <li key={idx} className="flex items-start gap-2 text-sm text-[var(--text)]">
            <IconCheck size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--green)' }} />
              <span>{t(feature)}</span>
          </li>
        ))}
      </ul>

      {isCurrent ? (
        <button
          disabled
          className="btn text-sm py-2.5 w-full cursor-not-allowed flex items-center justify-center gap-1.5"
          style={{ background: 'var(--surface-2)', color: 'var(--text)' }}
        >
          <IconCheck size={14} /> {t('profile.currentPlan')}
        </button>
      ) : (
        <button
          onClick={() => onSelect(planId, name, price)}
          disabled={busy}
          className="btn text-sm py-2.5 w-full btn-primary"
        >
          {busy ? t('profile.creating') : currentPlan === 'free' ? t('profile.connect') : t('profile.switch')}
        </button>
      )}
    </div>
  );
});

