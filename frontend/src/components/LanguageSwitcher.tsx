import { useI18n, Lang } from '../i18n';

/**
 * Compact RU/EN toggle. Persists the choice to localStorage (handled by the
 * LanguageProvider) and re-renders the whole tree via the i18n context.
 */
export function LanguageSwitcher({ className = '', onChange }: { className?: string; onChange?: (l: Lang) => void }) {
  const { lang, setLang, languages } = useI18n();

  const handle = (l: Lang) => {
    setLang(l);
    onChange?.(l);
  };

  return (
    <div
      className={`inline-flex rounded-xl overflow-hidden text-xs font-semibold ${className}`}
      style={{ background: 'var(--card)', border: '1px solid var(--border-2)', gap: 4, padding: 4 }}
      role="group"
      aria-label="Language"
    >
      {languages.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => handle(l.code)}
          aria-pressed={lang === l.code}
          className="min-w-[44px] py-2 px-3 rounded-lg transition-colors"
          style={
            lang === l.code
              ? { background: 'var(--cobalt)', color: 'var(--on-brand)' }
              : { background: 'transparent', color: 'var(--text3)' }
          }
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
