import { useState } from 'react';
import { clsx } from 'clsx';
import { useT } from '../i18n';

interface QuickStartProps {
  hasScanResults: boolean;
  selectedCount: number;
}

const STEPS = [
  { key: 'select', label: 'quickstart.select' },
  { key: 'scan', label: 'quickstart.scan' },
  { key: 'open', label: 'quickstart.open' },
  { key: 'hold', label: 'quickstart.hold' },
] as const;

// Persistent, dismissible checklist that turns the abstract app into a
// concrete 4-step path to the user's first funding profit.
export function QuickStart({ hasScanResults, selectedCount }: QuickStartProps) {
  const t = useT();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('ff_quickstart_done') === '1';
    } catch {
      return false;
    }
  });
  const [opened] = useState(() => {
    try {
      return localStorage.getItem('ff_opened_position') === '1';
    } catch {
      return false;
    }
  });

  // Hide the quick-start checklist until the first-run onboarding is finished,
  // so the two intro layers don't stack on top of each other.
  const onboardingDone = (() => {
    try {
      return localStorage.getItem('ff_onboarding_done') === 'true';
    } catch {
      return false;
    }
  })();
  if (!onboardingDone) return null;

  if (dismissed || (opened && hasScanResults)) return null;

  const done: Record<string, boolean> = {
    select: selectedCount > 0,
    scan: hasScanResults,
    open: opened,
    hold: false,
  };

  const allDone = STEPS.every((s) => done[s.key]);

  const dismiss = () => {
    try {
      localStorage.setItem('ff_quickstart_done', '1');
    } catch { /* ignore */ }
    setDismissed(true);
  };

  return (
    <div className="rounded-xl p-4 mb-4" style={{ background: 'var(--brand-soft)', border: '1px solid var(--brand)' }}>
      <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold" style={{ color: 'var(--brand)' }}>
            {t('quickstart.title')}
          </h2>
          <button
            onClick={dismiss}
            className="text-xs"
            style={{ color: 'var(--text-muted)' }}
            aria-label={t('quickstart.closeAria')}
          >
          ✕
        </button>
      </div>
      <ol className="space-y-1.5">
        {STEPS.map((step, idx) => (
          <li key={step.key} className="flex items-start gap-2 text-sm">
            <span
              className={clsx(
                'mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                done[step.key] ? 'text-white' : 'text-white opacity-70'
              )}
              style={{ background: done[step.key] ? 'var(--success)' : 'var(--brand)' }}
            >
              {done[step.key] ? '✓' : idx + 1}
            </span>
            <span className={clsx(done[step.key] && 'line-through')} style={{ color: 'var(--text)' }}>
              {t(step.label)}
            </span>
          </li>
        ))}
      </ol>
      {allDone && (
        <p className="text-xs mt-2" style={{ color: 'var(--success)' }}>
          ✓ {t('quickstart.done')}
        </p>
      )}
    </div>
  );
}
