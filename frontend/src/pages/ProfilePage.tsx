import { useState, useEffect, useCallback, memo } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App';
import { useToast } from '../components/Toast';
import { apiClient } from '../api/client';

export function ProfilePage() {
  const { user } = useApp();
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
  }, [user?.id]);

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
  }, [referralCode, showToast]);

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
        <h2 className="text-lg font-semibold mb-2">Реферальная программа</h2>
        <p className="text-sm text-gray-600 mb-3">Приглашайте друзей — +1 пробный скан за каждого!</p>

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
          className="btn btn-primary text-sm py-2"
        >
          Получить ссылку
        </button>
        {referralLink && (
          <div className="mt-2 text-sm text-telegram-blue break-all">{referralLink}</div>
        )}
        <div className="mt-2 text-sm text-gray-500">
          Рефералов: {referralStats.referrals} | Бонусов: {referralStats.bonusScans}
        </div>
      </div>

      <div className="card">
        <h1 className="text-xl font-bold mb-2">Профиль</h1>
        <p className="text-sm">Имя: <strong>{user?.firstName || 'Загрузка...'}</strong></p>
        <p className="text-sm">ID: <strong>{user?.id || '—'}</strong></p>
        <p className="text-sm">Баланс: <strong>{balance} USDT</strong></p>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-3">Подписка</h2>
        <div className="text-sm text-gray-600 mb-3">Текущий план: <strong>{subscription}</strong></div>
        <div className="grid grid-cols-1 gap-3">
          <PlanCard
            name="Basic"
            price={29}
            features={['3 биржи', 'Базовые рекомендации']}
            currentPlan={subscription}
            onSelect={() => handleCreateOrder('basic')}
          />
          <PlanCard
            name="Pro"
            price={99}
            features={['Всё из Basic', 'AI-анализ', 'Экспорт']}
            featured
            currentPlan={subscription}
            onSelect={() => handleCreateOrder('pro')}
          />
          <PlanCard
            name="Pro Max"
            price={499}
            features={['Всё из Pro', 'Сигналы', 'Поддержка']}
            currentPlan={subscription}
            onSelect={() => handleCreateOrder('promax')}
          />
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-3">История платежей</h2>
        {paymentHistory.length === 0 ? (
          <div className="text-center py-4 text-gray-500">Платежей не найдено</div>
        ) : (
          <div className="space-y-2">
            {paymentHistory.map((payment) => (
              <div key={payment.id} className="flex justify-between items-center py-2 border-b border-gray-100">
                <div>
                  <div className="font-medium">{payment.plan}</div>
                  <div className="text-sm text-gray-500">{new Date(payment.date).toLocaleDateString()}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold">{payment.amount} {payment.currency}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-3">История выводов</h2>
        {withdrawalHistory.length === 0 ? (
          <div className="text-center py-4 text-gray-500">Выводов не найдено</div>
        ) : (
          <div className="space-y-2">
            {withdrawalHistory.map((withdrawal) => (
              <div key={withdrawal.id} className="flex justify-between items-center py-2 border-b border-gray-100">
                <div>
                  <div className="font-medium">{withdrawal.amount} {withdrawal.currency}</div>
                  <div className="text-sm text-gray-500">{withdrawal.address.substring(0, 8)}...{withdrawal.address.substring(withdrawal.address.length - 6)}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-500">{new Date(withdrawal.createdAt).toLocaleDateString()}</div>
                  <div className="text-xs text-green-500">{withdrawal.status}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <Link to="/settings" className="btn btn-secondary text-sm py-2 mb-2">⚙️ Настройки</Link>
      </div>

      <div className="card text-center">
        <Link to="/terms" className="text-sm text-telegram-blue hover:underline mx-2">Пользовательское соглашение</Link>
        <span className="text-gray-400">·</span>
        <Link to="/privacy" className="text-sm text-telegram-blue hover:underline mx-2">Политика конфиденциальности</Link>
      </div>
    </div>
  );
}

const PlanCard = memo(function PlanCard({
  name,
  price,
  features,
  featured = false,
  currentPlan,
  onSelect,
}: {
  name: string;
  price: number;
  features: string[];
  featured?: boolean;
  currentPlan: string;
  onSelect: () => void;
}) {
  const planId = name.toLowerCase().replace(' ', '');
  const isCurrent = currentPlan === planId || (currentPlan === 'pro' && planId === 'pro');
  
  return (
    <div className={`border rounded-xl p-4 ${featured ? 'border-telegram-blue bg-blue-50' : 'border-gray-200'}`}>
      {featured && <div className="text-xs text-telegram-blue font-bold mb-1">Хит</div>}
      <h3 className="font-bold">{name}</h3>
      <div className="text-2xl font-bold my-2">${price}/мес</div>
      <ul className="text-sm space-y-1 mb-3">
        {features.map((feature, idx) => (
          <li key={idx} className="flex items-center">
            <span className="text-green-500 mr-2" aria-hidden="true">✓</span>
            {feature}
          </li>
        ))}
      </ul>
      {isCurrent ? (
        <button disabled className="btn text-sm py-2 w-full bg-gray-200 text-gray-500 cursor-not-allowed">
          Текущий план
        </button>
      ) : (
        <button onClick={onSelect} className="btn btn-primary text-sm py-2 w-full">
          Выбрать
        </button>
      )}
    </div>
  );
});
