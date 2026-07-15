import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TrialCTA } from '../components/TrialCTA';
import { AppContext } from '../App';
import { LanguageProvider } from '../i18n';

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
  activateTrial: async () => false,
  watchlist: [],
  isWatchlisted: () => false,
  toggleWatchlist: async () => {},
  refreshWatchlist: async () => {},
} as any;

function renderCTA(ctx: any) {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <AppContext.Provider value={ctx}>
          <TrialCTA />
        </AppContext.Provider>
      </LanguageProvider>
    </MemoryRouter>
  );
}

describe('TrialCTA', () => {
  it('shows the free-trial activation CTA when no trial yet', () => {
    renderCTA({ ...baseCtx, trialStatus: null });
    expect(screen.getByText(/Активировать 3 дня/)).toBeInTheDocument();
  });

  it('shows active countdown when trial is active', () => {
    renderCTA({ ...baseCtx, subscription: 'pro', trialStatus: { active: true, used: true, endsAt: new Date(Date.now() + 2 * 86400000).toISOString(), daysLeft: 2, hoursLeft: 48 } });
    expect(screen.getByText(/Пробный Pro активен/)).toBeInTheDocument();
  });

  it('calls activateTrial when CTA clicked', () => {
    const activateTrial = vi.fn().mockResolvedValue(false);
    renderCTA({ ...baseCtx, activateTrial });
    fireEvent.click(screen.getByText(/Активировать 3 дня/));
    expect(activateTrial).toHaveBeenCalledOnce();
  });

  it('shows a working upgrade button after the trial is used up', () => {
    renderCTA({ ...baseCtx, trialStatus: { active: false, used: true, endsAt: null, daysLeft: 0, hoursLeft: 0 } });
    const btn = screen.getByText(/Продлить Pro/);
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });
});

