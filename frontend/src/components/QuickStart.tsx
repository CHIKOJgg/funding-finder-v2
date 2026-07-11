import { useState } from 'react';
import { clsx } from 'clsx';

interface QuickStartProps {
  hasScanResults: boolean;
  selectedCount: number;
}

const STEPS = [
  { key: 'select', label: 'Выбери биржи вверху (уже отмечены все 5)' },
  { key: 'scan', label: 'Нажми «Сканировать» и дождись результатов' },
  { key: 'open', label: 'Открой лучшую пару на бирже кнопкой «↗ Открыть позицию»' },
  { key: 'hold', label: 'Держи позицию до фандинга — получи ставку (см. ⏱ таймер)' },
] as const;

// Persistent, dismissible checklist that turns the abstract app into a
// concrete 4-step path to the user's first funding profit.
export function QuickStart({ hasScanResults, selectedCount }: QuickStartProps) {
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
          🎯 Первая прибыль за 5 минут
        </h2>
        <button
          onClick={dismiss}
          className="text-xs"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Закрыть гайд"
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
              {step.label}
            </span>
          </li>
        ))}
      </ol>
      {allDone && (
        <p className="text-xs mt-2" style={{ color: 'var(--success)' }}>
          ✓ Готово! Теперь просто дождись фандинга.
        </p>
      )}
    </div>
  );
}
