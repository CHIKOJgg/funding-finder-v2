import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { openExchange } from '../utils/exchanges';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const SF_EXCHANGES = [
  { value: 'binance', label: 'Binance' },
  { value: 'bybit', label: 'Bybit' },
  { value: 'okx', label: 'OKX' },
  { value: 'gate', label: 'Gate.io' },
  { value: 'mexc', label: 'MEXC' },
];

const QUICK_PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];

function formatNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || isNaN(n)) return 'N/A';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(2) + 'K';
  return n.toFixed(digits);
}

function formatPct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || isNaN(n)) return 'N/A';
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

export function SpotFuturesPanel() {
  const { showToast } = useToast();
  const t = useT();
  const [exchange, setExchange] = useState('binance');
  const [pair, setPair] = useState('BTCUSDT');
  const [data, setData] = useState<any>(null);
  const [history, setHistory] = useState<{ timestamp: string; funding: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);

  const loadSF = useCallback(async () => {
    try {
      const res: any = await apiClient.getSpotFutures(exchange, pair);
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

  useEffect(() => {
    setLoading(true);
    loadSF();
    loadHistory();
    if (paused) return;
    const id = setInterval(() => loadSF(), 30_000);
    return () => clearInterval(id);
  }, [loadSF, loadHistory, paused]);

  const basisChartData = useMemo(() => ({
    labels: (data?.series || []).map((s: any) => new Date(s.t).toLocaleTimeString()),
    datasets: [
      {
        label: t('sf.basis'),
        data: (data?.series || []).map((s: any) => s.basis),
        borderColor: 'rgb(168, 85, 247)',
        backgroundColor: 'rgba(168, 85, 247, 0.2)',
        fill: true,
        tension: 0.25,
        pointRadius: 0,
      },
    ],
  }), [data, t]);

  const basisChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { maxTicksLimit: 5 }, grid: { display: false } },
      y: { ticks: { callback: (v: any) => `${v}%` }, grid: { color: 'rgba(0,0,0,0.05)' } },
    },
  }), []);

  const fundingChartData = useMemo(() => ({
    labels: history.map((h) => new Date(h.timestamp).toLocaleString()),
    datasets: [
      {
        label: t('sf.fundingRate'),
        data: history.map((h) => h.funding * 100),
        borderColor: 'rgb(34, 197, 94)',
        backgroundColor: 'rgba(34, 197, 94, 0.2)',
        fill: true,
        tension: 0.1,
        pointRadius: 0,
      },
    ],
  }), [history, t]);

  return (
    <div className="card">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-lg font-semibold">{t('sf.title')}</h2>
        <div className="flex items-center gap-1.5 text-xs">
          <span className={clsx('inline-block w-2 h-2 rounded-full', paused ? 'bg-gray-400' : 'bg-green-500 animate-pulse')} aria-hidden="true" />
          <span className="text-green-600 font-medium">{t('oi.live')}</span>
        </div>
      </div>
      <p className="text-sm text-muted mb-3">{t('sf.subtitle')}</p>

      <div className="flex flex-col gap-3 mb-4">
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="sf-exchange">{t('sf.exchange')}</label>
          <select
            id="sf-exchange"
            value={exchange}
            onChange={(e) => setExchange(e.target.value)}
            className="input-field text-sm w-full"
          >
            {SF_EXCHANGES.map((ex) => (
              <option key={ex.value} value={ex.value}>{ex.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="sf-pair">{t('sf.pair')}</label>
          <input
            id="sf-pair"
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

        <button onClick={() => setPaused((p) => !p)} className="btn btn-secondary text-sm py-2">
          {paused ? `▶ ${t('oi.resume')}` : `⏸ ${t('oi.pause')}`}
        </button>
      </div>

      {!data?.supported && (
        <div className="text-sm text-yellow-700 bg-yellow-50 p-3 rounded mb-4">
          {t('sf.notSupported', { exchange })}
        </div>
      )}

      {loading && !data ? (
        <div className="text-center py-6 text-gray-500" role="status">{t('common.loading')}</div>
      ) : data?.supported ? (
        <>
          {lastUpdated && (
            <div className="text-xs text-gray-500 mb-2">{t('oi.updated', { time: new Date(lastUpdated).toLocaleTimeString() })}</div>
          )}

          {data?.strategy && (
            <div className="text-sm bg-purple-50 text-purple-700 p-2 rounded mb-3">
              💡 {data.strategy}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="p-3 rounded-lg bg-gray-50">
              <div className="text-xs text-gray-500">{t('sf.spotPrice')}</div>
              <div className="text-lg font-bold stat">${formatNum(data?.spotPrice)}</div>
            </div>
            <div className="p-3 rounded-lg bg-gray-50">
              <div className="text-xs text-gray-500">{t('sf.perpMark')}</div>
              <div className="text-lg font-bold stat">${formatNum(data?.perpMark)}</div>
            </div>
            <div className="p-3 rounded-lg bg-purple-50">
              <div className="text-xs text-gray-500">{t('sf.basis')}</div>
              <div className={clsx('text-lg font-bold stat', (data?.basisPct ?? 0) >= 0 ? 'text-green-600' : 'text-red-500')}>
                {formatPct(data?.basisPct)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-blue-50">
              <div className="text-xs text-gray-500">{t('sf.fundingRate')}</div>
              <div className="text-lg font-bold stat">{formatPct((data?.fundingRate ?? 0) * 100, 4)}</div>
            </div>
            <div className="p-3 rounded-lg bg-green-50 col-span-2">
              <div className="text-xs text-gray-500">{t('sf.fundingApy')}</div>
              <div className="text-xl font-bold stat text-green-600">{formatPct(data?.fundingApy, 1)}</div>
              <div className="text-xs text-gray-500 mt-1">{t('sf.netApy')}: {formatPct(data?.netApy, 1)}</div>
            </div>
          </div>

          <div className="h-36 mb-4">
            {data?.series?.length > 1 ? (
              <Line data={basisChartData} options={basisChartOptions} />
            ) : (
              <div className="text-center py-8 text-gray-400 text-sm">{t('oi.collecting')}</div>
            )}
          </div>

          <div className="mb-3">
            <button
              onClick={() => openExchange(exchange, pair)}
              className="btn btn-primary text-sm py-2 w-full"
            >
              {t('sf.open', { ex: exchange })}
            </button>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">{t('sf.history')}</h3>
            {history.length > 0 ? (
              <div className="h-48">
                <Line data={fundingChartData} options={basisChartOptions} />
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400 text-sm">{t('oi.noHistory')}</div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
