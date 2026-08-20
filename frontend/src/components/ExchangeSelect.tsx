import { useState, useRef, useEffect } from 'react';
import { clsx } from 'clsx';
import { ALL_EXCHANGES, exchangeLabel, getPlanDefaultExchanges } from '../utils/exchanges';
import { useT } from '../i18n';
import { useToast } from './Toast';
import { IconCheck, IconChevronDown, IconX } from './icons';

interface Props {
  selected: string[];          // selected ids (empty = all)
  onChange: (next: string[]) => void;
  exchanges?: string[];        // available ids (defaults to all supported)
  label?: string;
  maxAllowed?: number;
  planName?: string;
}

/**
 * Compact, searchable multi-select for picking exchanges. Replaces the long
 * wall of toggle chips: a single trigger shows the current selection as
 * removable pills, and expanding it reveals a searchable, scrollable checklist.
 * Fully plan-aware with max limit protection.
 */
export function ExchangeSelect({
  selected,
  onChange,
  exchanges = ALL_EXCHANGES,
  label,
  maxAllowed = ALL_EXCHANGES.length,
  planName = 'free',
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const t = useT();
  const { showToast } = useToast();
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
    if (selected.includes(id)) {
      onChange(selected.filter((e) => e !== id));
    } else {
      if (selected.length >= maxAllowed) {
        showToast(
          t('exchangeSelect.limitReached', { plan: planName.toUpperCase(), max: maxAllowed }) ||
          `Лимит плана ${planName.toUpperCase()}: максимум ${maxAllowed} бирж.`,
          'info'
        );
        return;
      }
      onChange([...selected, id]);
    }
  };

  const handleSelectDefault = () => {
    const def = getPlanDefaultExchanges(planName);
    onChange(def.slice(0, maxAllowed));
  };

  const filtered = exchanges.filter((e) =>
    e.toLowerCase().includes(query.toLowerCase()) ||
    exchangeLabel(e).toLowerCase().includes(query.toLowerCase())
  );

  const isMaxReached = selected.length >= maxAllowed;

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-semibold text-[var(--text)] flex items-center gap-2">
          {resolvedLabel}
          <span className="text-xs font-mono font-normal text-[var(--text-muted)]">
            ({selected.length}/{maxAllowed})
          </span>
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSelectDefault}
            className="text-xs font-medium text-[var(--brand)] hover:underline"
            title="Восстановить список по умолчанию для вашего тарифа"
          >
            {t('exchangeSelect.default') || 'По умолчанию'}
          </button>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
              aria-label={t('exchangeSelect.reset')}
            >
              {t('exchangeSelect.reset')}
            </button>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between input-field text-sm"
        aria-expanded={open}
        aria-label={resolvedLabel}
      >
        <span className={clsx(selected.length === 0 && 'text-[var(--text3)]', 'font-medium')}>
          {selected.length === 0
            ? t('exchangeSelect.noneSelected') || 'Биржи не выбраны'
            : t('exchangeSelect.planLimit', { selected: selected.length, max: maxAllowed, plan: planName.toUpperCase() }) ||
              `Выбрано: ${selected.length} / ${maxAllowed} (${planName.toUpperCase()})`}
        </span>
        <IconChevronDown
          size={18}
          className={clsx('ml-2 text-[var(--text3)] transition-transform', open && 'rotate-180')}
        />
      </button>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
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
        <div className="absolute z-30 mt-1.5 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-xl backdrop-blur-md">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('exchangeSelect.search')}
            className="input-field text-sm mb-2 w-full"
            aria-label={t('exchangeSelect.search')}
          />
          <div className="flex items-center justify-between px-1 py-1 text-xs text-[var(--text-muted)] border-b border-[var(--border)] mb-1.5">
            <span>{selected.length} / {maxAllowed} {t('exchangeSelect.selectedWord') || 'выбрано'}</span>
            {isMaxReached && (
              <span className="text-[var(--amber)] font-medium">
                {t('exchangeSelect.limitReachedShort') || 'Лимит тарифа достигнут'}
              </span>
            )}
          </div>
          <div className="overflow-y-auto space-y-1" style={{ maxHeight: 240 }}>
            {filtered.length === 0 && (
              <div className="text-sm text-[var(--text3)] p-2 text-center">{t('exchangeSelect.none')}</div>
            )}
            {filtered.map((id) => {
              const active = selected.includes(id);
              const disabled = !active && isMaxReached;
              return (
                <label
                  key={id}
                  className={clsx(
                    'flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-colors cursor-pointer text-sm select-none',
                    active ? 'bg-[var(--cobalt-soft)] text-[var(--text)]' : 'hover:bg-[var(--surface-2)] text-[var(--text-muted)]',
                    disabled && 'opacity-40 cursor-not-allowed'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    disabled={disabled}
                    onChange={() => toggle(id)}
                    className="rounded border-[var(--border)] text-[var(--brand)] focus:ring-0"
                  />
                  <span className={clsx('font-medium', active && 'text-[var(--text)] font-semibold')}>
                    {exchangeLabel(id)}
                  </span>
                  {active && <IconCheck size={16} className="ml-auto text-[var(--brand)]" aria-hidden />}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
