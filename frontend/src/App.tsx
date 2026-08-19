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

const MainPage = React.lazy(() => import('./pages/MainPage').then(m => ({ default: m.MainPage })));
const ArbitragePage = React.lazy(() => import('./pages/ArbitragePage').then(m => ({ default: m.ArbitragePage })));
const ProfilePage = React.lazy(() => import('./pages/ProfilePage').then(m => ({ default: m.ProfilePage })));
const TermsPage = React.lazy(() => import('./pages/TermsPage').then(m => ({ default: m.TermsPage })));
const PrivacyPage = React.lazy(() => import('./pages/PrivacyPage').then(m => ({ default: m.PrivacyPage })));
const AdminPage = React.lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));
const SettingsPage = React.lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const PortfolioPage = React.lazy(() => import('./pages/PortfolioPage').then(m => ({ default: m.PortfolioPage })));
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
    document.addEventListener('visibilitychange', onVisible);\n    window.addEventListener('focus', onVisible);\n    return () => {\n      cancelled = true;\n      document.removeEventListener('visibilitychange', onVisible);\n      window.removeEventListener('focus', onVisible);\n    };\n  }, [user?.id, refreshTrial]);\n\n  // Arbitrage state\n  const [arbOpportunities, setArbOpportunities] = useState<any[]>([]);\n  const [arbAlerts, setArbAlerts] = useState<any[]>([]);\n  const [arbLoading, setArbLoading] = useState(false);\n  const [arbLoaded, setArbLoaded] = useState(false);\n  const [arbError, setArbError] = useState<string | null>(null);\n  const [alertsLoaded, setAlertsLoaded] = useState(false);\n\n  // Never carry entitlement or user-scoped data into another session. A\n  // failed profile request must not leave the previous user's Pro state active.\n  useEffect(() => {\n    setSubscription('free');\n    setTrialStatus(null);\n    setWatchlist([]);\n    setScanResults(null);\n    setArbOpportunities([]);\n    setArbAlerts([]);\n    setArbLoaded(false);\n    setAlertsLoaded(false);\n  }, [user?.id]);\n\n  // In-flight promises (dedupe so switching tabs never restarts a request)\n  const scanInFlight = useRef<Promise<void> | null>(null);\n  const arbInFlight = useRef<Promise<void> | null>(null);\n  const alertsInFlight = useRef<Promise<void> | null>(null);\n  // How many silent retries a cold-start (degraded/empty) arbitrage response\n  // has consumed; reset as soon as real data lands. 5s → 10s → 20s → 40s.\n  const arbDegradedRetries = useRef(0);\n\n  const runScan = useCallback((exchanges: string[]) => {\n    if (scanInFlight.current) return scanInFlight.current;\n    setScanLoading(true);\n    setScanStatus(t('app.scanning'));\n    const p = (async () => {\n      try {\n        const response: any = await apiClient.scan(exchanges);\n        if (response.ok) {\n          setScanResults(response.result);\n          setScanStatus(t('app.found', { count: response.result.scanned }));\n          showToast(t('app.scanDone'), 'success');\n          track('scan_run', { exchanges: exchanges.length }, user?.id);\n        } else {\n          const isRate = /too many requests/i.test(String(response.error || ''));\n          setScanStatus(isRate ? t('app.rateLimited') : t('app.scanError', { error: response.error }));\n          showToast(isRate ? t('app.rateLimited') : t('app.scanFailed'), 'error');\n        }\n      } catch (error) {\n        const isRate =\n          (error as any).rateLimited || /too many requests/i.test((error as Error).message);\n        setScanStatus(isRate ? t('app.rateLimited') : t('app.networkError', { error: (error as Error).message }));\n        showToast(isRate ? t('app.rateLimited') : t('app.scanNetworkError'), 'error');\n      } finally {\n        setScanLoading(false);\n        scanInFlight.current = null;\n      }\n    })();\n    scanInFlight.current = p;\n    return p;\n  }, [showToast, t]);\n\n  const loadArbitrage = useCallback((force = false, opts?: { silent?: boolean }) => {\n    if (arbInFlight.current) return arbInFlight.current;\n    if (!force && arbLoaded) return Promise.resolve();\n    setArbLoading(true);\n    const p = (async () => {\n      let willRetry = false;\n      try {\n        // Request only the user's selected (plan-capped) exchanges. The backend\n        // serves the warm full-set cache via superset matching, so we still get\n        // every opportunity — but we never trigger a cold 25-exchange live scan.\n        const exchanges = selectedExchanges.slice(0, planLimits.maxExchanges);\n        const response: any = await apiClient.getArbitrageOpportunities(exchanges);\n        if (response.ok) {\n          const opportunities = response.opportunities || [];\n          // A degraded response right after a cold backend start means the\n          // warm-up scan hasn't finished yet. Treat it as \"not loaded\" and\n          // quietly retry with backoff instead of showing a dead \"no\n          // opportunities\" screen until the user manually refreshes. A plain\n          // empty list (no `degraded` flag) is an honest \"no arbitrage right\n          // now\" — show it immediately.\n          if (!arbLoaded && opportunities.length === 0 && response.degraded === true) {\n            const depth = arbDegradedRetries.current;\n            if (depth < ARB_RETRY_DELAYS.length) {\n              arbDegradedRetries.current = depth + 1;\n              willRetry = true;\n              setTimeout(() => {\n                // Silent backfill: even with the tab hidden the retry chain\n                // must complete, otherwise a cold start leaves an empty screen.\n                loadArbitrage(true, { silent: true }).then(() => {});\n              }, ARB_RETRY_DELAYS[depth]);\n              return;\n            }\n            // Retry budget exhausted — fall through and show the empty state\n            // (which now carries its own refresh button).\n          }\n          arbDegradedRetries.current = 0;\n          setArbOpportunities(opportunities);\n          setArbLoaded(true);\n          setArbError(null);\n        } else if (!opts?.silent) {\n          setArbError(String(response.error || 'Unknown error'));\n          showToast(t('app.loadOppError') + ': ' + (response.error || ''), 'error');\n        }\n      } catch (error) {\n        setArbError((error as Error).message || 'Network error');\n        // Background/auto refreshes fail silently: keep the last good data on\n        // screen instead of spamming \"can't load opportunities\" every poll.\n        if (!opts?.silent) showToast(t('app.loadOppError'), 'error');\n      } finally {\n        // While a backfill retry is scheduled keep the loading skeleton on\n        // screen instead of flashing the empty state between attempts.\n        if (!willRetry) setArbLoading(false);\n        arbInFlight.current = null;\n      }\n    })();\n    arbInFlight.current = p;\n    return p;\n  }, [arbLoaded, showToast, t, selectedExchanges, planLimits.maxExchanges]);\n\n  const loadAlerts = useCallback((force = false) => {\n    if (alertsInFlight.current) return alertsInFlight.current;\n    if (!force && alertsLoaded) return Promise.resolve();\n    const p = (async () => {\n      try {\n        const response: any = await apiClient.getArbitrageAlerts();\n        if (response.ok) {\n          setArbAlerts(response.alerts || []);\n          setAlertsLoaded(true);\n        }\n      } catch {\n        /* ignore — alerts are non-critical */\n      } finally {\n        alertsInFlight.current = null;\n      }\n    })();\n    alertsInFlight.current = p;\n    return p;\n  }, [alertsLoaded]);\n\n  // Refresh the active subscription after a successful payment / trial.\n  const refreshSubscription = useCallback(async () => {\n    try {\n      const res: any = await apiClient.getProfile();\n      const sub = res?.user?.subscription || res?.subscription;\n      if (sub) setSubscription(sub);\n    } catch {\n      /* ignore */\n    }\n  }, []);\n\n  // Realtime \"new spread\" push: surface fresh arbitrage opportunities as a\n  // toast no matter which tab the user is on, and refresh the arbitrage list\n  // so the opportunity is already there when they open that tab.\n  const handleNewSpread = useCallback((data: any) => {\n    if (!data) return;\n    const diffPct = ((data.difference || 0) * 100).toFixed(2);\n    showToast(\n      t('app.newSpread', { pair: data.pair, a: data.exchangeA, b: data.exchangeB, diff: diffPct }),\n      'spread'\n    );\n    if (user?.id) loadArbitrage(true, { silent: true });\n  }, [showToast, user?.id, loadArbitrage, t]);\n\n  // Live funding broadcast: the server sends a freshness ping on every warm-up\n  // cycle (~5 min). We only record the timestamp — the arbitrage list is kept\n  // fresh by its own polling, so we never clobber the user's filtered view.\n  const [liveFundingAt, setLiveFundingAt] = useState<number | null>(null);\n  const applyLiveFunding = useCallback((data: { generatedAt?: number }) => {\n    setLiveFundingAt(data?.generatedAt || Date.now());\n  }, []);\n\n  // For the website we authenticate the WebSocket with the JWT; for the\n  // Telegram mini-app we pass the init data.\n  const wsAuth = useMemo(() => isWeb\n    ? { token: getAuthToken() }\n    : { initData }, [isWeb, initData]);\n  const handleAlertTriggered = useCallback(() => {\n    loadAlerts(true);\n  }, [loadAlerts]);\n  useWebSocket(wsAuth, {\n    onNewSpread: handleNewSpread,\n    onLiveFunding: applyLiveFunding,\n    onAlertTriggered: handleAlertTriggered,\n  });\n\n  const contextValue = useMemo<AppContextType>(() => ({\n    user,\n    subscription,\n    planLimits,\n    scanResults,\n    setScanResults,\n    scanLoading,\n    scanStatus,\n    runScan,\n    selectedExchanges,\n    setSelectedExchanges,\n    arbOpportunities,\n    arbAlerts,\n    setArbAlerts,\n    arbLoading,\n    arbLoaded,\n    arbError,\n    loadArbitrage,\n    loadAlerts,\n    liveFundingAt,\n    applyLiveFunding,\n    trialStatus,\n    refreshTrial,\n    activateTrial,\n    watchlist,\n    isWatchlisted,\n    toggleWatchlist,\n    refreshWatchlist,\n    isWeb,\n    authProvider,\n    logout,\n    refreshSubscription,\n  }), [\n    user, subscription, planLimits, scanResults, scanLoading, scanStatus, runScan,\n    selectedExchanges, arbOpportunities, arbAlerts, arbLoading, arbLoaded, arbError,\n    loadArbitrage, loadAlerts, trialStatus, refreshTrial, activateTrial,\n    watchlist, isWatchlisted, toggleWatchlist, refreshWatchlist,\n    isWeb, authProvider, logout, refreshSubscription, liveFundingAt, applyLiveFunding,\n  ]);\n\n  return (\n    <AppContext.Provider value={contextValue}>\n      <HashRouteBridge />\n      {isWeb && !authenticated ? (\n        <PageLoader />\n      ) : (\n        <>\n          {isWeb && <WebHeader user={user} onLogout={logout} onLogin={login} />}\n          <div className={isWide ? 'web-shell' : ''}>\n            <BrowserRouter>\n              <div className=\"web-layout\">\n                <Navigation />\n                <main className=\"web-content\">\n                  <Suspense fallback={<PageLoader />}>\n                    <Routes>\n                      <Route path=\"/\" element={<ErrorBoundary><MainPage /></ErrorBoundary>} />\n                      <Route path=\"/arbitrage\" element={<ErrorBoundary><ArbitragePage /></ErrorBoundary>} />\n                      <Route path=\"/profile\" element={<ErrorBoundary><ProfilePage /></ErrorBoundary>} />\n                      <Route path=\"/terms\" element={<ErrorBoundary><TermsPage /></ErrorBoundary>} />\n                      <Route path=\"/privacy\" element={<ErrorBoundary><PrivacyPage /></ErrorBoundary>} />\n                      <Route path=\"/admin\" element={<ErrorBoundary><AdminPage /></ErrorBoundary>} />\n                      <Route path=\"/settings\" element={<ErrorBoundary><SettingsPage /></ErrorBoundary>} />\n                      <Route path=\"/portfolio\" element={<ErrorBoundary><PortfolioPage /></ErrorBoundary>} />\n                      <Route path=\"/qr-scan\" element={<ErrorBoundary><QrScanPage /></ErrorBoundary>} />\n                      <Route path=\"/public\" element={<ErrorBoundary><PublicPage /></ErrorBoundary>} />\n                      <Route path=\"/login\" element={<LoginPage onAuthenticated={login} />} />\n                      <Route path=\"*\" element={<Navigate to=\"/\" replace />} />\n                    </Routes>\n                  </Suspense>\n                </main>\n              </div>\n            </BrowserRouter>\n          </div>\n          {showOnboarding && <Onboarding onComplete={completeOnboarding} />}\n        </>\n      )}\n    </AppContext.Provider>\n  );\n}\n\nfunction PageLoader() {\n  return (\n    <div className=\"flex items-center justify-center min-h-[50vh]\">\n      <div className=\"animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--cobalt)]\"></div>\n    </div>\n  );\n}\n\n// Static hosts (Render Static Site etc.) can't always be configured with an SPA\n// fallback, so deep links are sometimes written as /index.html#/privacy (hash\n// fragment). This bridge migrates a `#/path` fragment into the real URL before\n// React Router mounts, making hash-based deep links work on any host.\nfunction HashRouteBridge() {\n  useEffect(() => {\n    try {\n      const hash = window.location.hash;\n      if (hash.startsWith('#/')) {\n        window.history.replaceState(null, '', hash.slice(1));\n        window.dispatchEvent(new PopStateEvent('popstate'));\n      }\n    } catch {\n      /* history API always available in modern browsers */\n    }\n  }, []);\n  return null;\n}\n\nexport default function App() {\n  // Debug overlay (replacement for F12 in the mini app). Open with `?debug=1`\n  // in the URL, or via the floating bug button (shown only to the developer).\n  const [debugOpen, setDebugOpen] = useState(false);\n  const { user: tgUser } = useTelegram();\n  const DEBUG_USER_ID = import.meta.env.VITE_DEBUG_TELEGRAM_ID as string | undefined;\n  const isDebugUser = Boolean(DEBUG_USER_ID) && tgUser?.id === DEBUG_USER_ID;\n\n  // `?debug=1` auto-opens the log overlay ONLY in dev builds or for the\n  // configured debug user — never for anonymous production visitors (the log\n  // buffer contains request URLs and error details).\n  useEffect(() => {\n    const wantsDebug =\n      typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';\n    if (wantsDebug && (import.meta.env.DEV || isDebugUser)) {\n      setDebugOpen(true);\n    }\n  }, [isDebugUser]);\n\n  // Funding Finder is deliberately theme-independent: always dark/cobalt,\n  // regardless of Telegram or system theme. No theme-following effect.\n\n  return (\n    <ErrorBoundary>\n      <ToastProvider>\n        <LanguageProvider>\n          <DataProvider />\n          <SupportButton />\n        </LanguageProvider>\n      </ToastProvider>\n      {isDebugUser && <DebugToggle onOpen={() => setDebugOpen(true)} />}\n      <DebugLog open={debugOpen} onClose={() => setDebugOpen(false)} />\n    </ErrorBoundary>\n  );\n}