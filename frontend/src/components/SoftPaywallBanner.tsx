import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import { TrialCTA } from './TrialCTA';
import { TRIAL_DURATION_DAYS } from '../utils/plans';
import { useT } from '../i18n';

interface SoftPaywallBannerProps {
  used: number;
  total: number;
  featureLabel: string;
  onUpgrade?: () => void;
}

export function SoftPaywallBanner({ used, total, featureLabel, onUpgrade }: SoftPaywallBannerProps) {
  const t = useT();
  const navigate = useNavigate();
  const { subscription } = useApp();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || subscription !== 'free') return null;

  const pct = Math.round((used / total) * 100);

  const handleUpgrade = () => {
    if (onUpgrade) {
      onUpgrade();
    } else {
      navigate('/profile#subscription');
    }
  };

  return (
    <div
      className="rounded-xl p-4 mb-3 border"
      style={{
        background: 'linear-gradient(135deg, rgba(51,144,236,0.08), rgba(31,79,176,0.04))',
        borderColor: 'var(--brand-soft)',
      }}
    >
      <div className="flex items-start gap-3">
        <span className="text-xl mt-0.5" aria-hidden="true">🔒</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text)' }}>
            {t('softPaywall.title', { used, total, feature: featureLabel })}
          </p>
          <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
            {t('softPaywall.desc', { days: TRIAL_DURATION_DAYS })}
          </p>

          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(pct, 100)}%`,
                  background: pct >= 100 ? 'var(--red, #ef4444)' : 'var(--brand)',
                  transition: 'width 0.5s ease',
                }}
              />
            </div>
            <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
              {used}/{total}
            </span>
          </div>

          <div className="flex gap-2">
            <TrialCTA compact />
            <button onClick={handleUpgrade} className="btn btn-secondary text-sm py-1.5 px-3">
              {t('softPaywall.viewPlans')}
            </button>
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-sm px-1.5 py-0.5 rounded"
          style={{ color: 'var(--text-muted)' }}
          aria-label={t('common.close')}
        >
          ✕
        </button>
      </div>
    </div>
  );
}