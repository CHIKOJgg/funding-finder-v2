import React, { useState, createContext, useContext, useMemo, useRef, useCallback, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Navigation } from './components/Navigation';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider, useToast } from './components/Toast';
import { Onboarding } from './components/Onboarding';
import { useTelegram } from './hooks/useTelegram';
import { apiClient } from './api/client';
import type { ScanResult } from './types';

const MainPage = React.lazy(() => import('./pages/MainPage').then(m => ({ default: m.MainPage })));
const ArbitragePage = React.lazy(() => import('./pages/ArbitragePage').then(m => ({ default: m.ArbitragePage })));
const ProfilePage = React.lazy(() => import('./pages/ProfilePage').then(m => ({ default: m.ProfilePage })));
const TermsPage = React.lazy(() => import('./pages/TermsPage').then(m => ({ default: m.TermsPage })));
const PrivacyPage = React.lazy(() => import('./pages/PrivacyPage').then(m => ({ default: m.PrivacyPage })));
const AdminPage = React.lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));
const SettingsPage = React.lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));

interface AppContextType {
  user: { id: string; firstName?: string; username?: string; subscription?: string } | null;

  // ---- Scan (Main page) ----
  scanResults: ScanResult | null;
  setScanResults: (results: ScanResult | null) => void;
  scanLoading: boolean;
  scanStatus: string;
  runScan: (exchanges: string[]) => Promise<void>;

  selectedExchanges: string[];
  setSelectedExchanges: React.Dispatch<React.SetStateAction<string[]>>;

  // ---- Arbitrage ----
  arbOpportunities: any[];
  arbAlerts: any[];
  setArbAlerts: React.Dispatch<React.SetStateAction<any[]>>;
  arbLoading: boolean;
  arbLoaded: boolean;
  loadArbitrage: (force?: boolean) => Promise<void>;
  loadAlerts: (force?: boolean) => Promise<void>;
}

export const AppContext = createContext<AppContextType>({
  user: null,
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
function DataProvider({ children }: { children: React.ReactNode }) {
  const { user } = useTelegram();
  const { showToast } = useToast();

  // Scan state
  const [scanResults, setScanResults] = useState<ScanResult | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanStatus, setScanStatus] = useState('Готов к сканированию');
  const [selectedExchanges, setSelectedExchanges] = useState<string[]>([
    'gate', 'binance', 'bybit', 'mexc', 'okx'
  ]);

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
    setScanStatus('Сканирование... Это может занять несколько секунд');
    const p = (async () => {
      try {
        const response: any = await apiClient.scan(exchanges);
        if (response.ok) {
          setScanResults(response.result);
          setScanStatus(`Найдено ${response.result.scanned} инструментов`);
          showToast('Сканирование завершено', 'success');
        } else {
          setScanStatus('Ошибка при сканировании: ' + response.error);
          showToast('Ошибка сканирования', 'error');
        }
      } catch (error) {
        setScanStatus('Ошибка сети: ' + (error as Error).message);
        showToast('Ошибка сети', 'error');
      } finally {
        setScanLoading(false);
        scanInFlight.current = null;
      }
    })();
    scanInFlight.current = p;
    return p;
  }, [showToast]);

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
        }
      } catch (error) {
        showToast('Не удалось загрузить возможности', 'error');
      } finally {
        setArbLoading(false);
        arbInFlight.current = null;
      }
    })();
    arbInFlight.current = p;
    return p;
  }, [arbLoaded, showToast]);

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

  const contextValue = useMemo<AppContextType>(() => ({
    user,
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
  }), [
    user, scanResults, scanLoading, scanStatus, runScan,
    selectedExchanges, arbOpportunities, arbAlerts, arbLoading, arbLoaded,
    loadArbitrage, loadAlerts,
  ]);

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
    </div>
  );
}

export default function App() {
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return localStorage.getItem('ff_onboarding_done') !== 'true';
  });

  const completeOnboarding = useCallback(() => {
    localStorage.setItem('ff_onboarding_done', 'true');
    setShowOnboarding(false);
  }, []);

  // Dark theme: detect Telegram theme and apply class
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    const applyTheme = (colorScheme?: string) => {
      if (colorScheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    if (tg) {
      applyTheme(tg.colorScheme);
      tg.onEvent('themeChanged', () => applyTheme(tg.colorScheme));
      return () => tg.offEvent('themeChanged', () => {});
    } else {
      // Fallback: check system preference
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mq.matches ? 'dark' : 'light');
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches ? 'dark' : 'light');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, []);

  return (
    <ErrorBoundary>
      <ToastProvider>
        <DataProvider>
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
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
              <Navigation />
            </div>
          </BrowserRouter>
          {showOnboarding && <Onboarding onComplete={completeOnboarding} />}
        </DataProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
