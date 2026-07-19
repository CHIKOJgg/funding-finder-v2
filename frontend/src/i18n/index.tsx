import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { ru } from './ru';
import { en } from './en';
import { tr } from './tr';
import { vi } from './vi';
import { hi } from './hi';
import { es } from './es';

export type Lang = 'ru' | 'en' | 'tr' | 'vi' | 'hi' | 'es';

export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: 'ru', label: 'RU' },
  { code: 'en', label: 'EN' },
  { code: 'tr', label: 'TR' },
  { code: 'vi', label: 'VI' },
  { code: 'hi', label: 'HI' },
  { code: 'es', label: 'ES' },
];

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

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('ff_lang') : null;
    return (saved as Lang) ?? 'ru';
  });

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
