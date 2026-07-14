import React, { useState, createContext, useContext, useMemo, useRef, useCallback, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Navigation } from './components/Navigation';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider, useToast } from './components/Toast';
import { Onboarding } from './components/Onboarding';
import { LoginPage } from './components/LoginPage';
import { WebHeader } from './components/WebHeader';
import { useTelegram } from './hooks/useTelegram';
import { useWebSocket } from './hooks/useWebSocket';
import { apiClient, getAuthToken } from './api/client';
import { ALL_EXCHANGES } from './utils/exchanges';
import { getPlanLimits, PlanLimits } from './utils/plans';
import { LanguageProvider } from './i18n';
import { useT } from './i18n';
import type { ScanResult, TrialStatus, WatchlistItem } from './types';

const MainPage = React.lazy(() => import('./pages/MainPage').then(m => ({ default: m.MainPage })));
const ArbitragePage = React.lazy(() => import('./pages/ArbitragePage').then(m => ({ default: m.ArbitragePage })));
const ProfilePage = React.lazy(() => import('./pages/ProfilePage').then(m => ({ default: m.ProfilePage })));
const TermsPage = React.lazy(() => import('./pages/TermsPage').then(m => ({ default: m.TermsPage })));
const PrivacyPage = React.lazy(() => import('./pages/PrivacyPage').then(m => ({ default: m.PrivacyPage })));
const AdminPage = React.lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));
const SettingsPage = React.lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const PortfolioPage = React.lazy(() => import('./pages/PortfolioPage').then(m => ({ default: m.PortfolioPage })));

interface AppContextType {
  user: { id: string; firstName?: string; username?: string; subscription?: string } | null;

  // ---- Subscription / plan ----
  subscription: string;
  planLimits: PlanLimits;

  // ---- Scan (Main page) ----
  scanResults: ScanResult | null;
  setScanResults: (results: ScanResult | null) => void;
  scanLoading: boolean;
  scanStatus: string;
  runScan: (exchanges: string[]) => Promise<void>;

  selectedExchanges: string[];
  setSelectedExchanges: React.Dispatch<React.SetStateAction<string[]>>;

  // ---- Trial ----
  trialStatus: TrialStatus | null;
  refreshTrial: () => Promise<void>;
  activateTrial: () => Promise<void>;

  // ---- Watchlist ----
  watchlist: WatchlistItem[];
  isWatchlisted: (exchange: string, pair: string) => boolean;
  toggleWatchlist: (exchange: string, pair: string) => Promise<void>;
  refreshWatchlist: () => Promise<void>;

  // ---- Arbitrage ----
  arbOpportunities: any[];
  arbAlerts: any[];
  setArbAlerts: React.Dispatch<React.SetStateAction<any[]>>;
  arbLoading: boolean;
  arbLoaded: boolean;
  loadArbitrage: (force?: boolean) => Promise<void>;
  loadAlerts: (force?: boolean) => Promise<void>;
  // Latest live opportunities pushed over WebSocket (server warm-up broadcast).
  liveFundingAt: number | null;
  applyLiveFunding: (data: { generatedAt?: number }) => void;

  // ---- Web (website) session ----
  isWeb: boolean;
  authProvider?: string;
  logout: () => void;
  refreshSubscription: () => Promise<void>;
}

export const AppContext = createContext<AppContextType>({
  user: null,
  subscription: 'free',
  planLimits: getPlanLimits('free'),
  scanResults: null,
  setScanResults: () => {},
  scanLoading: false,
  scanStatus: 'Готов к сканированию',
  runScan: async () => {},
  selectedExchanges: [],
  setSelectedExchanges: () => {},
  arbOpportunities: [],
  arbAlerts: [],
  setArbAlerts: () => {},
  arbLoading: false,
  arbLoaded: false,
  loadArbitrage: async () => {},
  loadAlerts: async () => {},
  liveFundingAt: null,
  applyLiveFunding: () => {},
  trialStatus: null,
  refreshTrial: async () => {},
  activateTrial: async () => {},
  watchlist: [],
  isWatchlisted: () => false,
  toggleWatchlist: async () => {},
  refreshWatchlist: async () => {},
  isWeb: false,
  authProvider: undefined,
  logout: () => {},
  refreshSubscription: async () => {},
});

export function useApp() {
  return useContext(AppContext);
}

/**
 * Decide if a hex color is "dark" by relative luminance.
 * Used to pick light/dark palette when Telegram only gives raw colors.
 */
