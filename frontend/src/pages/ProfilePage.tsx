import { useState, useEffect, useCallback, memo } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App';
import { useToast } from '../components/Toast';
import { TrialCTA } from '../components/TrialCTA';
import { CryptoCheckoutModal } from '../components/CryptoCheckoutModal';
import { apiClient } from '../api/client';
import { useT } from '../i18n';

export function ProfilePage() {
  const { user, subscription: ctxSubscription, isWeb, refreshSubscription } = useApp();
  const [checkout, setCheckout] = useState<{ planId: string; planName: string; price: number } | null>(null);
  const { showToast } = useToast();
  const t = useT();
  const [referralLink, setReferralLink] = useState('');
  const [referralStats, setReferralStats] = useState({ referrals: 0, bonusScans: 0 });
  const [referralCode, setReferralCode] = useState('');
  const [applyingReferral, setApplyingReferral] = useState(false);
  const [paymentHistory, setPaymentHistory] = useState<any[]>([]);
  const [withdrawalHistory, setWithdrawalHistory] = useState<any[]>([]);
  const [balance, setBalance] = useState(0);
  const [subscription, setSubscription] = useState('free');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.id) {
      loadUserData();
    }
  }, [user?.id, ctxSubscription]);

  // Scroll to the subscription section when arriving from a paywall link
  useEffect(() => {
    if (window.location.hash === '#subscription') {
      const el = document.getElementById('subscription');
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const loadUserData = useCallback(async () => {
    try {
      setLoading(true);

      const results = await Promise.allSettled([
        apiClient.getBalance(),
        apiClient.getReferralLink(),
        apiClient.getReferralList(),
        apiClient.getPaymentHistory(),
        apiClient.getWithdrawalHistory(),
        apiClient.getProfile(),
      ]);

      const [balanceRes, referralLinkRes, referralStatsRes, paymentHistoryRes, withdrawalHistoryRes, profileRes] =
        results.map((r) => r.status === 'fulfilled' ? r.value : null);

      if (balanceRes && (balanceRes as any).ok) setBalance((balanceRes as any).balance);
      if (referralLinkRes && (referralLinkRes as any).ok) setReferralLink((referralLinkRes as any).link);
      if (referralStatsRes && (referralStatsRes as any).ok) setReferralStats({
        referrals: (referralStatsRes as any).referrals,
        bonusScans: (referralStatsRes as any).bonusScans,
      });
      if (paymentHistoryRes && (paymentHistoryRes as any).ok) setPaymentHistory((paymentHistoryRes as any).payments || []);
      if (withdrawalHistoryRes && (withdrawalHistoryRes as any).ok) setWithdrawalHistory((withdrawalHistoryRes as any).withdrawals || []);
      if (profileRes && (profileRes as any).ok) {
        const profile = (profileRes as any).user || profileRes;
        setSubscription(profile.subscription || 'free');
        if (profile.balance !== undefined) setBalance(profile.balance);
      }

      // Only show error if ALL requests failed
      const allFailed = results.every((r) => r.status === 'rejected');
      if (allFailed) {
      showToast(t('profile.loadError'), 'error');
      }
    } catch (error) {
      console.error('Failed to load user data:', error);
      showToast(t('profile.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const handleCreateOrder = useCallback(async (planId: string) => {
    try {
      const response: any = await apiClient.createOrder(planId);
      if (response.ok) {
        const invoiceUrl = response.botInvoiceUrl || response.miniAppInvoiceUrl || response.webAppInvoiceUrl;
        if (invoiceUrl) {
          window.open(invoiceUrl, '_blank');
        }
        showToast(t('profile.paymentCreated'), 'success');
      } else {
        showToast(t('profile.paymentError') + response.error, 'error');
      }
    } catch (error) {
      showToast(t('app.networkError', { error: (error as Error).message }), 'error');
    }
  }, [showToast]);

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
      const response: any = await apiClient.post('/referral/apply', { code: referralCode.trim() });
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
  }, [referralCode, showToast, loadUserData]);

  if (loading) {
    return (
      <div className="p-4">
        <div className="card text-center py-8 text-gray-500" role="status">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-white shrink-0"
            style={{ background: 'linear-gradient(135deg, #3390ec, #1f4fb0)' }}
          >
            {(user?.firstName || 'U').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="font-semibold truncate">{user?.firstName || t('header.user')}</div>
            <div className="text-sm text-muted truncate">{user?.username ? '@' + user.username : user?.id}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
            <div className="text-xs text-muted">{t('profile.balance')}</div>
            <div className="text-lg font-bold stat">{balance} <span className="text-sm font-medium">USDT</span></div>
          </div>
          <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
            <div className="text-xs text-muted">{t('profile.referrals')}</div>
            <div className="text-lg font-bold stat">{referralStats.referrals}</div>
          </div>
        </div>
      </div>

      <div className="card">
          <h2 className="text-base font-semibold mb-1 text-[var(--text)]">🎁 {t('profile.trialTitle')}</h2>
          <p className="text-sm text-muted mb-3">{t('profile.trialDesc')}</p>
        <TrialCTA />
      </div>

      <div className="card">
          <h2 className="text-base font-semibold mb-1 text-[var(--text)]">🎁 {t('profile.referralTitle')}</h2>
          <p className="text-sm text-muted mb-3">{t('profile.referralDesc')}</p>

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
          className="btn btn-secondary text-sm py-2"
        >
            🔗 {t('profile.copyLink')}
        </button>
        {referralLink && (
          <div className="mt-2 text-sm break-all" style={{ color: 'var(--brand)' }}>{referralLink}</div>
        )}
      </div>

      <div id="subscription" className="scroll-mt-4">
        <div className="mb-4">
          <div className="rounded-2xl p-5 text-white relative overflow-hidden"
                style={{ background: 'linear-gradient(135deg, var(--brand) 0%, var(--brand-hover) 100%)' }}>
            <div className="text-xs font-semibold uppercase tracking-wide opacity-80">{t('profile.yourPlan')}</div>
            <div className="text-2xl font-bold mt-1 capitalize">{planLabel(subscription)}</div>
            <p className="text-sm opacity-90 mt-2">
              {t('profile.planDesc')}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3">
        <PlanCard
          name="Basic"
          price={29}
          
          tagline={t('profile.planTaglineBasic')}
          features={['profile.feat5ex', 'profile.featEmail', 'profile.featWatchlist']}
          currentPlan={subscription}
          onSelect={(pid, pname, pprice) => (isWeb ? openCheckout(pid, pname, pprice) : handleCreateOrder(pid))}
        />
        <PlanCard
          name="Pro"
          price={99}
          
          tagline={t('profile.planTaglinePro')}
          featured
          features={['profile.feat12ex', 'profile.featAi', 'profile.featCsv', 'profile.featPriority']}
          currentPlan={subscription}
          onSelect={(pid, pname, pprice) => (isWeb ? openCheckout(pid, pname, pprice) : handleCreateOrder(pid))}
        />
        <PlanCard
          name="Pro Max"
          price={499}
          
          tagline={t('profile.planTaglineProMax')}
          features={['profile.feat20ex', 'profile.featAllPro', 'profile.featAnalytics', 'profile.featSupport', 'profile.featEarly']}
          currentPlan={subscription}
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
            {paymentHistory.map((payment) => (
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
      </div>

      <div className="card">
          <h2 className="text-base font-semibold mb-3">{t('profile.withdrawalHistory')}</h2>
          {withdrawalHistory.length === 0 ? (
            <div className="text-center py-6 text-muted">{t('profile.noWithdrawals')}</div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {withdrawalHistory.map((withdrawal) => (
              <div key={withdrawal.id} className="flex justify-between items-center py-3">
                <div>
                  <div className="font-medium stat">{withdrawal.amount} {withdrawal.currency}</div>
                  <div className="text-sm text-muted font-mono">
                    {withdrawal.address.substring(0, 8)}…{withdrawal.address.substring(withdrawal.address.length - 6)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-muted">{new Date(withdrawal.createdAt).toLocaleDateString()}</div>
                  <div className="text-xs font-semibold" style={{ color: 'var(--success)' }}>{withdrawal.status}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <Link to="/settings" className="btn btn-secondary text-sm py-2.5">{t('profile.settingsLink')}</Link>
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
    </div>
  );
}

function planLabel(plan: string): string {
  switch (plan) {
    case 'basic': return 'Basic';
    case 'pro': return 'Pro';
    case 'promax': return 'Pro Max';
    case 'ultimate': return 'Ultimate';
    default: return 'Free';
  }
}

const PlanCard = memo(function PlanCard({
  name,
  price,
  tagline,
  features,
  featured = false,
  currentPlan,
  onSelect,
}: {
  name: string;
  price: number;
  tagline?: string;
  features: string[];
  featured?: boolean;
  currentPlan: string;
  onSelect: (planId: string, name: string, price: number) => void;
}) {
  const t = useT();
  const planId = name.toLowerCase().replace(' ', '');
  const isCurrent = currentPlan === planId;

  return (
    <div
      className={`relative rounded-2xl p-5 transition-all duration-200 ${
        featured
          ? 'mt-4 border-2 border-[var(--brand)] shadow-[var(--shadow-lg)]'
          : 'border border-[var(--border)]'
      }`}
      style={{ background: 'var(--surface)', color: 'var(--text)' }}
    >
      {featured && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-bold text-white"
             style={{ background: 'var(--brand)' }}>
          ⭐ {t('profile.popular')}
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
            <span className="mt-0.5 text-[var(--success)] font-bold shrink-0" aria-hidden="true">✓</span>
              <span>{t(feature)}</span>
          </li>
        ))}
      </ul>

      {isCurrent ? (
        <button
          disabled
          className="btn text-sm py-2.5 w-full cursor-not-allowed"
          style={{ background: 'var(--surface-2)', color: 'var(--text)' }}
        >
          ✓ {t('profile.currentPlan')}
        </button>
      ) : (
        <button
          onClick={() => onSelect(planId, name, price)}
          className="btn text-sm py-2.5 w-full btn-primary"
        >
          {currentPlan === 'free' ? t('profile.connect') : t('profile.switch')}
        </button>
      )}
    </div>
  );
});

