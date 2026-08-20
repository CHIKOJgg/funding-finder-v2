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
      const el = document.getElementById('subscription');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        navigate('/profile#subscription');
      }
    }
  };

  return (
    <div
      className="rounded-2xl p-4 sm:p-5 mb-4 border relative overflow-hidden transition-all shadow-sm"
      style={{
        background: 'var(--surface)',
        borderColor: 'var(--border)',
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
          style={{ background: 'var(--cobalt-soft)', color: 'var(--brand)' }}
        >
          <IconLock size={18} />
        </div>
        <div className="flex-1 min-w-0 pr-6">
          <p className="text-sm font-bold leading-snug mb-1" style={{ color: 'var(--text)' }}>
            {t('softPaywall.title', { used, total, feature: featureLabel })}
          </p>
          <p className="text-xs leading-relaxed mb-3" style={{ color: 'var(--text-muted)' }}>
            {t('softPaywall.desc', { days: TRIAL_DURATION_DAYS })}
          </p>

          <div className="flex items-center gap-2.5 mb-3.5">
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(pct, 100)}%`,
                  background: pct >= 100 ? 'var(--red)' : 'var(--brand)',
                  transition: 'width 0.5s ease',
                }}
              />
            </div>
            <span className="text-xs font-mono font-semibold shrink-0" style={{ color: 'var(--text-muted)' }}>
              {used} / {total}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="w-full">
              <TrialCTA compact />
            </div>
            <button
              onClick={handleUpgrade}
              className="btn btn-secondary text-sm py-1.5 px-3 w-full font-semibold"
            >
              {t('softPaywall.viewPlans')}
            </button>
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="absolute top-3 right-3 flex items-center justify-center w-7 h-7 rounded-lg hover:bg-[var(--surface-2)] transition-colors shrink-0"
          style={{ color: 'var(--text-muted)' }}
          aria-label={t('common.close')}
        >
          <IconX size={14} />
        </button>
      </div>
    </div>
  );
}