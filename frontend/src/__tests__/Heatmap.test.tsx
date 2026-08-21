import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Heatmap } from '../components/Heatmap';

vi.mock('../api/client', () => ({
  API_BASE: 'https://funding-finder-api.onrender.com',
  apiClient: {
    getFeatureFlags: vi.fn(),
    getHeatmap: vi.fn(),
  },
}));

import { apiClient } from '../api/client';

describe('Heatmap', () => {
  const mockGetHeatmap = vi.mocked(apiClient.getHeatmap);

  beforeEach(() => {
    mockGetHeatmap.mockClear();
    // Default to pending so loading state can be observed before resolve
    mockGetHeatmap.mockReturnValue(new Promise(() => {}));
  });

  it('renders loading state initially', () => {
    render(<Heatmap />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders heatmap rows when data loads', async () => {
    mockGetHeatmap.mockResolvedValue({
      ok: true,
      pairs: [
        {
          exchange: 'binance',
          contract: 'BTCUSDT',
          rate_per_hour: 0.0001,
          funding_rate_per_hour: 0.0001,
          annualized_rate: 0.1095,
          volume_24h_settle: 5_000_000,
        },
        {
          exchange: 'bybit',
          contract: 'BTCUSDT',
          rate_per_hour: 0.0002,
          funding_rate_per_hour: 0.0002,
          annualized_rate: 0.2190,
          volume_24h_settle: 8_000_000,
        },
      ],
      exchanges: ['binance', 'bybit'],
      contracts: ['BTCUSDT'],
      generatedAt: Date.now(),
    } as any);

    render(<Heatmap />);

    await waitFor(() => {
      expect(screen.getAllByText('Binance').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText('Bybit').length).toBeGreaterThan(0);
    expect(screen.getAllByText('BTCUSDT').length).toBeGreaterThan(0);
  });

  it('renders error state on fetch failure', async () => {
    mockGetHeatmap.mockRejectedValue(new Error('Network error'));

    render(<Heatmap />);

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });

  it('calls fetch on mount', async () => {
    mockGetHeatmap.mockResolvedValue({ ok: true, pairs: [], generatedAt: Date.now() } as any);

    render(<Heatmap />);

    expect(mockGetHeatmap).toHaveBeenCalled();
  });
});