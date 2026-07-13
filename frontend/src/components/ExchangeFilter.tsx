import { clsx } from 'clsx';
import { exchangeLabel } from '../utils/exchanges';

interface Props {
  exchanges: string[];        // available exchange ids to choose from
  selected: string[];         // selected ids (empty = no filter / all)
  onChange: (next: string[]) => void;
  label?: string;
}

/**
 * Multi-select chip group used to filter lists by exchange. Selecting nothing
 * means "all exchanges" (no filtering), which keeps the default behaviour.
 */
export function ExchangeFilter({ exchanges, selected, onChange, label = 'Биржи' }: Props) {
  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((e) => e !== id));
    else onChange([...selected, id]);
  };

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {selected.length > 0 && (
          <button
            onClick={() => onChange([])}
            className="text-xs text-[var(--brand)] hover:underline"
            aria-label="Сбросить фильтр бирж"
          >
            Сбросить
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {exchanges.map((id) => {
          const active = selected.includes(id);
          return (
            <button
              key={id}
              onClick={() => toggle(id)}
              className={clsx(
                'text-xs px-2.5 py-1 rounded-full border transition',
                active
                  ? 'bg-[var(--brand)] text-white border-[var(--brand)]'
                  : 'bg-transparent text-gray-600 border-gray-300'
              )}
              aria-pressed={active}
            >
              {exchangeLabel(id)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
