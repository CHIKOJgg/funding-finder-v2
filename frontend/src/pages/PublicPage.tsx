import { useState, useEffect, useCallback, useMemo } from 'react';
import { clsx } from 'clsx';
import { useT } from '../i18n';
import { formatPrice } from '../utils/formatters';
import { exchangeLabel } from '../utils/exchanges';

interface HeatmapEntry {
  exchange: string;
  contract: string;
  funding_rate_per_hour: number;
  annualized_rate: number;
  mark_price: number;
  volume_24h_settle: number;
  funding_interval_hours: number;
}

type SortKey = 'rate_desc' | 'rate_asc' | 'volume' | 'exchange';

const FAQ_ITEMS = [
  { q: 'public.faq1Q', a: 'public.faq1A' },
  { q: 'public.faq2Q', a: 'public.faq2A' },
  { q: 'public.faq3Q', a: 'public.faq3A' },
  { q: 'public.faq4Q', a: 'public.faq4A' },
];

export function PublicPage() {
  const t = useT();
  const [pairs, setPairs] = useState<HeatmapEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [scanned, setScanned] = useState(0);
  const [sortBy, setSortBy] = useState<SortKey>('rate_desc');
  const [filterExchange, setFilterExchange] = useState<string>('');
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const API = (import.meta.env.VITE_API_URL || 'https://funding-finder-api.onrender.com').replace(/\/$/, '');

  useEffect(() => {
    document.title = 'Funding Finder — Real-time Crypto Funding Rates | Free Heatmap';
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', 'Track perpetual funding rates across 25+ crypto exchanges in real-time. Free heatmap, arbitrage scanner, and AI analysis. Start earning from funding rates today.');
  }, []);

  const fetchHeatmap = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/public/heatmap`);
      const data = await res.json();
      if (data.ok) {
        setPairs(data.pairs || []);
        setGeneratedAt(data.generatedAt);
        setScanned(data.scanned || 0);
        setError(null);
      } else {
        setError(data.error || 'Failed to load');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [API]);

  useEffect(() => {
    fetchHeatmap();
    const id = setInterval(fetchHeatmap, 30_000);
    return () => clearInterval(id);
  }, [fetchHeatmap]);

  const exchanges = useMemo(() => [...new Set(pairs.map((p) => p.exchange))].sort(), [pairs]);

  const filtered = useMemo(() => pairs.filter((p) => !filterExchange || p.exchange === filterExchange), [pairs, filterExchange]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'rate_desc':
        return Math.abs(b.funding_rate_per_hour) - Math.abs(a.funding_rate_per_hour);
      case 'rate_asc':
        return Math.abs(a.funding_rate_per_hour) - Math.abs(b.funding_rate_per_hour);
      case 'volume':
        return (b.volume_24h_settle || 0) - (a.volume_24h_settle || 0);
      case 'exchange':
        return a.exchange.localeCompare(b.exchange) || Math.abs(b.funding_rate_per_hour) - Math.abs(a.funding_rate_per_hour);
      default:
        return 0;
    }
  }), [filtered, sortBy]);

  const positive = useMemo(() => sorted.filter((p) => p.funding_rate_per_hour > 0), [sorted]);
  const negative = useMemo(() => sorted.filter((p) => p.funding_rate_per_hour < 0), [sorted]);

  const stats = useMemo(() => {
    if (pairs.length === 0) return null;
    const totalVol = pairs.reduce((s, p) => s + (p.volume_24h_settle || 0), 0);
    const avgRate = pairs.reduce((s, p) => s + Math.abs(p.funding_rate_per_hour), 0) / pairs.length;
    const exCount = exchanges.length;
    return { totalVol, avgRate, exCount };
  }, [pairs, exchanges]);

  return (
    <div className="px-3 py-4 sm:px-4">
      {/* Hero Section */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center gap-2 mb-3">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-black text-white"
            style={{ background: 'linear-gradient(135deg, #3390ec, #1f4fb0)' }}
          >
            FF
          </div>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-[var(--text)] mb-2">
          {t('public.heroTitle')}
        </h1>
        <p className="text-sm sm:text-base text-[var(--text-muted)] max-w-lg mx-auto mb-4">
          {t('public.heroSubtitle')}
        </p>

        {/* Stats bar */}
        {stats && (
          <div className="flex justify-center gap-4 sm:gap-8 mb-4 text-center">
            <div>
              <div className="text-lg sm:text-xl font-bold text-[var(--text)]">{scanned}+</div>
              <div className="text-xs text-[var(--text-muted)]">{t('public.statPairs')}</div>
            </div>
            <div>
              <div className="text-lg sm:text-xl font-bold text-[var(--text)]">{stats.exCount}+</div>
              <div className="text-xs text-[var(--text-muted)]">{t('public.statExchanges')}</div>
            </div>
            <div>
              <div className="text-lg sm:text-xl font-bold text-[var(--text)]">
                ${(stats.totalVol / 1_000_000_000).toFixed(1)}B
              </div>
              <div className="text-xs text-[var(--text-muted)]">{t('public.statVolume')}</div>
            </div>
          </div>
        )}

        {/* Multi-CTA */}
        <div className="flex flex-col sm:flex-row justify-center gap-3">
          <a
            href="https://t.me/FundingFinderBot"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary text-sm py-2.5 px-6"
          >
            {t('public.ctaTelegram')}
          </a>
          <a
            href="/"
            className="btn btn-secondary text-sm py-2.5 px-6"
          >
            {t('public.ctaWeb')}
          </a>
        </div>
      </div>

      {generatedAt && (
        <div className="text-center text-xs text-[var(--text-muted)] mb-4">
          {t('public.updated')} {new Date(generatedAt).toLocaleTimeString()}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-[var(--text-muted)]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-3"></div>
          {t('common.loading')}
        </div>
      ) : error ? (
        <div className="text-center py-12 text-red-500">{error}</div>
      ) : pairs.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-muted)]">{t('public.noData')}</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="input-field text-sm"
            >
              <option value="rate_desc">{t('public.sortRateDesc')}</option>
              <option value="rate_asc">{t('public.sortRateAsc')}</option>
              <option value="volume">{t('public.sortVolume')}</option>
              <option value="exchange">{t('public.sortExchange')}</option>
            </select>
            <select
              value={filterExchange}
              onChange={(e) => setFilterExchange(e.target.value)}
              className="input-field text-sm"
            >
              <option value="">{t('public.allExchanges')}</option>
              {exchanges.map((ex) => (
                <option key={ex} value={ex}>{exchangeLabel(ex)}</option>
              ))}
            </select>
          </div>

          {positive.length > 0 && (
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-green-700 mb-2">{t('public.positiveRates')}</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                      <th className="pb-1 pr-2">{t('public.exchange')}</th>
                      <th className="pb-1 pr-2">{t('public.contract')}</th>
                      <th className="pb-1 pr-2 text-right">{t('public.ratePerHour')}</th>
                      <th className="pb-1 pr-2 text-right">{t('public.annualized')}</th>
                      <th className="pb-1 pr-2 text-right">{t('public.price')}</th>
                      <th className="pb-1 text-right">{t('public.volume24h')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positive.map((p, i) => (
                      <HeatmapRow key={`${p.exchange}-${p.contract}-${i}`} entry={p} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {negative.length > 0 && (
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-red-700 mb-2">{t('public.negativeRates')}</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                      <th className="pb-1 pr-2">{t('public.exchange')}</th>
                      <th className="pb-1 pr-2">{t('public.contract')}</th>
                      <th className="pb-1 pr-2 text-right">{t('public.ratePerHour')}</th>
                      <th className="pb-1 pr-2 text-right">{t('public.annualized')}</th>
                      <th className="pb-1 pr-2 text-right">{t('public.price')}</th>
                      <th className="pb-1 text-right">{t('public.volume24h')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {negative.map((p, i) => (
                      <HeatmapRow key={`${p.exchange}-${p.contract}-${i}`} entry={p} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Bottom CTA */}
      <div className="mt-6 p-4 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 text-center">
        <p className="text-sm font-medium text-blue-900 mb-2">{t('public.cta')}</p>
        <div className="flex justify-center gap-3">
          <a
            href="https://t.me/FundingFinderBot"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary text-sm py-2 px-4"
          >
            {t('public.loginTelegram')}
          </a>
          <a href="/" className="btn btn-secondary text-sm py-2 px-4">
            {t('public.ctaWeb')}
          </a>
        </div>
      </div>

      {/* FAQ Section */}
      <div className="mt-8 mb-4">
        <h2 className="text-lg font-bold text-[var(--text)] mb-4 text-center">{t('public.faqTitle')}</h2>
        <div className="space-y-2">
          {FAQ_ITEMS.map((item, idx) => (
            <div key={idx} className="rounded-xl overflow-hidden" style={{ background: 'var(--surface-2)' }}>
              <button
                onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                className="w-full p-3 text-left flex items-center justify-between gap-2"
              >
                <span className="text-sm font-semibold text-[var(--text)]">{t(item.q)}</span>
                <span
                  className="text-lg shrink-0 transition-transform"
                  style={{ color: 'var(--text-muted)', transform: openFaq === idx ? 'rotate(45deg)' : 'rotate(0deg)' }}
                >
                  +
                </span>
              </button>
              {openFaq === idx && (
                <div className="px-3 pb-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                  {t(item.a)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-6 border-t mt-6" style={{ borderColor: 'var(--border)' }}>
        <p className="text-xs text-[var(--text-muted)]">
          Funding Finder © {new Date().getFullYear()} · {t('public.footerNote')}
        </p>
        <div className="flex justify-center gap-4 mt-2">
          <a href="/terms" className="text-xs hover:underline" style={{ color: 'var(--brand)' }}>{t('public.termsLink')}</a>
          <a href="/privacy" className="text-xs hover:underline" style={{ color: 'var(--brand)' }}>{t('public.privacyLink')}</a>
        </div>
      </div>
    </div>
  );
}

function HeatmapRow({ entry }: { entry: HeatmapEntry }) {
  const rate = entry.funding_rate_per_hour;
  const pctH = (rate * 100).toFixed(4);
  const annPct = (entry.annualized_rate * 100).toFixed(1);
  const isPositive = rate > 0;

  const absRate = Math.abs(rate);
  let bgClass = '';
  if (absRate > 0.0005) bgClass = isPositive ? 'bg-green-100' : 'bg-red-100';
  else if (absRate > 0.0001) bgClass = isPositive ? 'bg-green-50' : 'bg-red-50';

  return (
    <tr className={clsx('border-b border-[var(--border)]', bgClass)}>
      <td className="py-1.5 pr-2 font-medium text-xs">{exchangeLabel(entry.exchange)}</td>
      <td className="py-1.5 pr-2 text-xs">{entry.contract}</td>
      <td className={clsx('py-1.5 pr-2 text-right text-xs font-semibold', isPositive ? 'text-green-700' : 'text-red-700')}>
        {isPositive ? '+' : ''}{pctH}%/h
      </td>
      <td className={clsx('py-1.5 pr-2 text-right text-xs', isPositive ? 'text-green-600' : 'text-red-600')}>
        {isPositive ? '+' : ''}{annPct}%
      </td>
      <td className="py-1.5 pr-2 text-right text-xs">${formatPrice(entry.mark_price)}</td>
      <td className="py-1.5 text-right text-xs text-[var(--text-muted)]">
        {entry.volume_24h_settle >= 1_000_000
          ? `${(entry.volume_24h_settle / 1_000_000).toFixed(1)}M`
          : entry.volume_24h_settle >= 1_000
            ? `${(entry.volume_24h_settle / 1_000).toFixed(0)}K`
            : entry.volume_24h_settle.toFixed(0)}
      </td>
    </tr>
  );
}
