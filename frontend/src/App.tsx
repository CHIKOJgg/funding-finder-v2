import React, { useState, createContext, useContext, useMemo, useRef, useCallback, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Navigation } from './components/Navigation';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider, useToast } from './components/Toast';
import { Onboarding } from './components/Onboarding';
import { LoginPage } from './components/LoginPage';
import { WebHeader } from './components/WebHeader';
import { useTelegram } from './hooks/useTelegram';
import { useIsWide } from './hooks/useIsWide';
import { useWebSocket } from './hooks/useWebSocket';
import { apiClient, getAuthToken, API_BASE } from './api/client';
import { ALL_EXCHANGES } from './utils/exchanges';
import { getPlanLimits, PlanLimits } from './utils/plans';
import { LanguageProvider } from './i18n';
import { useT } from './i18n';
import type { ScanResult, TrialStatus, WatchlistItem } from './types';
import { DebugLog, DebugToggle } from './components/DebugLog';
import { SupportButton } from './components/SupportModal';
import { logger as clientLogger } from './utils/logger';
import { track } from './utils/analytics';

import { MainPage } from './pages/MainPage';
import { ArbitragePage } from './pages/ArbitragePage';
import { ProfilePage } from './pages/ProfilePage';
import { PortfolioPage } from './pages/PortfolioPage';
import { SettingsPage } from './pages/SettingsPage';

const TermsPage = React.lazy(() => import('./pages/TermsPage').then(m => ({ default: m.TermsPage })));
const PrivacyPage = React.lazy(() => import('./pages/PrivacyPage').then(m => ({ default: m.PrivacyPage })));
const AdminPage = React.lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));
const QrScanPage = React.lazy(() => import('./pages/QrScanPage').then(m => ({ default: m.QrScanPage })));
const PublicPage = React.lazy(() => import('./pages/PublicPage').then(m => ({ default: m.PublicPage })));

// Backoff schedule for silent re-polls of a cold-start (degraded/empty)
// arbitrage response — long enough for the backend warm-up scan to finish,
// short enough that the "no opportunities" screen never looks dead.
const ARB_RETRY_DELAYS = [5000, 10000, 20000, 40000];

