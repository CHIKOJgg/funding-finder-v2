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
import { IconLightbulb, IconPause, IconPlay } from './icons';
import { LiveIndicator } from './LiveIndicator';

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
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [proRequired, setProRequired] = useState(false);

  const loadSF = useCallback(async () => {
    const t0 = performance.now();
    try {
      const res: any = await apiClient.getSpotFutures(exchange, pair);
      const latency = Math.round(performance.now() - t0);
      if (res?.ok) {
        setData(res);
        setLatencyMs(latency);
        setLastUpdated(Date.now());
        setProRequired(false);
      } else if (res?.code === 'PRO_REQUIRED' || res?.error?.includes?.('Pro')) {
        setProRequired(true);
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
        borderColor: 'rgb(61, 99, 255)',
        backgroundColor: 'rgba(61, 99, 255, 0.15)',
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
      y: { ticks: { callback: (v: any) => `${v}%` }, grid: { color: 'rgba(255,255,255,0.06)' } },
    },
  }), []);

  const fundingChartData = useMemo(() => ({
    labels: history.map((h) => new Date(h.timestamp).toLocaleString()),
    datasets: [
      {
        label: t('sf.fundingRate'),
        data: history.map((h) => h.funding * 100),
        borderColor: 'rgb(52, 211, 153)',
        backgroundColor: 'rgba(52, 211, 153, 0.15)',
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
        <LiveIndicator paused={paused} latencyMs={latencyMs} lastUpdated={lastUpdated} />
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
                  pair === p ? 'border-[var(--brand)] text-[var(--brand)] bg-[var(--cobalt-soft)]' : 'border-[var(--border)] text-[var(--text2)]'
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <button onClick={() => setPaused((p) => !p)} className="btn btn-secondary text-sm py-2 gap-1.5">
          {paused ? <IconPlay className="w-4 h-4 shrink-0" /> : <IconPause className="w-4 h-4 shrink-0" />}
          <span>{paused ? t('oi.resume') : t('oi.pause')}</span>
        </button>
      </div>

      {proRequired ? (
        <div className="card text-center p-6 my-4 border border-[var(--cobalt)]/40 bg-[var(--surface-2)]">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3 text-xl font-extrabold shadow-sm"
            style={{ background: 'var(--cobalt)', color: 'var(--on-brand)' }}
          >
            ⭐
          </div>
          <h3 className="text-lg font-bold text-[var(--text)] mb-1">
            {t('paywall.portfolioTitle') || 'Мониторинг Spot-Futures доступен в Pro'}
          </h3>
          <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto mb-4">
            Кастомный расчёт базиса спот-фьючерс и cash-and-carry арбитража для любых торговых пар входит в подписку Pro.
          </p>
          <a
            href="/profile#subscription"
            className="btn btn-primary text-sm py-2.5 px-6 mx-auto inline-block font-semibold shadow-md"
          >
            {t('paywall.unlockBtn') || 'Перейти к тарифу Pro'}
          </a>
        </div>
      ) : !data?.supported ? (
        <div className="text-sm text-[var(--amber)] bg-[var(--amber-soft)] p-3 rounded-lg mb-4">
          {t('sf.notSupported', { exchange })}
        </div>
      ) : null}

      {!proRequired && loading && !data ? (
        <div className="text-center py-6 text-[var(--text-muted)]" role="status">{t('common.loading')}</div>
      ) : !proRequired && data?.supported ? (
        <>
          {lastUpdated && (
            <div className="text-xs text-[var(--text-muted)] mb-2">{t('oi.updated', { time: new Date(lastUpdated).toLocaleTimeString() })}</div>
          )}

          {data?.strategy && (
            <div className="flex items-start gap-2 text-sm bg-[var(--cobalt-soft)] text-[var(--cobalt)] p-2.5 rounded-lg mb-3">
              <IconLightbulb className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{data.strategy}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="p-3 rounded-lg bg-[var(--surface-2)]">
              <div className="text-xs text-[var(--text-muted)]">{t('sf.spotPrice')}</div>
              <div className="text-lg font-bold stat">${formatNum(data?.spotPrice)}</div>
            </div>
            <div className="p-3 rounded-lg bg-[var(--surface-2)]">
              <div className="text-xs text-[var(--text-muted)]">{t('sf.perpMark')}</div>
              <div className="text-lg font-bold stat">${formatNum(data?.perpMark)}</div>
            </div>
            <div className="p-3 rounded-lg bg-[var(--cobalt-soft)]">
              <div className="text-xs text-[var(--text-muted)]">{t('sf.basis')}</div>
              <div className={clsx('text-lg font-bold stat', (data?.basisPct ?? 0) >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>
                {formatPct(data?.basisPct)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-[var(--cobalt-soft)]">
              <div className="text-xs text-[var(--text-muted)]">{t('sf.fundingRate')}</div>
              <div className="text-lg font-bold stat">{formatPct((data?.fundingRate ?? 0) * 100, 4)}</div>
            </div>
            <div className="p-3 rounded-lg bg-[var(--green-soft)] col-span-2">
              <div className="text-xs text-[var(--text-muted)]">{t('sf.fundingApy')}</div>
              <div className="text-xl font-bold stat text-[var(--green)]">{formatPct(data?.fundingApy, 1)}</div>
              <div className="text-xs text-[var(--text-muted)] mt-1">{t('sf.netApy')}: {formatPct(data?.netApy, 1)}</div>
            </div>
          </div>

          <div className="h-36 mb-4">
            {data?.series?.length > 1 ? (
              <Line data={basisChartData} options={basisChartOptions} />
            ) : (
              <div className="text-center py-8 text-[var(--text-muted)] text-sm">{t('oi.collecting')}</div>
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
              <div className="text-center py-8 text-[var(--text-muted)] text-sm">{t('oi.noHistory')}</div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
