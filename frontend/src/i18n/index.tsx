import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { ru } from './ru';
import { en } from './en';

export type Lang = 'ru' | 'en';

export interface LanguageOption {
  code: Lang;
  label: string;
  name: string;
  flag: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: 'ru', label: 'RU', name: 'Русский', flag: '🇷🇺' },
  { code: 'en', label: 'EN', name: 'English', flag: '🇬🇧' },
];

export const SUPPORTED_LANG_CODES = new Set<string>(LANGUAGES.map((l) => l.code));

const DICTS: Record<Lang, Dict> = { ru, en };

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

// Detect the initial UI language:
// 1) saved preference in localStorage
// 2) Telegram Mini App language_code (if 'ru'/'be'/'uk'/'kk' -> 'ru', else 'en')
// 3) browser language (if 'ru' -> 'ru', else 'en')
function detectInitialLang(): Lang {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('ff_lang') : null;
    if (saved && SUPPORTED_LANG_CODES.has(saved)) return saved as Lang;
    const tgLang = (window.Telegram?.WebApp?.initDataUnsafe?.user as any)?.language_code as string | undefined;
    if (tgLang) {
      const lower = tgLang.toLowerCase();
      if (lower.startsWith('ru') || lower.startsWith('be') || lower.startsWith('uk') || lower.startsWith('kk')) {
        return 'ru';
      }
      return 'en';
    }
    const nav = (navigator.language || (navigator as any).userLanguage || 'ru').slice(0, 2).toLowerCase();
    if (nav === 'ru' || nav === 'be' || nav === 'uk' || nav === 'kk') return 'ru';
    return 'en';
  } catch {
    /* ignore detection errors */
  }
  return 'ru';
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
