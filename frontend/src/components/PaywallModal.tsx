import { useNavigate } from 'react-router-dom';
import { PaywallFeature } from '../utils/plans';
import { TrialCTA } from './TrialCTA';

const FEATURE_INFO: Record<PaywallFeature, {
  icon: string;
  title: string;
  desc: string;
  plan: string;
}> = {
  exchanges: {
    icon: '🔁',
    title: 'Больше бирж',
    desc: 'Ваш тариф позволяет сканировать ограниченное число бирж. Подключите Pro, чтобы сравнивать все биржи сразу (до 12 на Pro) и находить самые выгодные ставки фандинга.',
    plan: 'Pro',
  },
  ai: {
    icon: '🧠',
    title: 'AI Анализ',
    desc: 'AI разбор ставок фандинга от нейросети доступен на тарифе Pro. Узнавайте, какие пары стоит держать, а какие — закрывать.',
    plan: 'Pro',
  },
  recommendations: {
    icon: '🤖',
    title: 'Рекомендации',
    desc: 'Персональные рекомендации по вашему капиталу доступны на тарифе Pro. Точный расчёт позиций под ваш бюджет.',
    plan: 'Pro',
  },
  portfolio: {
    icon: '💼',
    title: 'Симулятор портфеля',
    desc: 'Симулятор дохода от фандинга (Paper PnL) с расчётом годовой доходности доступен на тарифе Pro. Оценивайте позиции без риска.',
    plan: 'Pro',
  },
  watchlist: {
    icon: '⭐',
    title: 'Безлимитное избранное',
    desc: 'На бесплатном тарифе можно сохранить до 3 пар. Подключите Pro, чтобы добавлять в избранное любое число пар.',
    plan: 'Pro',
  },
};

export function PaywallModal({
  open,
  feature,
  onClose,
}: {
  open: boolean;
  feature: PaywallFeature;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  if (!open) return null;

  const info = FEATURE_INFO[feature];

  const handleUpgrade = () => {
    onClose();
    navigate('/profile#subscription');
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paywall-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl sm:rounded-2xl p-6 animate-slide-in"
        style={{ background: 'var(--surface)', color: 'var(--text)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-4xl text-center mb-3" aria-hidden="true">{info.icon}</div>
        <h2 id="paywall-title" className="text-xl font-bold text-center mb-1">{info.title}</h2>
        <p className="text-sm text-center font-semibold mb-2" style={{ color: 'var(--brand)' }}>
          Только для подписчиков {info.plan}
        </p>
        <div className="w-12 h-1 rounded-full mx-auto mb-4" style={{ background: 'var(--brand-soft)' }} />
        <p className="text-sm text-center mb-5" style={{ color: 'var(--text-muted)' }}>
          {info.desc}
        </p>

        <button onClick={handleUpgrade} className="btn btn-primary mb-2">
          🚀 Оформить подписку
        </button>
        <button onClick={onClose} className="btn btn-secondary">
          Не сейчас
        </button>
        {feature === 'portfolio' || feature === 'watchlist' ? (
          <div className="mt-3">
            <TrialCTA compact />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { FEATURE_INFO };
