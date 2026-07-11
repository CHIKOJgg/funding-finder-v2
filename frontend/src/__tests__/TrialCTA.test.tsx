import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TrialCTA } from '../components/TrialCTA';
import { AppContext } from '../App';

const baseCtx = {
  user: { id: 'tg_1', firstName: 'Dev' },
  subscription: 'free',
  planLimits: { maxExchanges: 1, aiEnabled: false, recommendationsEnabled: false, watchlistLimit: 3, portfolioEnabled: false, label: 'Free' },
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
  loadArbitrage: async () => {},
  loadAlerts: async () => {},
  trialStatus: null,
  refreshTrial: async () => {},
  activateTrial: async () => {},
  watchlist: [],
  isWatchlisted: () => false,
  toggleWatchlist: async () => {},
  refreshWatchlist: async () => {},
} as any;

describe('TrialCTA', () => {
  it('shows the free-trial activation CTA when no trial yet', () => {
    render(
      <MemoryRouter>
        <AppContext.Provider value={{ ...baseCtx, trialStatus: null }}>
          <TrialCTA />
        </AppContext.Provider>
      </MemoryRouter>
    );
    expect(screen.getByText(/Активировать 3 дня/)).toBeInTheDocument();
  });

  it('shows active countdown when trial is active', () => {
    render(
      <MemoryRouter>
        <AppContext.Provider value={{ ...baseCtx, subscription: 'pro', trialStatus: { active: true, used: true, endsAt: new Date(Date.now() + 2 * 86400000).toISOString(), daysLeft: 2, hoursLeft: 48 } }}>
          <TrialCTA />
        </AppContext.Provider>
      </MemoryRouter>
    );
    expect(screen.getByText(/Пробный Pro активен/)).toBeInTheDocument();
  });

  it('calls activateTrial when CTA clicked', () => {
    const activateTrial = vi.fn();
    render(
      <MemoryRouter>
        <AppContext.Provider value={{ ...baseCtx, activateTrial }}>
          <TrialCTA />
        </AppContext.Provider>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText(/Активировать 3 дня/));
    expect(activateTrial).toHaveBeenCalledOnce();
  });
});
