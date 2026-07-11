import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { apiClient } from '../api/client';
import { useToast } from './Toast';
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
  const { showToast } = useToast();
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
        if (!cancelled) showToast('Не удалось загрузить историю', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [exchange, contract, showToast]);

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
          text: 'Время',
        },
      },
    },
  }), []);

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
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-auto">
        <div className="card">
          <h2 id="history-title" className="text-lg font-semibold mb-2">
            История Funding Rates: {exchange.toUpperCase()}:{contract}
          </h2>

          {loading ? (
            <div className="text-center py-8 text-gray-500" role="status">Загрузка...</div>
          ) : history.length > 0 ? (
            <div className="h-64">
              <Line data={chartData} options={chartOptions} />
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">Нет данных за период</div>
          )}

          <button ref={closeRef} onClick={onClose} className="btn btn-secondary mt-4 w-full">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

