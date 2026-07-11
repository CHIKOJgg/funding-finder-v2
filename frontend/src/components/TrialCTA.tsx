import { useState } from 'react';
import { useApp } from '../App';
import { useToast } from './Toast';
import { TRIAL_DURATION_DAYS } from '../utils/plans';

function formatCountdown(endsAt: string | null, daysLeft: number, hoursLeft: number): string {
  if (!endsAt) return '';
  const totalHours = daysLeft * 24 + hoursLeft;
  if (totalHours > 24) {
    return `${daysLeft} дн. ${hoursLeft % 24} ч.`;
  }
  return `${hoursLeft} ч.`;
}

export function TrialCTA({ compact = false }: { compact?: boolean }) {
  const { trialStatus, activateTrial, refreshTrial, subscription } = useApp();
  const { showToast } = useToast();
  const [activating, setActivating] = useState(false);

  const active = trialStatus?.active ?? (subscription === 'pro' && trialStatus?.used);
  const usedUp = trialStatus?.used && !trialStatus?.active;

  const handleActivate = async () => {
    if (activating) return;
    setActivating(true);
    try {
      await activateTrial();
      await refreshTrial();
      showToast('Пробный Pro активирован!', 'success');
    } finally {
      setActivating(false);
    }
  };

  if (active) {
    return (
      <div className="rounded-xl p-3 text-center" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
        <div className="text-sm font-semibold">🎁 Пробный Pro активен</div>
        {trialStatus?.endsAt && (
          <div className="text-xs mt-1">
            Осталось: {formatCountdown(trialStatus.endsAt, trialStatus.daysLeft, trialStatus.hoursLeft)}
          </div>
        )}
      </div>
    );
  }

  if (usedUp) {
    return (
      <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-2)' }}>
        <div className="text-sm font-medium mb-2">Пробный период завершён</div>
        <button onClick={() => undefined} className="btn btn-primary text-sm py-2 w-full" disabled>
          Продлить Pro
        </button>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          Оформите подписку, чтобы не терять доходность
        </p>
      </div>
    );
  }

  if (compact) {
    return (
      <button onClick={handleActivate} disabled={activating} className="btn btn-primary text-sm py-1.5 w-full">
        {activating ? '...' : `🎁 Pro ${TRIAL_DURATION_DAYS} дня бесплатно`}
      </button>
    );
  }

  return (
    <div className="rounded-2xl p-4 text-center text-white relative overflow-hidden"
         style={{ background: 'linear-gradient(135deg, #3390ec 0%, #2b6fd6 60%, #1f4fb0 100%)' }}>
      <div className="text-2xl mb-1" aria-hidden="true">🎁</div>
      <div className="font-bold text-lg">Попробуйте Pro бесплатно</div>
      <p className="text-sm opacity-90 mt-1 mb-3">
        {TRIAL_DURATION_DAYS} дня всех фич: AI, рекомендации, арбитраж и портфель — без оплаты.
      </p>
      <button
        onClick={handleActivate}
        disabled={activating}
        className="btn w-full font-bold"
        style={{ background: '#fff', color: '#1f4fb0' }}
      >
        {activating ? 'Активация...' : `🎁 Активировать ${TRIAL_DURATION_DAYS} дня`}
      </button>
    </div>
  );
}
