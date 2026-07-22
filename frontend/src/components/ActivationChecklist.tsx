import { useEffect, useState, useCallback } from 'react';
import { useApp } from '../App';
import { useT } from '../i18n';

// "First profit in 5 minutes" activation checklist. Guides a brand-new user
// through the four actions that turn an open app into a real, activated user:
// pick exchanges → run a scan → open the trade → start the free trial.
// Each step is driven by a genuine signal (real state, not a click-through
// wizard) so the progress bar reflects what the user has actually done.

const STEPS = [
  { key: 'exchanges', signal: 'exchanges' },
  { key: 'scan', signal: 'scan' },
  { key: 'position', signal: 'position' },
  { key: 'trial', signal: 'trial' },
] as const;

const DISMISS_KEY = 'ff_activation_dismissed';

export function ActivationChecklist() {
  const { selectedExchanges, scanResults, subscription, trialStatus } = useApp();
  const t = useT();
  const [opened, setOpened] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
      setOpened(localStorage.getItem('ff_opened_position') === '1');
    } catch { /* ignore */ }

    // Re-read the "opened a position" flag while the checklist is visible.
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
      }, 2500);
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

  return (
    <div className="card" style={{ borderColor: 'var(--brand)', borderWidth: 1.5 }}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-bold" style={{ color: 'var(--brand)' }}>
          {allDone ? '🎉 ' + t('activation.done') : t('activation.title')}
        </div>
        <button
          onClick={() => {
            try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
            setDismissed(true);
          }}
          className="text-xs text-[var(--text-muted)] px-1"
          aria-label="Dismiss checklist"
        >
          ✕
        </button>
      </div>

      <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden mb-3">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${(total / STEPS.length) * 100}%`, background: 'var(--brand)' }}
        />
      </div>

      <ul className="space-y-1.5">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2 text-sm">
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              style={{
                background: done[i] ? 'var(--brand)' : 'var(--surface-2)',
                color: done[i] ? '#fff' : 'var(--text-muted)',
              }}
            >
              {done[i] ? '✓' : i + 1}
            </span>
            <div className={done[i] ? 'line-through text-[var(--text-muted)]' : ''}>
              <div className="font-medium leading-tight">{stepTitles[i]}</div>
            </div>
          </li>
        ))}
      </ul>

      {!allDone && (
        <p className="text-xs text-[var(--text-muted)] mt-2">{stepSub[done.indexOf(false)]}</p>
      )}
    </div>
  );
}
