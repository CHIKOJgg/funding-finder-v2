import { useState, useEffect, useCallback, memo } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App';
import { useToast } from '../components/Toast';
import { TrialCTA } from '../components/TrialCTA';
import { CryptoCheckoutModal } from '../components/CryptoCheckoutModal';
import { apiClient } from '../api/client';

export function ProfilePage() {
  const { user, subscription: ctxSubscription, isWeb, refreshSubscription } = useApp();
  const [checkout, setCheckout] = useState<{ planId: string; planName: string; price: number } | null>(null);
  const { showToast } = useToast();
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
        showToast('Не удалось загрузить данные профиля', 'error');
      }
    } catch (error) {
      console.error('Failed to load user data:', error);
      showToast('Не удалось загрузить данные профиля', 'error');
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
        showToast('Платеж создан', 'success');
      } else {
        showToast('Ошибка при создании платежа: ' + response.error, 'error');
      }
    } catch (error) {
      showToast('Ошибка сети: ' + (error as Error).message, 'error');
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
      showToast('Введите реферальный код', 'error');
      return;
    }
    setApplyingReferral(true);
    try {
      const response: any = await apiClient.post('/referral/apply', { code: referralCode.trim() });
      if (response.ok) {
        showToast('Реферальный код применён!', 'success');
        setReferralCode('');
        loadUserData();
      } else {
        showToast(response.error || 'Недействительный код', 'error');
      }
    } catch (error) {
      showToast('Ошибка сети: ' + (error as Error).message, 'error');
    } finally {
      setApplyingReferral(false);
    }
  }, [referralCode, showToast, loadUserData]);

  if (loading) {
    return (
      <div className="p-4">
        <div className="card text-center py-8 text-gray-500" role="status">Загрузка...</div>
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
            <div className="font-semibold truncate">{user?.firstName || 'Пользователь'}</div>
            <div className="text-sm text-muted truncate">{user?.username ? '@' + user.username : user?.id}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
            <div className="text-xs text-muted">Баланс</div>
            <div className="text-lg font-bold stat">{balance} <span className="text-sm font-medium">USDT</span></div>
          </div>
          <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
            <div className="text-xs text-muted">Рефералов</div>
            <div className="text-lg font-bold stat">{referralStats.referrals}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="text-base font-semibold mb-1">🎁 Пробный Pro</h2>
        <p className="text-sm text-muted mb-3">Попробуйте все фичи Pro бесплатно — без привязки карты.</p>
        <TrialCTA />
      </div>

      <div className="card">
        <h2 className="text-base font-semibold mb-1">🎁 Реферальная программа</h2>
        <p className="text-sm text-muted mb-3">Приглашайте друзей — +1 пробный скан за каждого!</p>

        <div className="flex gap-2 mb-3">
          <input
            type="text"
            placeholder="Введите реферальный код..."
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value)}
            className="input-field flex-1 text-sm"
          />
          <button
            onClick={handleApplyReferral}
            disabled={applyingReferral || !referralCode.trim()}
            className="btn btn-primary text-sm py-2 w-auto px-4"
          >
            {applyingReferral ? '...' : 'Применить'}
          </button>
        </div>

        <button
          onClick={() => {
            navigator.clipboard.writeText(referralLink);
            showToast('Ссылка скопирована', 'success');
          }}
          className="btn btn-secondary text-sm py-2"
        >
          🔗 Получить ссылку
        </button>
        {referralLink && (
          <div className="mt-2 text-sm break-all" style={{ color: 'var(--brand)' }}>{referralLink}</div>
        )}
      </div>

      <div id="subscription" className="scroll-mt-4">
        <div className="mb-4">
          <div className="rounded-2xl p-5 text-white relative overflow-hidden"
                style={{ background: 'linear-gradient(135deg, var(--brand) 0%, var(--brand-hover) 100%)' }}>
            <div className="text-xs font-semibold uppercase tracking-wide opacity-80">Ваш тариф</div>
            <div className="text-2xl font-bold mt-1 capitalize">{planLabel(subscription)}</div>
            <p className="text-sm opacity-90 mt-2">
              Откройте все биржи, AI-анализ и арбитражные сигналы — зарабатывайте на разнице ставок фандинга.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3">
        <PlanCard
          name="Basic"
          price={29}
          period="мес"
          tagline="Для старта"
          features={['3 биржи', 'Рекомендации', 'Email-уведомления']}
          currentPlan={subscription}
          onSelect={(pid, pname, pprice) => (isWeb ? openCheckout(pid, pname, pprice) : handleCreateOrder(pid))}
        />
        <PlanCard
          name="Pro"
          price={99}
          period="мес"
          tagline="Самый популярный"
          featured
          features={['Все 5 бирж', 'AI-анализ рынка', 'Экспорт в CSV', 'Приоритетные сигналы']}
          currentPlan={subscription}
          onSelect={(pid, pname, pprice) => (isWeb ? openCheckout(pid, pname, pprice) : handleCreateOrder(pid))}
        />
        <PlanCard
          name="Pro Max"
          price={499}
          period="мес"
          tagline="Для профи"
          features={['Всё из Pro', 'Расширенная аналитика', 'Персональная поддержка', 'Ранний доступ к фичам']}
          currentPlan={subscription}
          onSelect={(pid, pname, pprice) => (isWeb ? openCheckout(pid, pname, pprice) : handleCreateOrder(pid))}
        />
      </div>
      </div>

      <div className="card">
        <h2 className="text-base font-semibold mb-3">История платежей</h2>
        {paymentHistory.length === 0 ? (
          <div className="text-center py-6 text-muted">Платежей пока нет</div>
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
        <h2 className="text-base font-semibold mb-3">История выводов</h2>
        {withdrawalHistory.length === 0 ? (
          <div className="text-center py-6 text-muted">Выводов пока нет</div>
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
        <Link to="/settings" className="btn btn-secondary text-sm py-2.5">⚙️ Настройки</Link>
      </div>

      <div className="text-center py-2">
        <Link to="/terms" className="text-sm hover:underline mx-2" style={{ color: 'var(--brand)' }}>Пользовательское соглашение</Link>
        <span className="text-muted">·</span>
        <Link to="/privacy" className="text-sm hover:underline mx-2" style={{ color: 'var(--brand)' }}>Политика конфиденциальности</Link>
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
  period = 'мес',
  tagline,
  features,
  featured = false,
  currentPlan,
  onSelect,
}: {
  name: string;
  price: number;
  period?: string;
  tagline?: string;
  features: string[];
  featured?: boolean;
  currentPlan: string;
  onSelect: (planId: string, name: string, price: number) => void;
}) {
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
          ⭐ Популярный
        </div>
      )}

      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-lg font-bold text-[var(--text)]">{name}</h3>
        {tagline && (
          <span className={`chip ${featured ? 'chip-brand' : ''}`}>{tagline}</span>
        )}
      </div>

      <div className="my-3 flex items-end gap-1">
        <span className="text-3xl font-extrabold stat text-[var(--text)]">${price}</span>
        <span className="text-sm text-muted mb-1">/ {period}</span>
      </div>

      <ul className="space-y-2 mb-4">
        {features.map((feature, idx) => (
          <li key={idx} className="flex items-start gap-2 text-sm text-[var(--text)]">
            <span className="mt-0.5 text-[var(--success)] font-bold shrink-0" aria-hidden="true">✓</span>
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      {isCurrent ? (
        <button
          disabled
          className="btn text-sm py-2.5 w-full cursor-not-allowed"
          style={{ background: 'var(--surface-2)', color: 'var(--text)' }}
        >
          ✓ Текущий план
        </button>
      ) : (
        <button
          onClick={() => onSelect(planId, name, price)}
          className="btn text-sm py-2.5 w-full btn-primary"
        >
          {currentPlan === 'free' ? 'Подключить' : 'Перейти'}
        </button>
      )}
    </div>
  );
});

