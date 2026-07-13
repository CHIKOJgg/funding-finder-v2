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
      className={`inline-flex rounded-full border border-gray-300 overflow-hidden text-xs font-medium ${className}`}
      role="group"
      aria-label="Language"
    >
      {languages.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => handle(l.code)}
          aria-pressed={lang === l.code}
          className={
            lang === l.code
              ? 'px-3 py-1 bg-[var(--brand)] text-white'
              : 'px-3 py-1 text-gray-600 hover:bg-gray-100'
          }
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
