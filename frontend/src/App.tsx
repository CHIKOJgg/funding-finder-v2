import React, { useState, createContext, useContext, useMemo, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Navigation } from './components/Navigation';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { useTelegram } from './hooks/useTelegram';
import type { ScanResult } from './types';

const MainPage = React.lazy(() => import('./pages/MainPage').then(m => ({ default: m.MainPage })));
const ArbitragePage = React.lazy(() => import('./pages/ArbitragePage').then(m => ({ default: m.ArbitragePage })));
const ProfilePage = React.lazy(() => import('./pages/ProfilePage').then(m => ({ default: m.ProfilePage })));

interface AppContextType {
  user: { id: string; firstName?: string; username?: string; subscription?: string } | null;
  scanResults: ScanResult | null;
  setScanResults: (results: ScanResult | null) => void;
  selectedExchanges: string[];
  setSelectedExchanges: React.Dispatch<React.SetStateAction<string[]>>;
}

export const AppContext = createContext<AppContextType>({
  user: null,
  scanResults: null,
  setScanResults: () => {},
  selectedExchanges: [],
  setSelectedExchanges: () => {},
});

export function useApp() {
  return useContext(AppContext);
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
    </div>
  );
}

export default function App() {
  const { user } = useTelegram();
  const [scanResults, setScanResults] = useState<ScanResult | null>(null);
  const [selectedExchanges, setSelectedExchanges] = useState<string[]>([
    'gate', 'binance', 'bybit', 'mexc', 'okx'
  ]);

  const contextValue = useMemo<AppContextType>(() => ({
    user,
    scanResults,
    setScanResults,
    selectedExchanges,
    setSelectedExchanges,
  }), [user, scanResults, selectedExchanges]);

  return (
    <ErrorBoundary>
      <ToastProvider>
        <AppContext.Provider value={contextValue}>
          <BrowserRouter>
            <div className="min-h-screen pb-20">
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<ErrorBoundary><MainPage /></ErrorBoundary>} />
                  <Route path="/arbitrage" element={<ErrorBoundary><ArbitragePage /></ErrorBoundary>} />
                  <Route path="/profile" element={<ErrorBoundary><ProfilePage /></ErrorBoundary>} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
              <Navigation />
            </div>
          </BrowserRouter>
        </AppContext.Provider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
