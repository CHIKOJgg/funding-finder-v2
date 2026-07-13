import { ReactNode, useState } from 'react';
import { clsx } from 'clsx';
import { useT } from '../i18n';

interface Props {
  activeCount: number;
  children: ReactNode;
  defaultOpen?: boolean;
  title?: string;
}

/**
 * Collapsible container for filter controls. Shows a single "Фильтры" row with
 * a live count of active filters, so the controls don't eat screen space until
 * the user opens them. Stays open by default when any filter is already active.
 */
export function FilterBar({ activeCount, children, defaultOpen, title }: Props) {
  const [open, setOpen] = useState(defaultOpen ?? activeCount > 0);
  const t = useT();
  const label = title ?? t('filter.title');

  return (
    <div className="card p-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 font-medium text-gray-700">
          <span aria-hidden>🔧</span>
          {label}
          {activeCount > 0 && (
            <span
              className="text-xs px-2 py-0.5 rounded-full bg-[var(--brand)] text-white"
              aria-label={`${t('filter.activeCount', { count: activeCount })}`}
            >
              {activeCount}
            </span>
          )}
        </span>
        <span className="text-gray-400">{open ? '▴' : '▾'}</span>
      </button>

      {open && <div className="mt-3 space-y-3">{children}</div>}
    </div>
  );
}

/** Small labelled control wrapper for a consistent stacked layout. */
export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

/** Segmented toggle group (e.g. risk levels, sort modes). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={clsx(
            'text-xs px-3 py-1.5 rounded-full border transition',
            value === opt.value
              ? 'bg-[var(--brand)] text-white border-[var(--brand)]'
              : 'bg-transparent text-gray-600 border-gray-300'
          )}
          aria-pressed={value === opt.value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
