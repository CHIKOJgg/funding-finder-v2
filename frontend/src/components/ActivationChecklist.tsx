import { useEffect, useState, useCallback } from 'react';
import { useApp } from '../App';
import { useT } from '../i18n';

const STEPS = [
  { key: 'exchanges', signal: 'exchanges' },
  { key: 'scan', signal: 'scan' },
  { key: 'position', signal: 'position' },
  { key: 'trial', signal: 'trial' },
] as const;

const DISMISS_KEY = 'ff_activation_dismissed';
const FIRST_OPEN_KEY = 'ff_first_open';

export function ActivationChecklist() {
  const { selectedExchanges, scanResults, subscription, trialStatus } = useApp();
  const t = useT();
  const [opened, setOpened] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [daysSinceOpen, setDaysSinceOpen] = useState(0);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
      setOpened(localStorage.getItem('ff_opened_position') === '1');
      const firstOpen = localStorage.getItem(FIRST_OPEN_KEY);
      if (firstOpen) {
        const diff = Date.now() - parseInt(firstOpen, 10);
        setDaysSinceOpen(Math.floor(diff / 86400000));
      } else {
        localStorage.setItem(FIRST_OPEN_KEY, String(Date.now()));
      }
    } catch { /* ignore */ }

    const id = setInterval(() => {
      try {
        setOpened(localStorage.getItem('ff_opened_position') === '1');
      } catch { /* ignore */ }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const completed = useCallback((): boolean[] => {
    const trialDone = subscription !== 'free' || Boolean(trialStatus?.used);
    return [
      selectedExchanges.length >= 1,
      Boolean(scanResults),
      opened,
      trialDone,
    ];
  }, [selectedExchanges.length, scanResults, opened, subscription, trialStatus?.used]);

  const done = completed();
  const total = done.filter(Boolean).length;
  const allDone = total === STEPS.length;

  useEffect(() => {
    if (allDone) {
      const id = setTimeout(() => {
        try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
        setDismissed(true);
      }, 3000);
      return () => clearTimeout(id);
    }
  }, [allDone]);

  if (dismissed) return null;

  const stepTitles = [
    t('activation.step1'),
    t('activation.step2'),
    t('activation.step3'),
    t('activation.step4'),
  ];
  const stepSub = [
    t('activation.step1Sub'),
    t('activation.step2Sub'),
    t('activation.step3Sub'),
    t('activation.step4Sub'),
  ];

  const nextStepIdx = done.indexOf(false);
  const pct = (total / STEPS.length) * 100;

  return (
    <div className="card" style={{ borderColor: 'var(--brand)', borderWidth: 1.5 }}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-bold" style={{ color: 'var(--brand)' }}>
          {allDone ? '🎉 ' + t('activation.done') : '🚀 ' + t('activation.title')}
        </div>
        <button
          onClick={() => {
            try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
            setDismissed(true);
          }}
          className="text-xs text-[var(--text-muted)] px-1"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>

      {/* Gamification: fire emoji + count */}
      {!allDone && (
        <div
          className="rounded-lg p-2 mb-2 text-xs font-semibold flex items-center gap-1.5"
          style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
        >
          <span>🔥</span>
          <span>{total}/{STEPS.length} done — {STEPS.length - total} remaining</span>
        </div>
      )}

      {/* Progress bar with label */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--green)' : 'var(--brand)' }}
          />
        </div>
        <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>
          {Math.round(pct)}%
        </span>
      </div>

      {/* Steps */}
      <ul className="space-y-1.5">
        {STEPS.map((s, i) => (
          <li
            key={s.key}
            className="flex items-center gap-2 text-sm p-1.5 rounded-lg"
            style={{
              background: i === nextStepIdx && !allDone ? 'var(--surface-2)' : 'transparent',
            }}
          >
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all"
              style={{
                background: done[i] ? 'var(--green)' : i === nextStepIdx ? 'var(--brand)' : 'var(--surface-2)',
                color: done[i] ? '#fff' : i === nextStepIdx ? '#fff' : 'var(--text-muted)',
              }}
            >
              {done[i] ? '✓' : i === nextStepIdx ? '→' : i + 1}
            </span>
            <div className={done[i] ? 'line-through text-[var(--text-muted)]' : ''}>
              <div className="font-medium leading-tight">{stepTitles[i]}</div>
            </div>
          </li>
        ))}
      </ul>

      {/* Next step hint */}
      {!allDone && nextStepIdx >= 0 && (
        <p className="text-xs mt-2 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
          <span>💡</span>
          <span>{stepSub[nextStepIdx]}</span>
        </p>
      )}

      {/* Retention hint */}
      {daysSinceOpen >= 1 && !allDone && (
        <p className="text-xs mt-2 text-center" style={{ color: 'var(--amber)' }}>
          {daysSinceOpen >= 7
            ? '📆 Day ' + daysSinceOpen + ' — complete activation to unlock full potential'
            : '📆 ' + daysSinceOpen + 'd since start — finish setup'}
        </p>
      )}
    </div>
  );
}