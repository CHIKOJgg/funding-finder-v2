import { useState, useEffect, useMemo } from 'react';
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

  const urgency = useMemo(() => {
    if (!active || !endsAt) return null;
    const diff = new Date(endsAt).getTime() - Date.now();
    const hoursLeft = diff / 3600000;
    if (hoursLeft <= 1) return 'critical';
    if (hoursLeft <= 24) return 'warning';
    return null;
  }, [active, endsAt]);

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
    const urgencyBg = urgency === 'critical'
      ? 'linear-gradient(135deg, rgba(239,68,68,0.12), rgba(239,68,68,0.04))'
      : urgency === 'warning'
        ? 'linear-gradient(135deg, rgba(234,179,8,0.12), rgba(234,179,8,0.04))'
        : 'var(--brand-soft)';
    const urgencyBorder = urgency === 'critical'
      ? '1px solid rgba(239,68,68,0.3)'
      : urgency === 'warning'
        ? '1px solid rgba(234,179,8,0.3)'
        : 'none';
    const urgencyColor = urgency === 'critical' ? '#dc2626' : urgency === 'warning' ? '#b45309' : 'var(--brand)';

    return (
      <div
        className="rounded-xl p-3 text-center"
        style={{ background: urgencyBg, border: urgencyBorder, color: urgencyColor }}
      >
        <div className="text-sm font-semibold">
          {urgency === 'critical' && '⚠️ '}
          {urgency === 'warning' && '⏰ '}
          {t('trial.activeTitle')}
        </div>
        {endsAt && (
          <div className="text-xs mt-1">
            {t('trial.remaining', { countdown: formatCountdown(endsAt, trialStatus.daysLeft, trialStatus.hoursLeft) })}
          </div>
        )}
        {urgency === 'critical' && (
          <p className="text-xs mt-2 font-semibold" style={{ color: '#dc2626' }}>
            {t('trial.endingSoon')}
          </p>
        )}
        {showTimer && endsAt && (
          <div className="mt-2">
            <TrialCountdownTimer endsAt={endsAt} urgency={urgency} />
          </div>
        )}
        {urgency && (
          <button onClick={goToPlans} className="btn btn-primary text-sm py-1.5 w-full mt-2">
            {t('trial.upgradeNow')}
          </button>
        )}
      </div>
    );
  }

  if (usedUp) {
    return (
      <div className="rounded-xl p-4 text-center" style={{ background: 'var(--surface-2)' }}>
        <div className="text-2xl mb-2" aria-hidden="true">⏰</div>
        <div className="text-sm font-medium mb-1">{t('trial.endedTitle')}</div>
        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
          {t('trial.endedNote')}
        </p>
        <button onClick={goToPlans} className="btn btn-primary text-sm py-2 w-full">
          {t('trial.extend')}
        </button>
        <div
          className="mt-3 rounded-xl p-3"
          style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.08), rgba(34,197,94,0.02))', border: '1px solid rgba(34,197,94,0.2)' }}
        >
          <p className="text-xs font-semibold" style={{ color: '#16a34a' }}>
            {t('trial.specialOffer')}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {t('trial.specialOfferDesc')}
          </p>
        </div>
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
      <div className="flex flex-wrap justify-center gap-2 mb-3 text-xs opacity-90">
        <span className="px-2 py-1 rounded-full" style={{ background: 'rgba(255,255,255,0.15)' }}>🧠 AI Analysis</span>
        <span className="px-2 py-1 rounded-full" style={{ background: 'rgba(255,255,255,0.15)' }}>📊 Portfolio</span>
        <span className="px-2 py-1 rounded-full" style={{ background: 'rgba(255,255,255,0.15)' }}>⚡ 20 Exchanges</span>
      </div>
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

function TrialCountdownTimer({ endsAt, urgency }: { endsAt: string; urgency?: 'critical' | 'warning' | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, new Date(endsAt).getTime() - now);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);

  const color = urgency === 'critical' ? '#dc2626' : urgency === 'warning' ? '#b45309' : 'var(--brand)';

  return (
    <div
      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg font-mono text-sm font-bold"
      style={{ background: 'rgba(0,0,0,0.06)', color }}
      aria-live="polite"
    >
      <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: color }} />
      {h.toString().padStart(2, '0')}:{m.toString().padStart(2, '0')}:{s.toString().padStart(2, '0')}
    </div>
  );
}