interface AppContextType {
  user: { id: string; firstName?: string; username?: string; subscription?: string; referralCode?: string; provider?: string; authProvider?: string; email?: string | null; walletAddress?: string | null } | null;

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
  activateTrial: () => Promise<boolean>;

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
  arbError: string | null;
  loadArbitrage: (force?: boolean, opts?: { silent?: boolean }) => Promise<void>;
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
  scanStatus: '',
  runScan: async () => {},
  selectedExchanges: [],
  setSelectedExchanges: () => {},
  arbOpportunities: [],
  arbAlerts: [],
  setArbAlerts: () => {},
  arbLoading: false,
  arbLoaded: false,
  arbError: null,
  loadArbitrage: async () => {},
  loadAlerts: async () => {},
  liveFundingAt: null,
  applyLiveFunding: () => {},
  trialStatus: null,
  refreshTrial: async () => {},
  activateTrial: async () => false,
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
 * Owns all shared, cross-tab state and the async actions that fill it.
 * Rendered ABOVE the router so it never unmounts when switching tabs — this is
 * what keeps data cached and lets an in-progress scan continue in the
 * background instead of restarting.
 */
function DataProvider() {
  const { user, initData, isWeb, authenticated, authProvider, logout, login } = useTelegram();
  const isWide = useIsWide();
  const { showToast } = useToast();
  const t = useT();

  const [showOnboarding, setShowOnboarding] = useState(() => {
    return localStorage.getItem('ff_onboarding_done') !== 'true';
  });
  const completeOnboarding = useCallback(() => {
    localStorage.setItem('ff_onboarding_done', 'true');
    setShowOnboarding(false);
  }, []);

  // Mirror the user id into the client logger so server-correlated logs can be
  // tied back to a specific Telegram user (vital when we can't open F12).
  useEffect(() => {
    clientLogger.setUser(user?.id ?? null);
  }, [user?.id]);

  // Track "app_open" once on mount — the activation pivot between the anonymous
  // landing funnel and the authenticated in-app funnel. Runs once per SPA load.
  useEffect(() => {
    track('app_open', undefined, user?.id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep-alive ping: hit /api/public/ping every 10 min so the Render free-tier
  // API stays awake. Fire-and-forget, never blocks the UI.
  useEffect(() => {
    const ping = () => fetch(`${API_BASE}/api/public/ping`, { keepalive: true }).catch(() => {});
    ping();
    const id = setInterval(ping, 10 * 60 * 1000);
    return () => clearInterval(id);
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
        if (sub) {
          setSubscription(sub);
          // Pro+ users get faster live data refresh (2s vs 4s).
          apiClient.setProPlusRefresh(sub === 'proplus');
        }
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
        track('trial_start', undefined, user?.id);
        return true;
      } else if (res?.error) {
        showToast(res.error, 'error');
      }
    } catch (error) {
      showToast(t('app.networkError', { error: (error as Error).message }), 'error');
    }
    return false;
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

  // Trial/plan expiry re-gate: the SERVER downgrades the plan when the trial
  // ends, but the client would keep showing Pro limits (and hiding the
  // paywall) until a full reload. Re-sync subscription + trial on tab focus so
  // the monetization funnel reactivates without a refresh.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const sync = () => {
      apiClient.getProfile()
        .then((r: any) => {
          if (cancelled) return;
          const sub = r?.user?.subscription || r?.subscription;
          if (sub) setSubscription(sub);
        })
        .catch(() => {});
      refreshTrial();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [user?.id, refreshTrial]);

  // Arbitrage state
  const [arbOpportunities, setArbOpportunities] = useState<any[]>([]);
  const [arbAlerts, setArbAlerts] = useState<any[]>([]);
  const [arbLoading, setArbLoading] = useState(false);
  const [arbLoaded, setArbLoaded] = useState(false);
  const [arbError, setArbError] = useState<string | null>(null);
  const [alertsLoaded, setAlertsLoaded] = useState(false);

  // Never carry entitlement or user-scoped data into another session. A
  // failed profile request must not leave the previous user's Pro state active.
  useEffect(() => {
    setSubscription('free');
    setTrialStatus(null);
    setWatchlist([]);
    setScanResults(null);
    setArbOpportunities([]);
    setArbAlerts([]);
    setArbLoaded(false);
    setAlertsLoaded(false);
  }, [user?.id]);

  // In-flight promises (dedupe so switching tabs never restarts a request)
  const scanInFlight = useRef<Promise<void> | null>(null);
  const arbInFlight = useRef<Promise<void> | null>(null);
  const alertsInFlight = useRef<Promise<void> | null>(null);
  // How many silent retries a cold-start (degraded/empty) arbitrage response
  // has consumed; reset as soon as real data lands. 5s → 10s → 20s → 40s.
  const arbDegradedRetries = useRef(0);

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
          track('scan_run', { exchanges: exchanges.length }, user?.id);
        } else {
          const isRate = /too many requests/i.test(String(response.error || ''));
          setScanStatus(isRate ? t('app.rateLimited') : t('app.scanError', { error: response.error }));
          showToast(isRate ? t('app.rateLimited') : t('app.scanFailed'), 'error');
        }
      } catch (error) {
        const isRate =
          (error as any).rateLimited || /too many requests/i.test((error as Error).message);
        setScanStatus(isRate ? t('app.rateLimited') : t('app.networkError', { error: (error as Error).message }));
        showToast(isRate ? t('app.rateLimited') : t('app.scanNetworkError'), 'error');
      } finally {
        setScanLoading(false);
        scanInFlight.current = null;
      }
    })();
    scanInFlight.current = p;
    return p;
  }, [showToast, t]);

  const loadArbitrage = useCallback((force = false, opts?: { silent?: boolean }) => {
    if (arbInFlight.current) return arbInFlight.current;
    if (!force && arbLoaded) return Promise.resolve();
    setArbLoading(true);
    const p = (async () => {
      let willRetry = false;
      try {
        // Request only the user's selected (plan-capped) exchanges. The backend
        // serves the warm full-set cache via superset matching, so we still get
        // every opportunity — but we never trigger a cold 25-exchange live scan.
        const exchanges = selectedExchanges.slice(0, planLimits.maxExchanges);
        const response: any = await apiClient.getArbitrageOpportunities(exchanges);
        if (response.ok) {
          const opportunities = response.opportunities || [];
          // A degraded response right after a cold backend start means the
          // warm-up scan hasn't finished yet. Treat it as "not loaded" and
          // quietly retry with backoff instead of showing a dead "no
          // opportunities" screen until the user manually refreshes. A plain
          // empty list (no `degraded` flag) is an honest "no arbitrage right
          // now" — show it immediately.
          if (!arbLoaded && opportunities.length === 0 && response.degraded === true) {
            const depth = arbDegradedRetries.current;
            if (depth < ARB_RETRY_DELAYS.length) {
              arbDegradedRetries.current = depth + 1;
              willRetry = true;
              setTimeout(() => {
                // Silent backfill: even with the tab hidden the retry chain
                // must complete, otherwise a cold start leaves an empty screen.
                loadArbitrage(true, { silent: true }).then(() => {});
              }, ARB_RETRY_DELAYS[depth]);
              return;
            }
            // Retry budget exhausted — fall through and show the empty state
            // (which now carries its own refresh button).
          }
          arbDegradedRetries.current = 0;
          setArbOpportunities(opportunities);
          setArbLoaded(true);
          setArbError(null);
        } else if (!opts?.silent) {
          setArbError(String(response.error || 'Unknown error'));
          showToast(t('app.loadOppError') + ': ' + (response.error || ''), 'error');
        }
      } catch (error) {
        setArbError((error as Error).message || 'Network error');
        // Background/auto refreshes fail silently: keep the last good data on
        // screen instead of spamming "can't load opportunities" every poll.
        if (!opts?.silent) showToast(t('app.loadOppError'), 'error');
      } finally {
        // While a backfill retry is scheduled keep the loading skeleton on
        // screen instead of flashing the empty state between attempts.
        if (!willRetry) setArbLoading(false);
        arbInFlight.current = null;
      }
    })();
    arbInFlight.current = p;
    return p;
  }, [arbLoaded, showToast, t, selectedExchanges, planLimits.maxExchanges]);

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
    if (user?.id) loadArbitrage(true, { silent: true });
  }, [showToast, user?.id, loadArbitrage, t]);

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
  const handleAlertTriggered = useCallback(() => {
    loadAlerts(true);
  }, [loadAlerts]);
  useWebSocket(wsAuth, {
    onNewSpread: handleNewSpread,
    onLiveFunding: applyLiveFunding,
    onAlertTriggered: handleAlertTriggered,
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
    arbError,
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
    selectedExchanges, arbOpportunities, arbAlerts, arbLoading, arbLoaded, arbError,
    loadArbitrage, loadAlerts, trialStatus, refreshTrial, activateTrial,
    watchlist, isWatchlisted, toggleWatchlist, refreshWatchlist,
    isWeb, authProvider, logout, refreshSubscription, liveFundingAt, applyLiveFunding,
  ]);

  return (
    <AppContext.Provider value={contextValue}>
      <HashRouteBridge />
      {isWeb && !authenticated ? (
        <PageLoader />
      ) : (
        <>
          {isWeb && <WebHeader user={user} onLogout={logout} onLogin={login} />}
          <div className={isWide ? 'web-shell' : ''}>
            <BrowserRouter>
              <div className="web-layout">
                <Navigation />
                <main className="web-content">
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
                      <Route path="/qr-scan" element={<ErrorBoundary><QrScanPage /></ErrorBoundary>} />
                      <Route path="/public" element={<ErrorBoundary><PublicPage /></ErrorBoundary>} />
                      <Route path="/login" element={<LoginPage onAuthenticated={login} />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </Suspense>
                </main>
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
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--cobalt)]"></div>
    </div>
  );
}

