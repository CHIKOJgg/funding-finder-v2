import { useNavigate } from 'react-router-dom';
import { PaywallFeature } from '../utils/plans';
import { TrialCTA } from './TrialCTA';
import { useT } from '../i18n';

const FEATURE_INFO: Record<PaywallFeature, {
  icon: string;
  title: string;
  desc: string;
  plan: string;
}> = {
  exchanges: {
    icon: '🔁',
    title: 'paywall.exchangesTitle',
    desc: 'paywall.exchangesDesc',
    plan: 'Pro',
  },
  ai: {
    icon: '🧠',
    title: 'paywall.aiTitle',
    desc: 'paywall.aiDesc',
    plan: 'Pro',
  },
  recommendations: {
    icon: '🤖',
    title: 'paywall.recommendationsTitle',
    desc: 'paywall.recommendationsDesc',
    plan: 'Pro',
  },
  portfolio: {
    icon: '💼',
    title: 'paywall.portfolioTitle',
    desc: 'paywall.portfolioDesc',
    plan: 'Pro',
  },
  watchlist: {
    icon: '⭐',
    title: 'paywall.watchlistTitle',
    desc: 'paywall.watchlistDesc',
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
  const t = useT();
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
        <h2 id="paywall-title" className="text-xl font-bold text-center mb-1">{t(info.title)}</h2>
        <p className="text-sm text-center font-semibold mb-2" style={{ color: 'var(--brand)' }}>
          {t('paywall.planOnly', { plan: info.plan })}
        </p>
        <div className="w-12 h-1 rounded-full mx-auto mb-4" style={{ background: 'var(--brand-soft)' }} />
        <p className="text-sm text-center mb-5" style={{ color: 'var(--text-muted)' }}>
          {t(info.desc)}
        </p>

        <button onClick={handleUpgrade} className="btn btn-primary mb-2">
          {t('paywall.subscribe')}
        </button>
        <button onClick={onClose} className="btn btn-secondary">
          {t('paywall.notNow')}
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
