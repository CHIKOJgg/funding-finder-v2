import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import { useToast } from './Toast';
import { TRIAL_DURATION_DAYS } from '../utils/plans';
import { useT } from '../i18n';
import { track } from '../utils/analytics';

interface TrialCTAProps {
  compact?: boolean;
  showTimer?: boolean;
  source?: string;
}

export function TrialCTA({ compact = false, showTimer = false, source }: TrialCTAProps) {
  const { trialStatus, activateTrial, refreshTrial, subscription } = useApp();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const t = useT();
  const [activating, setActivating] = useState(false);

  const active = trialStatus?.active ?? (subscription === 'pro' && trialStatus?.used);
  const usedUp = trialStatus?.used && !trialStatus?.active;
  const endsAt = trialStatus?.endsAt;

  const formatCountdown = (endsAt: string | null, daysLeft: number, hoursLeft: number): string => {
    if (!endsAt) return '';
    const totalHours = daysLeft * 24 + hoursLeft;
    if (totalHours > 24) {
      return t('trial.remainDaysHours', { days: daysLeft, hours: hoursLeft % 24 });
    }
    return t('trial.remainHours', { hours: hoursLeft });
  };

  const handleActivate = async () => {
    if (activating) return;
    setActivating(true);
    try {
      const ok = await activateTrial();
      if (ok) {
        await refreshTrial();
        showToast(t('trial.activated'), 'success');
        track('trial_start', { source: source || 'trial_cta' });
      }
    } finally {
      setActivating(false);
    }
  };

  const goToPlans = () => {
    const el = document.getElementById('subscription');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      navigate('/profile#subscription');
    }
  };

  if (active) {
    return (
      <div className="rounded-xl p-3 text-center" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
        <div className="text-sm font-semibold">{t('trial.activeTitle')}</div>
        {endsAt && (
          <div className="text-xs mt-1">
            {t('trial.remaining', { countdown: formatCountdown(endsAt, trialStatus.daysLeft, trialStatus.hoursLeft) })}
          </div>
        )}
        {showTimer && endsAt && (
          <div className="mt-2">
            <TrialCountdownTimer endsAt={endsAt} />
          </div>
        )}
      </div>
    );
  }

  if (usedUp) {
    return (
      <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-2)' }}>
        <div className="text-sm font-medium mb-2">{t('trial.endedTitle')}</div>
        <button onClick={goToPlans} className="btn btn-primary text-sm py-2 w-full">
          {t('trial.extend')}
        </button>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          {t('trial.endedNote')}
        </p>
      </div>
    );
  }

  if (compact) {
    return (
      <button onClick={handleActivate} disabled={activating} className="btn btn-primary text-sm py-1.5 w-full">
        {activating ? '...' : t('trial.compact', { days: TRIAL_DURATION_DAYS })}
      </button>
    );
  }

  return (
    <div className="rounded-2xl p-4 text-center text-white relative overflow-hidden"
         style={{ background: 'linear-gradient(135deg, #3390ec 0%, #2b6fd6 60%, #1f4fb0 100%)' }}>
      <div className="text-2xl mb-1" aria-hidden="true">🎁</div>
      <div className="font-bold text-lg">{t('trial.title')}</div>
      <p className="text-sm opacity-90 mt-1 mb-3">
        {t('trial.desc', { days: TRIAL_DURATION_DAYS })}
      </p>
      <button
        onClick={handleActivate}
        disabled={activating}
        className="btn w-full font-bold"
        style={{ background: '#fff', color: '#1f4fb0' }}
      >
        {activating ? t('trial.activating') : t('trial.activate', { days: TRIAL_DURATION_DAYS })}
      </button>
    </div>
  );
}

function TrialCountdownTimer({ endsAt }: { endsAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, new Date(endsAt).getTime() - now);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return <span className="font-mono">{h.toString().padStart(2, '0')}:{m.toString().padStart(2, '0')}:{s.toString().padStart(2, '0')}</span>;
}