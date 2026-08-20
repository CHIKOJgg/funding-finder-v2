import { ReactNode, useState } from 'react';
import { clsx } from 'clsx';
import { useT } from '../i18n';
import { IconChevronDown, IconSlidersHorizontal } from './icons';

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
        className="w-full flex items-center justify-between min-h-[44px] active:opacity-80"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 font-medium text-[var(--text)]">
          <IconSlidersHorizontal size={18} aria-hidden />
          {label}
          {activeCount > 0 && (
            <span
              className="text-xs px-2 py-0.5 rounded-full bg-[var(--cobalt)] text-[var(--on-brand)]"
              aria-label={`${t('filter.activeCount', { count: activeCount })}`}
            >
              {activeCount}
            </span>
          )}
        </span>
        <IconChevronDown
          size={18}
          className={clsx('text-[var(--text3)] transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open && <div className="mt-3 space-y-3">{children}</div>}
    </div>
  );
}

/** Small labelled control wrapper for a consistent stacked layout. */
export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-[var(--text)] mb-1.5">{label}</label>
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
    <div className="grid grid-cols-4 gap-1 p-1 bg-[var(--surface-2)] rounded-xl border border-[var(--border)]">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={clsx(
            'text-xs py-2 px-1 text-center rounded-lg font-medium transition-all active:scale-[0.98]',
            value === opt.value
              ? 'bg-[var(--cobalt)] text-[var(--on-brand)] shadow-sm'
              : 'text-[var(--text-muted)] hover:text-[var(--text)]'
          )}
          aria-pressed={value === opt.value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
