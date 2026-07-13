import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { ru } from './ru';
import { en } from './en';

export type Lang = 'ru' | 'en';

export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: 'ru', label: 'RU' },
  { code: 'en', label: 'EN' },
];

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
    return saved === 'en' || saved === 'ru' ? saved : 'ru';
  });

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem('ff_lang', l);
    setLangState(l);
    if (typeof document !== 'undefined') document.documentElement.lang = l;
  }, []);

  const t = useCallback(
    (key: string, vars?: Vars) => {
      const dict: Dict = lang === 'en' ? en : ru;
      let str: string = dict[key] ?? ru[key] ?? key;
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