function isColorDark(hex: string): boolean {
  const m = hex.replace('#', '');
  if (m.length < 6) return false;
  const r = parseInt(m.substring(0, 2), 16);
  const g = parseInt(m.substring(2, 4), 16);
  const b = parseInt(m.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5;
}

/**
 * Owns all shared, cross-tab state and the async actions that fill it.
 * Rendered ABOVE the router so it never unmounts when switching tabs — this is
 * what keeps data cached and lets an in-progress scan continue in the
 * background instead of restarting.
 */
function DataProvider() {
  const { user, initData, isWeb, authenticated, authProvider, logout, login } = useTelegram();
  const { showToast } = useToast();
  const t = useT();

  const [showOnboarding, setShowOnboarding] = useState(() => {
    return localStorage.getItem('ff_onboarding_done') !== 'true';
  });
  const completeOnboarding = useCallback(() => {
    localStorage.setItem('ff_onboarding_done', 'true');
    setShowOnboarding(false);
  }, []);

  // Subscription state
  const [subscription, setSubscription] = useState<string>('free');
  const planLimits = useMemo<PlanLimits>(() => getPlanLimits(subscription), [subscription]);

  // Load the user's current plan once so premium gating works on the client
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    apiClient.getProfile()
      .then((r: any) => {
        if (cancelled) return;
        const sub = r?.user?.subscription || r?.subscription;
        if (sub) setSubscription(sub);
      })
      .catch(() => { /* plan stays 'free' on failure */ });
    return () => { cancelled = true; };
  }, [user?.id]);
  const [scanResults, setScanResults] = useState<ScanResult | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanStatus, setScanStatus] = useState(() => t('app.ready'));
  const [selectedExchanges, setSelectedExchanges] = useState<string[]>(ALL_EXCHANGES);

  // The default selection is "all exchanges", but a plan may cap how many the
  // user can actually scan (e.g. Free = 3). Trim the initial selection to the
  // plan limit so the counter reads e.g. "3/3" instead of a confusing "23/3".
  useEffect(() => {
    const max = planLimits.maxExchanges;
    setSelectedExchanges((prev) => (prev.length > max ? prev.slice(0, max) : prev));
  }, [planLimits.maxExchanges]);

  // Trial state
  const [trialStatus, setTrialStatus] = useState<TrialStatus | null>(null);

  const refreshTrial = useCallback(async () => {
    try {
      const res: any = await apiClient.getTrialStatus();
      if (res?.ok) setTrialStatus(res as TrialStatus);
    } catch { /* ignore — trial status is non-critical */ }
  }, []);

  const activateTrial = useCallback(async () => {
    try {
      const res: any = await apiClient.activateTrial();
      if (res?.ok) {
        setTrialStatus({ active: true, used: true, endsAt: res.endsAt, daysLeft: res.daysLeft, hoursLeft: res.hoursLeft });
        setSubscription('pro');
      } else if (res?.error) {
        showToast(res.error, 'error');
      }
    } catch (error) {
      showToast(t('networkError', { message: (error as Error).message }), 'error');
    }
  }, [showToast, t]);

  // Watchlist state
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);

  const refreshWatchlist = useCallback(async () => {
    try {
      const res: any = await apiClient.getWatchlist();
      if (res?.ok) setWatchlist(res.items || []);
    } catch { /* ignore */ }
  }, []);

  const isWatchlisted = useCallback((exchange: string, pair: string) => {
    return watchlist.some((w) => w.exchange === exchange && w.pair === pair);
  }, [watchlist]);

  const toggleWatchlist = useCallback(async (exchange: string, pair: string) => {
    const exists = watchlist.some((w) => w.exchange === exchange && w.pair === pair);
    try {
      if (exists) {
        await apiClient.removeWatchlist(exchange, pair);
        setWatchlist((prev) => prev.filter((w) => !(w.exchange === exchange && w.pair === pair)));
      } else {
        const res: any = await apiClient.addWatchlist(exchange, pair);
        if (res?.ok) {
          setWatchlist((prev) => [...prev, res.item]);
        } else if (res?.error) {
          showToast(res.error, 'error');
        }
      }
    } catch (error) {
      showToast(t('app.networkError', { error: (error as Error).message }), 'error');
    }
  }, [showToast, t]);

  // Load trial + watchlist once the user is known
  useEffect(() => {
    if (!user?.id) return;
    refreshTrial();
    refreshWatchlist();
  }, [user?.id, refreshTrial, refreshWatchlist]);

  // Arbitrage state
  const [arbOpportunities, setArbOpportunities] = useState<any[]>([]);
  const [arbAlerts, setArbAlerts] = useState<any[]>([]);
  const [arbLoading, setArbLoading] = useState(false);
  const [arbLoaded, setArbLoaded] = useState(false);
  const [alertsLoaded, setAlertsLoaded] = useState(false);

  // In-flight promises (dedupe so switching tabs never restarts a request)
  const scanInFlight = useRef<Promise<void> | null>(null);
  const arbInFlight = useRef<Promise<void> | null>(null);
  const alertsInFlight = useRef<Promise<void> | null>(null);

  const runScan = useCallback((exchanges: string[]) => {
    if (scanInFlight.current) return scanInFlight.current;
    setScanLoading(true);
    setScanStatus(t('app.scanning'));
    const p = (async () => {
      try {
        const response: any = await apiClient.scan(exchanges);
        if (response.ok) {
          setScanResults(response.result);
          setScanStatus(t('app.found', { count: response.result.scanned }));
          showToast(t('app.scanDone'), 'success');
        } else {
          setScanStatus(t('app.scanError', { error: response.error }));
          showToast(t('app.scanFailed'), 'error');
        }
      } catch (error) {
        setScanStatus(t('app.networkError', { error: (error as Error).message }));
        showToast(t('app.scanNetworkError'), 'error');
      } finally {
        setScanLoading(false);
        scanInFlight.current = null;
      }
    })();
    scanInFlight.current = p;
    return p;
  }, [showToast, t]);

  const loadArbitrage = useCallback((force = false) => {
    if (arbInFlight.current) return arbInFlight.current;
    if (!force && arbLoaded) return Promise.resolve();
    setArbLoading(true);
    const p = (async () => {
      try {
        const response: any = await apiClient.getArbitrageOpportunities();
        if (response.ok) {
          setArbOpportunities(response.opportunities || []);
          setArbLoaded(true);
        } else {
          showToast(t('app.loadOppError') + ': ' + (response.error || ''), 'error');
        }
    } catch (error) {
      showToast(t('app.loadOppError'), 'error');
    } finally {
        setArbLoading(false);
        arbInFlight.current = null;
      }
    })();
    arbInFlight.current = p;
    return p;
  }, [arbLoaded, showToast, t]);

  const loadAlerts = useCallback((force = false) => {
    if (alertsInFlight.current) return alertsInFlight.current;
    if (!force && alertsLoaded) return Promise.resolve();
    const p = (async () => {
      try {
        const response: any = await apiClient.getArbitrageAlerts();
        if (response.ok) {
          setArbAlerts(response.alerts || []);
          setAlertsLoaded(true);
        }
      } catch {
        /* ignore — alerts are non-critical */
      } finally {
        alertsInFlight.current = null;
      }
    })();
    alertsInFlight.current = p;
    return p;
  }, [alertsLoaded]);

  // Refresh the active subscription after a successful payment / trial.
  const refreshSubscription = useCallback(async () => {
    try {
      const res: any = await apiClient.getProfile();
      const sub = res?.user?.subscription || res?.subscription;
      if (sub) setSubscription(sub);
    } catch {
      /* ignore */
    }
  }, []);

  // Realtime "new spread" push: surface fresh arbitrage opportunities as a
  // toast no matter which tab the user is on, and refresh the arbitrage list
  // so the opportunity is already there when they open that tab.
  const handleNewSpread = useCallback((data: any) => {
    if (!data) return;
    const diffPct = ((data.difference || 0) * 100).toFixed(2);
    showToast(
      t('app.newSpread', { pair: data.pair, a: data.exchangeA, b: data.exchangeB, diff: diffPct }),
      'spread'
    );
    if (user?.id) loadArbitrage(true);
  }, [showToast, user?.id, loadArbitrage]);

  // Live funding broadcast: the server sends a freshness ping on every warm-up
  // cycle (~5 min). We only record the timestamp — the arbitrage list is kept
  // fresh by its own polling, so we never clobber the user's filtered view.
  const [liveFundingAt, setLiveFundingAt] = useState<number | null>(null);
  const applyLiveFunding = useCallback((data: { generatedAt?: number }) => {
    setLiveFundingAt(data?.generatedAt || Date.now());
  }, []);

  // For the website we authenticate the WebSocket with the JWT; for the
  // Telegram mini-app we pass the init data.
  const wsAuth = useMemo(() => isWeb
    ? { token: getAuthToken() }
    : { initData }, [isWeb, initData]);
  useWebSocket(wsAuth, {
    onNewSpread: handleNewSpread,
    onLiveFunding: applyLiveFunding,
    onAlertTriggered: useCallback(() => {
      loadAlerts(true);
    }, [loadAlerts]),
  });

  const contextValue = useMemo<AppContextType>(() => ({
    user,
    subscription,
    planLimits,
    scanResults,
    setScanResults,
    scanLoading,
    scanStatus,
    runScan,
    selectedExchanges,
    setSelectedExchanges,
    arbOpportunities,
    arbAlerts,
    setArbAlerts,
    arbLoading,
    arbLoaded,
    loadArbitrage,
    loadAlerts,
    liveFundingAt,
    applyLiveFunding,
    trialStatus,
    refreshTrial,
    activateTrial,
    watchlist,
    isWatchlisted,
    toggleWatchlist,
    refreshWatchlist,
    isWeb,
    authProvider,
    logout,
    refreshSubscription,
  }), [
    user, subscription, planLimits, scanResults, scanLoading, scanStatus, runScan,
    selectedExchanges, arbOpportunities, arbAlerts, arbLoading, arbLoaded,
    loadArbitrage, loadAlerts, trialStatus, refreshTrial, activateTrial,
    watchlist, isWatchlisted, toggleWatchlist, refreshWatchlist,
    isWeb, authProvider, logout, refreshSubscription, liveFundingAt, applyLiveFunding,
  ]);

  return (
    <AppContext.Provider value={contextValue}>
      {isWeb && !authenticated ? (
        <LoginPage onAuthenticated={login} />
      ) : (
        <>
          {isWeb && <WebHeader user={user} onLogout={logout} />}
          <div className={isWeb ? 'web-shell' : ''}>
            <BrowserRouter>
              <div className="min-h-screen pb-20">
                <Suspense fallback={<PageLoader />}>
                  <Routes>
                    <Route path="/" element={<ErrorBoundary><MainPage /></ErrorBoundary>} />
                    <Route path="/arbitrage" element={<ErrorBoundary><ArbitragePage /></ErrorBoundary>} />
                    <Route path="/profile" element={<ErrorBoundary><ProfilePage /></ErrorBoundary>} />
                    <Route path="/terms" element={<ErrorBoundary><TermsPage /></ErrorBoundary>} />
                    <Route path="/privacy" element={<ErrorBoundary><PrivacyPage /></ErrorBoundary>} />
                    <Route path="/admin" element={<ErrorBoundary><AdminPage /></ErrorBoundary>} />
                    <Route path="/settings" element={<ErrorBoundary><SettingsPage /></ErrorBoundary>} />
                    <Route path="/portfolio" element={<ErrorBoundary><PortfolioPage /></ErrorBoundary>} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </Suspense>
                <Navigation />
              </div>
            </BrowserRouter>
          </div>
          {showOnboarding && <Onboarding onComplete={completeOnboarding} />}
        </>
      )}
    </AppContext.Provider>
  );
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
    </div>
  );
}

