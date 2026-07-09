import { useState, useEffect, useCallback } from 'react';
import { setTelegramInitData, setCurrentUserId } from '../api/client';

interface TelegramWebApp {
  initData?: string;
  initDataUnsafe?: {
    user?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
    start_param?: string;
  };
  expand?: () => void;
  enableClosingConfirmation?: () => void;
  openLink?: (url: string) => void;
  close?: () => void;
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (callback: () => void) => void;
  };
  MainButton?: {
    setText: (text: string) => void;
    show: () => void;
    hide: () => void;
    onClick: (callback: () => void) => void;
    offClick: (callback: () => void) => void;
  };
  colorScheme?: string;
  themeParams?: {
    bg_color?: string;
    text_color?: string;
    hint_color?: string;
    link_color?: string;
    button_color?: string;
    button_text_color?: string;
  };
  CloudStorage?: {
    setItem: (key: string, value: string, callback?: (error: Error | null, result?: boolean) => void) => void;
    getItem: (key: string, callback: (error: Error | null, result?: string) => void) => void;
    removeItem: (key: string, callback?: (error: Error | null, result?: boolean) => void) => void;
  };
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

interface User {
  id: string;
  firstName?: string;
  username?: string;
}

export function useTelegram() {
  const [tg, setTg] = useState<TelegramWebApp | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [initData, setInitData] = useState<string | null>(null);

  useEffect(() => {
    if (window.Telegram?.WebApp) {
      const webApp = window.Telegram.WebApp;
      setTg(webApp);

      try {
        webApp.expand?.();
        webApp.enableClosingConfirmation?.();
      } catch (e) {
        console.warn('Telegram WebApp API error:', e);
      }

      const rawInitData = webApp.initData;
      if (rawInitData) {
        setInitData(rawInitData);
        setTelegramInitData(rawInitData);
        const telegramUser = webApp.initDataUnsafe?.user;
        if (telegramUser) {
          const id = `tg_${telegramUser.id}`;
          setUser({ id, firstName: telegramUser.first_name, username: telegramUser.username });
          setCurrentUserId(id);
        }
      } else {
        const storageKey = 'ff_user_id';
        let devId = localStorage.getItem(storageKey);
        if (!devId) {
          devId = 'dev_' + Date.now();
          localStorage.setItem(storageKey, devId);
        }
        setUser({ id: devId, firstName: 'Developer', username: 'dev' });
        setCurrentUserId(devId);
      }
    } else {
      const storageKey = 'ff_user_id';
      let webId = localStorage.getItem(storageKey);
      if (!webId) {
        webId = 'web_' + Date.now();
        localStorage.setItem(storageKey, webId);
      }
      setUser({ id: webId, firstName: 'Web User', username: 'web' });
      setCurrentUserId(webId);
    }
  }, []);

  const openLink = useCallback((url: string) => {
    if (tg?.openLink) {
      tg.openLink(url);
    } else {
      window.open(url, '_blank');
    }
  }, [tg]);

  const goBack = useCallback(() => {
    if (tg?.BackButton) {
      window.history.back();
    }
  }, [tg]);

  const close = useCallback(() => {
    if (tg?.close) {
      tg.close();
    }
  }, [tg]);

  const getCloudData = useCallback((key: string): Promise<string | null> => {
    return new Promise((resolve) => {
      if (tg?.CloudStorage) {
        tg.CloudStorage.getItem(key, (error, result) => {
          if (error || !result) {
            resolve(null);
          } else {
            resolve(result);
          }
        });
      } else {
        resolve(localStorage.getItem(key));
      }
    });
  }, [tg]);

  const setCloudData = useCallback((key: string, value: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (tg?.CloudStorage) {
        tg.CloudStorage.setItem(key, value, (error) => {
          resolve(!error);
        });
      } else {
        localStorage.setItem(key, value);
        resolve(true);
      }
    });
  }, [tg]);

  return {
    tg,
    user,
    initData,
    openLink,
    goBack,
    close,
    getCloudData,
    setCloudData,
    colorScheme: tg?.colorScheme || 'light',
    themeParams: tg?.themeParams,
  };
}
