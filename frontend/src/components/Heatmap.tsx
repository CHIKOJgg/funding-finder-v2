import { useState, useEffect, useMemo, useCallback } from 'react';
import { clsx } from 'clsx';
import { useT } from '../i18n';
import { exchangeLabel } from '../utils/exchanges';

interface HeatmapCell {
  exchange: string;
  contract: string;
  rate_per_hour: number;
  annualized_rate: number;
  net_annual?: number;
  payback_days?: number;
  accumulated?: { d1: number; d7: number; d30: number; y1: number };
  mark_price: number;
  volume_24h_settle: number;
  funding_interval_hours: number;
}

interface HeatmapData {
  pairs: HeatmapCell[];
  exchanges: string[];
  contracts: string[];
  generatedAt: number;
}

function rateToColor(rate: number): string {
  const abs = Math.abs(rate);
  if (abs > 0.001) {
    return rate > 0 ? 'bg-[var(--red)]/70' : 'bg-[var(--green)]/70';
  }
  if (abs > 0.0003) {
    return rate > 0 ? 'bg-[var(--red)]/45' : 'bg-[var(--green)]/45';
  }
  if (abs > 0.0001) {
    return rate > 0 ? 'bg-[var(--red)]/20' : 'bg-[var(--green)]/20';
  }
  return 'bg-[var(--surface-2)]';
}

function rateTextColor(rate: number): string {
  return rate > 0 ? 'text-[var(--red)]' : rate < 0 ? 'text-[var(--green)]' : 'text-[var(--text-muted)]';
}

export function Heatmap() {
  const t = useT();
  const [data, setData] = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'rate' | 'volume' | 'exchange'>('rate');
  const [filterExchange, setFilterExchange] = useState<string>('');

  const API = (import.meta.env.VITE_API_URL || 'https://funding-finder-api.onrender.com').replace(/\/$/, '');

  const fetchHeatmap = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/public/heatmap`);
      const json = await res.json();
      if (json.ok) {
        setData(json);
        setError(null);
      } else {
        setError(json.error || 'Failed to load');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [API]);

  useEffect(() => {
    fetchHeatmap();
    const id = setInterval(fetchHeatmap, 60_000);
    return () => clearInterval(id);
  }, [fetchHeatmap]);

  const sortedPairs = useMemo(() => {
    if (!data) return [];
    let pairs = [...data.pairs];
    if (filterExchange) {
      pairs = pairs.filter((p) => p.exchange === filterExchange);
    }
    pairs.sort((a, b) => {
      switch (sortBy) {
        case 'rate':
          return Math.abs(b.rate_per_hour) - Math.abs(a.rate_per_hour);
        case 'volume':
          return (b.volume_24h_settle || 0) - (a.volume_24h_settle || 0);
        case 'exchange':
          return a.exchange.localeCompare(b.exchange) || Math.abs(b.rate_per_hour) - Math.abs(a.rate_per_hour);
        default:
          return 0;
      }
    });
    return pairs;
  }, [data, sortBy, filterExchange]);

  const exchanges = useMemo(() => [...new Set(data?.pairs.map((p) => p.exchange) || [])].sort(), [data]);

  const exchangesForFilter = useMemo(() => exchanges.filter((e) => data!.pairs.some((p) => p.exchange === e)), [exchanges, data]);

  return (
    <div className="card">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-lg font-semibold">{t('heatmap.title')}</h2>
        <span className="text-xs text-[var(--text-muted)]">
          {data && <span>{t('heatmap.updated')} {new Date(data.generatedAt).toLocaleTimeString()}</span>}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="input-field text-sm"
          aria-label={t('heatmap.sortLabel')}
        >
          <option value="rate">{t('heatmap.sortRate')}</option>
          <option value="volume">{t('heatmap.sortVolume')}</option>
          <option value="exchange">{t('heatmap.sortExchange')}</option>
        </select>
        <select
          value={filterExchange}
          onChange={(e) => setFilterExchange(e.target.value)}
          className="input-field text-sm"
          aria-label={t('heatmap.exchangeFilter')}
        >
          <option value="">{t('heatmap.allExchanges')}</option>
          {exchangesForFilter.map((ex) => (
            <option key={ex} value={ex}>{exchangeLabel(ex)}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-8 text-[var(--text-muted)]" role="status">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[var(--cobalt)] mx-auto mb-2" />
          {t('common.loading')}
        </div>
      ) : error ? (
        <div className="text-center py-8 text-[var(--red)] text-sm">{error}</div>
      ) : sortedPairs.length === 0 ? (
        <div className="text-center py-8 text-[var(--text-muted)] text-sm">{t('heatmap.noData')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
             <thead>
               <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                 <th className="pb-1 pr-2">{t('heatmap.exchange')}</th>
                 <th className="pb-1 pr-2">{t('heatmap.contract')}</th>
                 <th className="pb-1 pr-2 text-right">{t('heatmap.ratePerHour')}</th>
                 <th className="pb-1 pr-2 text-right">{t('heatmap.annualized')}</th>
                 <th className="pb-1 pr-2 text-right">{t('heatmap.accumulatedD1')}</th>
                 <th className="pb-1 pr-2 text-right">{t('heatmap.accumulatedD7')}</th>
                 <th className="pb-1 text-right">{t('heatmap.volume24h')}</th>
               </tr>
             </thead>
             <tbody>
               {sortedPairs.map((p, i) => (
                 <tr key={`${p.exchange}-${p.contract}-${i}`} className={clsx('border-b border-[var(--border)]', rateToColor(p.rate_per_hour))}>
                   <td className="py-1 pr-2 font-medium">{exchangeLabel(p.exchange)}</td>
                   <td className="py-1 pr-2">{p.contract}</td>
                   <td className={clsx('py-1 pr-2 text-right font-semibold', rateTextColor(p.rate_per_hour))}>
                     {p.rate_per_hour >= 0 ? '+' : ''}{(p.rate_per_hour * 100).toFixed(4)}%/h
                   </td>
                   <td className={clsx('py-1 pr-2 text-right', rateTextColor(p.rate_per_hour))}>
                     {p.annualized_rate != null && (p.annualized_rate >= 0 ? '+' : '')}{(p.annualized_rate * 100).toFixed(1)}%
                   </td>
                   <td className={clsx('py-1 pr-2 text-right', rateTextColor(p.accumulated?.d1 ?? 0))}>
                     {p.accumulated != null ? (p.accumulated.d1 * 100 >= 0 ? '+' : '') + (p.accumulated.d1 * 100).toFixed(2) + '%' : '—'}
                   </td>
                   <td className={clsx('py-1 pr-2 text-right', rateTextColor(p.accumulated?.d7 ?? 0))}>
                     {p.accumulated != null ? (p.accumulated.d7 * 100 >= 0 ? '+' : '') + (p.accumulated.d7 * 100).toFixed(2) + '%' : '—'}
                   </td>
                   <td className="py-1 text-right text-[var(--text-muted)]">
                     {p.volume_24h_settle >= 1_000_000
                       ? `${(p.volume_24h_settle / 1_000_000).toFixed(1)}M`
                       : p.volume_24h_settle >= 1_000
                       ? `${(p.volume_24h_settle / 1_000).toFixed(1)}K`
                       : p.volume_24h_settle?.toFixed(0) ?? '—'}
                   </td>
                 </tr>
               ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}