export default function App() {
  // Theme: pull native Telegram theme params (guarantees correct contrast)
  // and toggle the `dark` class based on the active color scheme.
  useEffect(() => {
    const root = document.documentElement;
    const tg = (window as any).Telegram?.WebApp;

    const applyTheme = (colorScheme?: string, themeParams?: Record<string, string>) => {
      const tp = themeParams || tg?.themeParams || {};
      const set = (name: string, value?: string) => {
        if (value) root.style.setProperty(name, value);
      };

      set('--tg-bg', tp.bg_color);
      set('--tg-text', tp.text_color);
      set('--tg-hint', tp.hint_color);
      set('--tg-link', tp.link_color);
      set('--tg-button', tp.button_color);
      set('--tg-button-text', tp.button_text_color);
      set('--tg-secondary-bg', tp.secondary_bg_color);

      if (tp.bg_color || tp.text_color || tp.button_color) {
        root.classList.add('has-tg-theme');
      }

      const isDark =
        colorScheme === 'dark' ||
        (tp.bg_color && isColorDark(tp.bg_color));
      root.classList.toggle('dark', Boolean(isDark));
    };

    if (tg) {
      applyTheme(tg.colorScheme, tg.themeParams);
      const handler = () => applyTheme(tg.colorScheme, tg.themeParams);
      tg.onEvent('themeChanged', handler);
      return () => tg.offEvent('themeChanged', handler);
    }

    // Fallback: follow system preference
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    applyTheme(mq.matches ? 'dark' : 'light');
    const handler = (e: MediaQueryListEvent) => applyTheme(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return (
    <ErrorBoundary>
      <ToastProvider>
        <LanguageProvider>
          <DataProvider />
        </LanguageProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}

