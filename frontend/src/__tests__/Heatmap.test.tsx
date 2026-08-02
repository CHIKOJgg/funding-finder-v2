import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Heatmap } from '../components/Heatmap';

vi.mock('../api/client', () => ({
  API_BASE: 'https://funding-finder-api.onrender.com',
  apiClient: {
    getFeatureFlags: vi.fn(),
  },
}));

describe('Heatmap', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    global.fetch = mockFetch as unknown as typeof global.fetch;
    mockFetch.mockClear();
  });

  it('renders loading state initially', () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true, pairs: [], generatedAt: Date.now() }),
    });

    render(<Heatmap />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders heatmap rows when data loads', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        pairs: [
          {
            exchange: 'binance',
            contract: 'BTCUSDT',
            rate_per_hour: 0.0001,
            annualized_rate: 0.1095,
            volume_24h_settle: 5_000_000,
          },
          {
            exchange: 'bybit',
            contract: 'BTCUSDT',
            rate_per_hour: 0.0002,
            annualized_rate: 0.2190,
            volume_24h_settle: 8_000_000,
          },
        ],
        exchanges: ['binance', 'bybit'],
        contracts: ['BTCUSDT'],
        generatedAt: Date.now(),
      }),
    });

    render(<Heatmap />);

    await waitFor(() => {
      expect(screen.getAllByText('Binance').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText('Bybit').length).toBeGreaterThan(0);
    expect(screen.getAllByText('BTCUSDT').length).toBeGreaterThan(0);
  });

  it('renders error state on fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    render(<Heatmap />);

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });

  it('calls fetch on mount', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, pairs: [], generatedAt: Date.now() }),
    });

    render(<Heatmap />);

    expect(mockFetch).toHaveBeenCalled();
  });
});