// Static hosts (Render Static Site etc.) can't always be configured with an SPA
// fallback, so deep links are sometimes written as /index.html#/privacy (hash
// fragment). This bridge migrates a `#/path` fragment into the real URL before
// React Router mounts, making hash-based deep links work on any host.
function HashRouteBridge() {
  useEffect(() => {
    try {
      const hash = window.location.hash;
      if (hash.startsWith('#/')) {
        window.history.replaceState(null, '', hash.slice(1));
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    } catch {
      /* history API always available in modern browsers */
    }
  }, []);
  return null;
}

export default function App() {
  // Debug overlay (replacement for F12 in the mini app). Open with `?debug=1`
  // in the URL, or via the floating bug button (shown only to the developer).
  const [debugOpen, setDebugOpen] = useState(false);
  const { user: tgUser } = useTelegram();
  const DEBUG_USER_ID = import.meta.env.VITE_DEBUG_TELEGRAM_ID as string | undefined;
  const isDebugUser = Boolean(DEBUG_USER_ID) && tgUser?.id === DEBUG_USER_ID;

  // `?debug=1` auto-opens the log overlay ONLY in dev builds or for the
  // configured debug user — never for anonymous production visitors (the log
  // buffer contains request URLs and error details).
  useEffect(() => {
    const wantsDebug =
      typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';
    if (wantsDebug && (import.meta.env.DEV || isDebugUser)) {
      setDebugOpen(true);
    }
  }, [isDebugUser]);

  // Funding Finder is deliberately theme-independent: always dark/cobalt,
  // regardless of Telegram or system theme. No theme-following effect.

  return (
    <ErrorBoundary>
      <ToastProvider>
        <LanguageProvider>
          <DataProvider />
          <SupportButton />
        </LanguageProvider>
      </ToastProvider>
      {isDebugUser && <DebugToggle onOpen={() => setDebugOpen(true)} />}
      <DebugLog open={debugOpen} onClose={() => setDebugOpen(false)} />
    </ErrorBoundary>
  );
}

