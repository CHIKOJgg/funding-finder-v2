import { useState, useRef, useEffect } from 'react';
import { clsx } from 'clsx';
import { ALL_EXCHANGES, exchangeLabel } from '../utils/exchanges';
import { useT } from '../i18n';
import { IconCheck, IconChevronDown, IconX } from './icons';

interface Props {
  selected: string[];          // selected ids (empty = all)
  onChange: (next: string[]) => void;
  exchanges?: string[];        // available ids (defaults to all supported)
  label?: string;
}

/**
 * Compact, searchable multi-select for picking exchanges. Replaces the long
 * wall of toggle chips: a single trigger shows the current selection as
 * removable pills, and expanding it reveals a searchable, scrollable checklist.
 * Scales well to the full 25-exchange list.
 */
export function ExchangeSelect({ selected, onChange, exchanges = ALL_EXCHANGES, label }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const t = useT();
  const resolvedLabel = label ?? t('exchangeSelect.label');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((e) => e !== id));
    else onChange([...selected, id]);
  };

  const filtered = exchanges.filter((e) => e.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium text-[var(--text2)]">{resolvedLabel}</span>
        {selected.length > 0 && (
          <button
            onClick={() => onChange([])}
            className="text-xs text-[var(--cobalt-text)] active:brightness-150"
            aria-label={t('exchangeSelect.reset')}
          >
            {t('exchangeSelect.reset')}
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between input-field text-sm"
        aria-expanded={open}
        aria-label={resolvedLabel}
      >
        <span className={clsx(selected.length === 0 && 'text-[var(--text3)]')}>
          {selected.length === 0 ? t('exchangeSelect.all') : t('exchangeSelect.selected', { count: selected.length })}
        </span>
        <IconChevronDown
          size={18}
          className={clsx('ml-2 text-[var(--text3)] transition-transform', open && 'rotate-180')}
        />
      </button>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {selected.map((id) => (
            <span
              key={id}
              className="chip chip-removable"
              role="button"
              tabIndex={0}
              onClick={() => toggle(id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') toggle(id);
              }}
              aria-label={`${t('exchangeSelect.remove')} ${exchangeLabel(id)}`}
            >
              {exchangeLabel(id)}
              <IconX size={12} className="chip-x" aria-hidden />
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-[var(--border-2)] bg-[var(--bg1)] p-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('exchangeSelect.search')}
            className="input-field text-sm mb-2"
            aria-label={t('exchangeSelect.search')}
          />
          <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
            {filtered.length === 0 && (
              <div className="text-sm text-[var(--text3)] p-2">{t('exchangeSelect.none')}</div>
            )}
            {filtered.map((id) => {
              const active = selected.includes(id);
              return (
                <label
                  key={id}
                  className="flex items-center gap-2 px-2 py-2 rounded-lg bg-[var(--bg1)] active:bg-[var(--card)] cursor-pointer text-sm min-h-[44px]"
                >
                  <input type="checkbox" checked={active} onChange={() => toggle(id)} />
                  <span className={clsx(active && 'text-[var(--cobalt-text)]')}>{exchangeLabel(id)}</span>
                  {active && <IconCheck size={16} className="ml-auto text-[var(--cobalt)]" aria-hidden />}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
