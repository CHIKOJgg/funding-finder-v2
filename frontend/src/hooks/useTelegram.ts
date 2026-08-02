import { useState, useEffect, useCallback, useRef } from 'react';
import { setTelegramInitData, setAuthToken, getAuthToken, clearAuthToken, apiClient, captureReferralCode, onAuthExpired } from '../api/client';
import type { TelegramWebApp } from '../types';

export interface WebUser {
  id: string;
  firstName?: string;
  username?: string;
  provider?: string;
  walletAddress?: string | null;
  email?: string | null;
  referralCode?: string;
}

export function useTelegram() {
  const [tg, setTg] = useState<TelegramWebApp | null>(null);
  const [user, setUser] = useState<WebUser | null>(null);
  const [initData, setInitData] = useState<string | null>(null);
  const [isWeb, setIsWeb] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authProvider, setAuthProvider] = useState<string | undefined>();

  const applyUser = useCallback((u: WebUser) => {
    setUser(u);
    setAuthProvider(u.provider);
    setAuthenticated(true);
  }, []);

  const login = useCallback((token: string, u: WebUser) => {
    setAuthToken(token);
    setTg(null);
    setIsWeb(true);
    applyUser(u);
  }, [applyUser]);

  const logout = useCallback(() => {
    clearAuthToken();
    setUser(null);
    setAuthProvider(undefined);
    setAuthenticated(false);
    setInitData(null);
  }, []);

  // A 401 from any API call means the stored session token is dead. Drop it
  // immediately and fall back to the login screen instead of silently
  // degrading every protected call to "free" until a full page reload.
  useEffect(() => {
    return onAuthExpired(() => {
      logout();
    });
  }, [logout]);

  // Ref to track whether we've already initialised Telegram (prevents duplicate
  // runs when the effect fires again after the SDK finishes loading).
  const tgReady = useRef(false);

  useEffect(() => {
    // Capture ?ref=CODE from URL before anything else
    captureReferralCode();

    if (tgReady.current) return;

    function setupTelegram(webApp: TelegramWebApp) {
      if (tgReady.current) return;
      tgReady.current = true;
      setTg(webApp);

      const expandNow = () => {
        try {
          webApp.expand?.();
          (webApp as any).requestViewport?.();
          (webApp as any).disableVerticalSwipes?.();
        } catch (e) {
          console.warn('Telegram WebApp API error:', e);
        }
      };

      try {
        // Signal to Telegram that we're ready, then expand to fill the
        // available viewport (critical on Telegram desktop, where mini-apps
        // otherwise open in a small side panel).
        webApp.ready?.();
        expandNow();
        webApp.enableClosingConfirmation?.();

        // Funding Finder is always dark/cobalt — paint the native surfaces to
        // match the canvas so nothing flashes light or shows system chrome.
        webApp.setBackgroundColor?.('#05070C');
        webApp.setHeaderColor?.('#05070C');

        // Native buttons get the brand color on load (per-screen text/state is
        // set where those buttons are used).
        webApp.MainButton?.setParams?.({ color: '#3D63FF', text_color: '#FFFFFF' });
        webApp.SecondaryButton?.setParams?.({ color: '#3D63FF', text_color: '#FFFFFF' });
      } catch (e) {
        console.warn('Telegram WebApp API error:', e);
      }

      // Mirror the platform safe-area insets into CSS vars so fixed UI (nav,
      // scan card, modals) clears the notch / home indicator. Sum of screen +
      // content insets, like Telegram docs recommend for mini apps.
      const applySafeArea = () => {
        try {
          const s = webApp.safeAreaInset || { top: 0, bottom: 0, left: 0, right: 0 };
          const c = webApp.contentSafeAreaInset || { top: 0, bottom: 0, left: 0, right: 0 };
          const style = document.documentElement.style;
          style.setProperty('--safe-top', `${s.top + c.top}px`);
          style.setProperty('--safe-bottom', `${s.bottom + c.bottom}px`);
          style.setProperty('--safe-left', `${s.left + c.left}px`);
          style.setProperty('--safe-right', `${s.right + c.right}px`);
        } catch (e) {
          console.warn('Telegram WebApp API error:', e);
        }
      };
      applySafeArea();
      webApp.onEvent?.('safeAreaChanged', applySafeArea);
      webApp.onEvent?.('contentSafeAreaChanged', applySafeArea);

      // Re-expand whenever the viewport changes (e.g. Telegram desktop
      // finishes laying out the window, or the user resizes it).
      const onViewport = () => expandNow();
      webApp.onEvent?.('viewportChanged', onViewport);

      const rawInitData = webApp.initData;
      if (rawInitData) {
        setInitData(rawInitData);
        setTelegramInitData(rawInitData);
        const telegramUser = webApp.initDataUnsafe?.user;
        if (telegramUser) {
          const id = `tg_${telegramUser.id}`;
          applyUser({ id, firstName: telegramUser.first_name, username: telegramUser.username, provider: 'telegram' });
        }
      }
    }

    const webApp = window.Telegram?.WebApp;
    const hasTelegramUrlSignals =
      window.location.hash.includes('tgWebAppData') ||
      new URLSearchParams(window.location.search).has('tgWebAppStartParam');

    if (webApp?.initData) {
      // Telegram Mini App (native) — WebApp is injected synchronously.
      setupTelegram(webApp);
    } else if (webApp) {
      // Telegram Mini App without initData (edge case on some clients).
      // Still mark as Telegram so the web login page never shows.
      setupTelegram(webApp);
    } else if (hasTelegramUrlSignals) {
      // On web.telegram.org the SDK may still be loading async. Wait for it
      // instead of falling through to the web auth path.
      const poll = setInterval(() => {
        const w = window.Telegram?.WebApp;
        if (w) {
          clearInterval(poll);
          clearTimeout(failSafe);
          setupTelegram(w);
        }
      }, 100);
      const failSafe = setTimeout(() => {
        clearInterval(poll);
        // SDK didn't load — still mark as non-web so we don't show the
        // website login page inside Telegram's browser.
        if (!tgReady.current) {
          tgReady.current = true;
          setIsWeb(false);
        }
      }, 8000);
    } else {
      // Public website mode — require a web session (wallet / Google).
      setIsWeb(true);
      const stored = getAuthToken();
      if (stored) {
        setAuthToken(stored);
        apiClient.getMe()
          .then((r: any) => {
            if (r?.ok && r.user) {
              applyUser(r.user);
            } else {
              logout();
            }
          })
          .catch(() => {
            // Keep the user on the login screen; their token was invalid.
            logout();
          });
      }
    }
  }, [applyUser, logout]);

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
    isWeb,
    authenticated,
    authProvider,
    login,
    logout,
    openLink,
    goBack,
    close,
    getCloudData,
    setCloudData,
    colorScheme: tg?.colorScheme || 'light',
    themeParams: tg?.themeParams,
  };
}
