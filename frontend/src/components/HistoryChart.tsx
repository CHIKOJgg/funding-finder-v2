import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { apiClient } from '../api/client';
import { useToast } from './Toast';
import { useT } from '../i18n';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

interface HistoryRecord {
  timestamp: string;
  funding: number;
}

interface HistoryChartProps {
  exchange: string;
  contract: string;
  onClose: () => void;
}

export function HistoryChart({ exchange, contract, onClose }: HistoryChartProps) {
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [apr, setApr] = useState<{ apr: number; avgRate: number; periodDays: number; dataPoints: number; series: any[] | null } | null>(null);
  const { showToast } = useToast();
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus trap: focus close button on mount
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const response: any = await apiClient.getHistory(exchange, contract);
        if (!cancelled && response.ok) {
          setHistory(response.history);
        }
      } catch (error) {
        if (!cancelled) showToast(t('history.loadError'), 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [exchange, contract, showToast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res: any = await apiClient.getApr(exchange, contract, 30);
        if (!cancelled && res?.ok) {
          setApr({ apr: res.apr, avgRate: res.avgRate, periodDays: res.periodDays, dataPoints: res.dataPoints, series: res.series });
        }
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [exchange, contract]);

  const chartData = useMemo(() => ({
    labels: history.map((h) => new Date(h.timestamp).toLocaleString()),
    datasets: [
      {
        label: 'Funding Rate (%)',
        data: history.map((h) => h.funding * 100),
        borderColor: 'rgb(51, 144, 236)',
        backgroundColor: 'rgba(51, 144, 236, 0.5)',
        tension: 0.1,
      },
    ],
  }), [history]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: false,
      },
    },
    scales: {
      y: {
        title: {
          display: true,
          text: 'Funding Rate (%)',
        },
      },
      x: {
        title: {
          display: true,
          text: t('history.timeAxis'),
        },
      },
    },
  }), [t]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="rounded-xl max-w-lg w-full max-h-[90vh] overflow-auto" style={{ background: 'var(--bg)' }}>
        <div className="card">
          <h2 id="history-title" className="text-lg font-semibold mb-2">
            {t('history.title', { exchange: exchange.toUpperCase(), contract })}
          </h2>

          {loading ? (
            <div className="text-center py-8 text-muted" role="status">{t('common.loading')}</div>
          ) : history.length > 0 ? (
            <div className="h-64">
              <Line data={chartData} options={chartOptions} />
            </div>
          ) : (
            <div className="text-center py-8 text-muted">{t('history.noData')}</div>
          )}

          {apr && (
            <div className="mt-4 p-3 rounded-xl" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
              <div className="text-sm font-medium">{t('history.avgApr', { days: apr.periodDays })}</div>
              <div className="text-2xl font-bold stat">{(apr.apr * 100).toFixed(2)}%</div>
              <div className="text-xs mt-1">
                {t('history.avgRate', { rate: (apr.avgRate * 100).toFixed(6), points: apr.dataPoints })}
              </div>
            </div>
          )}

          <button ref={closeRef} onClick={onClose} className="btn btn-secondary mt-4 w-full">
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

