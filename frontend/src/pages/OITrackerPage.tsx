import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { clsx } from 'clsx';
import { apiClient } from '../api/client';
import { useToast } from '../components/Toast';
import { useT } from '../i18n';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const OI_EXCHANGES = [
  { value: 'binance', label: 'Binance' },
  { value: 'bybit', label: 'Bybit' },
  { value: 'okx', label: 'OKX' },
];

const QUICK_PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];

function formatUSD(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return 'N/A';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(2) + 'K';
  return n.toFixed(2);
}

function formatNum(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return 'N/A';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(2) + 'K';
  return n.toFixed(2);
}

export function OITrackerPage() {
  const { showToast } = useToast();
  const t = useT();
  const [exchange, setExchange] = useState('binance');
  const [pair, setPair] = useState('BTCUSDT');
  const [data, setData] = useState<any>(null);
  const [history, setHistory] = useState<{ timestamp: string; funding: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const liveDotRef = useRef<HTMLSpanElement>(null);

  const loadOI = useCallback(async () => {
    try {
      const res: any = await apiClient.getOpenInterest(exchange, pair);
      if (res?.ok) {
        setData(res);
        setLastUpdated(Date.now());
      } else if (res?.error) {
        showToast(res.error, 'error');
      }
    } catch {
      /* keep previous data on transient error */
    } finally {
      setLoading(false);
    }
  }, [exchange, pair, showToast]);

  const loadHistory = useCallback(async () => {
    try {
      const res: any = await apiClient.getHistory(exchange, pair);
      if (res?.ok) setHistory(res.history || []);
    } catch {
      /* non-critical */
    }
  }, [exchange, pair]);

  // Live polling — refreshes open interest every 15s while not paused.
  useEffect(() => {
    setLoading(true);
    loadOI();
    loadHistory();
    if (paused) return;
    const id = setInterval(() => {
      loadOI();
    }, 30_000);
    return () => clearInterval(id);
  }, [loadOI, loadHistory, paused]);

  const oiChartData = useMemo(() => {
    const series = data?.series || [];
    return {
      labels: series.map((s: any) => new Date(s.t).toLocaleTimeString()),
      datasets: [
        {
          label: t('oi.series'),
          data: series.map((s: any) => s.oi),
          borderColor: 'rgb(51, 144, 236)',
          backgroundColor: 'rgba(51, 144, 236, 0.2)',
          fill: true,
          tension: 0.25,
          pointRadius: 0,
        },
      ],
    };
  }, [data, t]);

  const oiChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { maxTicksLimit: 5 }, grid: { display: false } },
      y: { ticks: { callback: (v: any) => formatNum(v) }, grid: { color: 'rgba(0,0,0,0.05)' } },
    },
  }), []);

  const fundingChartData = useMemo(() => ({
    labels: history.map((h) => new Date(h.timestamp).toLocaleString()),
    datasets: [
      {
        label: t('oi.fundingRate'),
        data: history.map((h) => h.funding * 100),
        borderColor: 'rgb(34, 197, 94)',
        backgroundColor: 'rgba(34, 197, 94, 0.2)',
        fill: true,
        tension: 0.1,
        pointRadius: 0,
      },
    ],
  }), [history, t]);

  const fundingChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { maxTicksLimit: 5 }, grid: { display: false } },
      y: { ticks: { callback: (v: any) => `${v}%` }, grid: { color: 'rgba(0,0,0,0.05)' } },
    },
  }), []);

  return (
    <div className="p-4">
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-11 h-11 rounded-2xl flex items-center justify-center text-lg font-black text-white shrink-0"
          style={{ background: 'linear-gradient(135deg, #3390ec, #1f4fb0)' }}
        >
          OI
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold leading-tight">{t('oi.title')}</h1>
          <p className="text-sm text-muted leading-tight">{t('oi.subtitle')}</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span
            ref={liveDotRef}
            className={clsx(
              'inline-block w-2 h-2 rounded-full',
              paused ? 'bg-gray-400' : 'bg-green-500 animate-pulse'
            )}
            aria-hidden="true"
          />
          <span className="text-green-600 font-medium">{t('oi.live')}</span>
        </div>
      </div>

      <div className="card mb-4">
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="oi-exchange">{t('oi.exchange')}</label>
            <select
              id="oi-exchange"
              value={exchange}
              onChange={(e) => setExchange(e.target.value)}
              className="input-field text-sm w-full"
            >
              {OI_EXCHANGES.map((ex) => (
                <option key={ex.value} value={ex.value}>{ex.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="oi-pair">{t('oi.pair')}</label>
            <input
              id="oi-pair"
              type="text"
              value={pair}
              onChange={(e) => setPair(e.target.value.toUpperCase().trim())}
              placeholder="BTCUSDT"
              className="input-field text-sm w-full"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {QUICK_PAIRS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPair(p)}
                  className={clsx(
                    'text-xs px-2 py-1 rounded-full border',
                    pair === p ? 'border-[var(--brand)] text-[var(--brand)] bg-blue-50' : 'border-gray-300 text-gray-600'
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => setPaused((p) => !p)}
            className="btn btn-secondary text-sm py-2"
          >
            {paused ? `▶ ${t('oi.resume')}` : `⏸ ${t('oi.pause')}`}
          </button>
        </div>
      </div>

      {!data?.supported && (
        <div className="card mb-4 text-sm text-yellow-700 bg-yellow-50">
          {t('oi.notSupported', { exchange: exchange })}
        </div>
      )}

      <div className="card mb-4">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-lg font-semibold">{t('oi.current')}</h2>
          {lastUpdated && (
            <span className="text-xs text-gray-500">{t('oi.updated', { time: new Date(lastUpdated).toLocaleTimeString() })}</span>
          )}
        </div>

        {loading && !data ? (
          <div className="text-center py-6 text-gray-500" role="status">{t('common.loading')}</div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-blue-50">
              <div className="text-xs text-gray-500">{t('oi.openInterest')}</div>
              <div className="text-lg font-bold stat">{formatNum(data?.openInterest)}</div>
            </div>
            <div className="p-3 rounded-lg bg-green-50">
              <div className="text-xs text-gray-500">{t('oi.notional')}</div>
              <div className="text-lg font-bold stat">${formatUSD(data?.notionalUsd)}</div>
            </div>
            <div className="p-3 rounded-lg bg-gray-50 col-span-2">
              <div className="text-xs text-gray-500">{t('oi.markPrice')}</div>
              <div className="text-lg font-bold stat">${formatNum(data?.markPrice)}</div>
            </div>
          </div>
        )}

        <div className="h-40 mt-4">
          {data?.series?.length > 1 ? (
            <Line data={oiChartData} options={oiChartOptions} />
          ) : (
            <div className="text-center py-8 text-gray-400 text-sm">{t('oi.collecting')}</div>
          )}
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-2">{t('oi.history')}</h2>
        {history.length > 0 ? (
          <div className="h-56">
            <Line data={fundingChartData} options={fundingChartOptions} />
          </div>
        ) : (
          <div className="text-center py-8 text-gray-400 text-sm">{t('oi.noHistory')}</div>
        )}
      </div>
    </div>
  );
}
