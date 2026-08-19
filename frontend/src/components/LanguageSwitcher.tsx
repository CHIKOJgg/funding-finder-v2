import { useState, useRef, useEffect } from 'react';
import { useI18n, Lang, LANGUAGES } from '../i18n';
import { clsx } from 'clsx';

interface LanguageSwitcherProps {
  className?: string;
  variant?: 'dropdown' | 'pills';
  onChange?: (l: Lang) => void;
}

/**
 * Modern, accessible LanguageSwitcher supporting both dropdown menu (for header)
 * and pills grid (for settings).
 */
export function LanguageSwitcher({
  className = '',
  variant = 'dropdown',
  onChange,
}: LanguageSwitcherProps) {
  const { lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleOutside);
    }
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const handleSelect = (code: Lang) => {
    setLang(code);
    onChange?.(code);
    setOpen(false);
  };

  const current = LANGUAGES.find((l) => l.code === lang) || LANGUAGES[0];

  if (variant === 'pills') {
    return (
      <div className={clsx('flex flex-wrap gap-2', className)} role="group" aria-label="Language">
        {LANGUAGES.map((l) => {
          const active = lang === l.code;
          return (
            <button
              key={l.code}
              type="button"
              onClick={() => handleSelect(l.code)}
              aria-pressed={active}
              className={clsx(
                'flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-all active:scale-95',
                active
                  ? 'bg-[var(--cobalt)] text-[var(--on-brand)] border-[var(--cobalt)] shadow-sm'
                  : 'bg-[var(--surface-2)] text-[var(--text2)] border-[var(--border)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]'
              )}
            >
              <span className="text-base leading-none">{l.flag}</span>
              <span>{l.name}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div ref={ref} className={clsx('relative inline-block text-left shrink-0', className)}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text)] border border-[var(--border)] transition-all active:scale-95 cursor-pointer select-none"
        aria-expanded={open}
        aria-haspopup="true"
        title="Сменить язык / Change language"
      >
        <span className="text-xs leading-none">🌐</span>
        <span className="font-mono font-bold uppercase">{current.label}</span>
        <svg
          className={clsx('w-3 h-3 text-[var(--text-muted)] transition-transform duration-200', open && 'rotate-180')}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1.5 w-40 rounded-xl bg-[var(--card)] border border-[var(--border-2)] shadow-2xl py-1 z-50 animate-fadeIn backdrop-blur-md"
          style={{ backgroundColor: 'var(--card)' }}
          role="menu"
        >
          {LANGUAGES.map((l) => {
            const active = lang === l.code;
            return (
              <button
                key={l.code}
                type="button"
                role="menuitem"
                onClick={() => handleSelect(l.code)}
                className={clsx(
                  'w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-left transition-colors cursor-pointer',
                  active
                    ? 'bg-[var(--cobalt)]/15 text-[var(--cobalt)] font-semibold'
                    : 'text-[var(--text)] hover:bg-[var(--surface-2)]'
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="text-[10px] font-mono font-bold px-1 py-0.5 rounded bg-[var(--surface-2)] text-[var(--text2)]">{l.label}</span>
                  <span>{l.name}</span>
                </span>
                {active && <span className="text-[var(--cobalt)] font-bold text-xs">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

