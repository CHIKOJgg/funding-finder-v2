import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { ru } from './ru';
import { en } from './en';
import { tr } from './tr';
import { vi } from './vi';
import { hi } from './hi';
import { es } from './es';

export type Lang = 'ru' | 'en' | 'tr' | 'vi' | 'hi' | 'es';

// Only fully translated locales are offered in the switcher. TR/VI/HI/ES
// dictionaries are partial (~60 of 950 keys) and would silently fall back to
// English — a fake "supported" language. Keep them in DICTS so a previously
// saved preference still resolves; they just stop being selectable.
export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: 'ru', label: 'RU' },
  { code: 'en', label: 'EN' },
];

export const SUPPORTED_LANG_CODES = new Set<string>(LANGUAGES.map((l) => l.code));

const DICTS: Record<Lang, Dict> = { ru, en, tr, vi, hi, es };

type Dict = Record<string, string>;
type Vars = Record<string, string | number>;

interface I18nContextType {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Vars) => string;
  languages: typeof LANGUAGES;
}

const I18nContext = createContext<I18nContextType>({
  lang: 'ru',
  setLang: () => {},
  t: (key) => key,
  languages: LANGUAGES,
});

// Detect the initial UI language for a visitor who never picked one:
// 1) saved preference, 2) Telegram Mini App language_code, 3) browser language,
// 4) English (the campaign default — the old hardcoded Russian default put
// TR/VI/HI/ES campaign traffic into a Russian UI).
function detectInitialLang(): Lang {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('ff_lang') : null;
    if (saved && SUPPORTED_LANG_CODES.has(saved)) return saved as Lang;
    const tgLang = (window.Telegram?.WebApp?.initDataUnsafe?.user as any)?.language_code as string | undefined;
    if (tgLang && SUPPORTED_LANG_CODES.has(tgLang)) return tgLang as Lang;
    const nav = (navigator.language || (navigator as any).userLanguage || 'en').slice(0, 2).toLowerCase();
    if (nav && SUPPORTED_LANG_CODES.has(nav)) return nav as Lang;
  } catch {
    /* ignore detection errors */
  }
  return 'en';
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectInitialLang);

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem('ff_lang', l);
    setLangState(l);
    if (typeof document !== 'undefined') document.documentElement.lang = l;
  }, []);

  const t = useCallback(
    (key: string, vars?: Vars) => {
      // Resolve order: requested locale → English (global fallback) → key.
      // English is the lingua franca so newly-added locales (TR/VI/HI/ES) only
      // need their high-traffic strings translated; the rest degrade to EN.
      const dict: Dict = DICTS[lang] ?? en;
      let str: string = dict[key] ?? en[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }
      return str;
    },
    [lang]
  );

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t, languages: LANGUAGES }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

/** Returns the translate function. Falls back to Russian, then to the key. */
export function useT() {
  return useContext(I18nContext).t;
}
