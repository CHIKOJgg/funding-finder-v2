import { useState, useRef, useEffect } from 'react';
import { clsx } from 'clsx';
import { ALL_EXCHANGES, exchangeLabel } from '../utils/exchanges';

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
export function ExchangeSelect({ selected, onChange, exchanges = ALL_EXCHANGES, label = 'Биржи' }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
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
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {selected.length > 0 && (
          <button
            onClick={() => onChange([])}
            className="text-xs text-[var(--brand)] hover:underline"
            aria-label="Сбросить выбор бирж"
          >
            Сбросить
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between input-field text-sm"
        aria-expanded={open}
        aria-label="Выбрать биржи"
      >
        <span className={clsx(selected.length === 0 && 'text-gray-400')}>
          {selected.length === 0 ? 'Все биржи' : `Выбрано: ${selected.length}`}
        </span>
        <span className="ml-2 text-gray-400">{open ? '▴' : '▾'}</span>
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
              aria-label={`Убрать ${exchangeLabel(id)}`}
            >
              {exchangeLabel(id)}
              <span className="chip-x" aria-hidden>
                ×
              </span>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg p-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск биржи…"
            className="input-field text-sm mb-2"
            aria-label="Поиск биржи"
          />
          <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
            {filtered.length === 0 && (
              <div className="text-sm text-gray-400 p-2">Ничего не найдено</div>
            )}
            {filtered.map((id) => {
              const active = selected.includes(id);
              return (
                <label
                  key={id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 cursor-pointer text-sm"
                >
                  <input type="checkbox" checked={active} onChange={() => toggle(id)} />
                  <span>{exchangeLabel(id)}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
