import { useState } from 'react';
import { clsx } from 'clsx';
import { ALL_EXCHANGES, exchangeLabel } from '../utils/exchanges';

interface ExchangeSelectorProps {
  value: string[];
  onChange: (next: string[]) => void;
  maxExchanges?: number;
  onLimitReached?: () => void;
  title?: string;
  showCount?: boolean;
}

const ALL = ALL_EXCHANGES as readonly string[];

/**
 * Compact exchange picker. Replaces the long row of 23 toggle buttons with two
 * actions — "Все биржи" and "Выбрать конкретное" (a dropdown + removable chips)
 * — so the UI stays calm and scannable.
 */
export function ExchangeSelector({
  value,
  onChange,
  maxExchanges,
  onLimitReached,
  title = 'Биржи',
  showCount = false,
}: ExchangeSelectorProps) {
  const [specificOpen, setSpecificOpen] = useState(false);

  const allowed = maxExchanges ?? ALL.length;
  const isAll =
    allowed > 0 && value.length >= allowed && ALL.slice(0, allowed).every((e) => value.includes(e));

  const selectAll = () => {
    // "All" means all the user is allowed to scan under their plan (capped).
    const allowed = maxExchanges ?? ALL.length;
    onChange(ALL.slice(0, allowed));
    setSpecificOpen(false);
  };

  const addExchange = (exchange: string) => {
    if (!exchange || value.includes(exchange)) return;
    if (maxExchanges && value.length >= maxExchanges) {
      onLimitReached?.();
      return;
    }
    onChange([...value, exchange]);
  };

  const removeExchange = (exchange: string) => {
    onChange(value.filter((e) => e !== exchange));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {showCount && (
          <span className="chip" style={{ color: 'var(--text-muted)' }}>
            {value.length}/{maxExchanges ?? ALL.length}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <button
          type="button"
          onClick={selectAll}
          className={clsx('exchange-btn', isAll && 'active')}
        >
          Все биржи
        </button>
        <button
          type="button"
          onClick={() => setSpecificOpen((o) => !o)}
          className={clsx('exchange-btn', specificOpen && 'active')}
        >
          Выбрать конкретное
        </button>
      </div>

      {isAll ? (
        <p className="text-sm text-muted">Выбраны все доступные биржи</p>
      ) : (
        <div>
          {specificOpen && (
            <select
              className="exchange-select mb-3"
              value=""
              onChange={(e) => addExchange(e.target.value)}
            >
              <option value="" disabled>
                Добавить биржу…
              </option>
              {ALL.map((exchange) => (
                <option key={exchange} value={exchange} disabled={value.includes(exchange)}>
                  {exchangeLabel(exchange)}
                </option>
              ))}
            </select>
          )}

          <div className="flex flex-wrap gap-2">
            {value.length === 0 && <span className="text-sm text-muted">Ничего не выбрано</span>}
            {value.map((exchange) => (
              <span
                key={exchange}
                className="chip chip-removable"
                role="button"
                tabIndex={0}
                onClick={() => removeExchange(exchange)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') removeExchange(exchange);
                }}
                aria-label={`Убрать ${exchangeLabel(exchange)}`}
              >
                {exchangeLabel(exchange)}
                <span className="chip-x" aria-hidden>
                  ×
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
