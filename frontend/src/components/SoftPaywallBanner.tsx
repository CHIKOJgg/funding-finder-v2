import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import { TrialCTA } from './TrialCTA';
import { TRIAL_DURATION_DAYS } from '../utils/plans';
import { useT } from '../i18n';
import { IconLock, IconX } from './icons';

interface SoftPaywallBannerProps {
  used: number;
  total: number;
  featureLabel: string;
  onUpgrade?: () => void;
}

const DISMISS_KEY = 'soft_paywall_dismissed';

export function SoftPaywallBanner({ used, total, featureLabel, onUpgrade }: SoftPaywallBannerProps) {
  const t = useT();
  const navigate = useNavigate();
  const { subscription } = useApp();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (dismissed) {
      try { localStorage.setItem(DISMISS_KEY, 'true'); } catch { /* ignore */ }
    }
  }, [dismissed]);

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
        background: 'var(--cobalt-soft)',
        borderColor: 'var(--border)',
      }}
    >
      <div className="flex items-start gap-3">
        <IconLock size={20} className="shrink-0 mt-0.5" style={{ color: 'var(--brand)' }} />
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
                  background: pct >= 100 ? 'var(--red)' : 'var(--brand)',
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
          className="flex items-center justify-center w-8 h-8 rounded shrink-0"
          style={{ color: 'var(--text-muted)' }}
          aria-label={t('common.close')}
        >
          <IconX size={14} />
        </button>
      </div>
    </div>
  );
}