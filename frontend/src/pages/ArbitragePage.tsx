import { useState, useEffect, useCallback, useRef, memo, useMemo } from 'react';
import { clsx } from 'clsx';
import { useApp } from '../App';
import { useToast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SoftPaywallBanner } from '../components/SoftPaywallBanner';
import { apiClient } from '../api/client';
import { getRiskColor, formatPrice } from '../utils/formatters';
import { openExchange, exchangeLabel, getEstimatedExchangeLatency } from '../utils/exchanges';
import { CountdownTimer } from '../components/CountdownTimer';
import { ExchangeSelect } from '../components/ExchangeSelect';
import { FilterBar, FilterField, SegmentedControl } from '../components/FilterBar';
import { useT } from '../i18n';
import { SpotFuturesPanel } from '../components/SpotFuturesPanel';
import { Heatmap } from '../components/Heatmap';
import { openLoginModal } from '../components/WebHeader';
import { profitCalcClient, breakEvenDays, type ClientProfit } from '../utils/profitCalc';
import { LiquidationHeatmap } from '../components/LiquidationHeatmap';
import { LiveIndicator } from '../components/LiveIndicator';
import {
  IconAlertTriangle,
  IconBell,
  IconBellOff,
  IconCalculator,
  IconChartLine,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconSearch,
  IconTrash2,
  IconTrendingUp,
} from '../components/icons';
type ArbSortKey = 'apy' | 'daily' | 'hourly' | 'risk';
type RiskFilter = 'ALL' | 'LOW' | 'MEDIUM' | 'HIGH';

function haptic(kind: 'light' | 'success' | 'error') {
  try {
    const tg = (window as any).Telegram?.WebApp;
    if (kind === 'light') tg?.HapticFeedback?.impactOccurred?.('light');
    else tg?.HapticFeedback?.notificationOccurred?.(kind);
  } catch { /* no haptics available */ }
}

function cleanLabel(value: string): string {
  return value.replace(/[:：]\s*$/, '');
}

// Key used to store/lookup a live price for a (exchange, symbol) pair.
function livePriceKey(exchange: string, pair: string): string {
  return `${exchange}:${pair.toUpperCase()}`;
}

// Returns the live price if we have one, otherwise the static mark price from
// the last scan (so a card is never empty/NaN). `live` tells the UI whether the
// value is a fresh fetch or a fallback.
function resolvePrice(
  map: Record<string, number> | undefined,
  exchange: string,
  pair: string,
  fallback?: number
): { value: number; live: boolean } {
  const live = map?.[livePriceKey(exchange, pair)];
  if (typeof live === 'number' && isFinite(live) && live > 0) return { value: live, live: true };
  if (typeof fallback === 'number' && isFinite(fallback) && fallback > 0) return { value: fallback, live: false };
  return { value: NaN, live: false };
}

// Batches live perp prices AND funding rates for every symbol the user is
// currently viewing, grouped by exchange, and re-fetches every 10s. Values are
// merged (not replaced) so a transient error never wipes already-valid data —
// the card always shows something sane (and falls back to the scan's values).
interface LiveFunding {
  ratePerHour: number;
  intervalHours: number;
  rawRate: number;
  nextApply: number;
}

function useArbLivePrices(opps: any[], enabled = true): {
  prices: Record<string, number>;
  funding: Record<string, LiveFunding>;
  exchangeLatencies: Record<string, number>;
  latencyMs: number | null;
  lastUpdated: number | null;
} {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [funding, setFunding] = useState<Record<string, LiveFunding>>({});
  const [exchangeLatencies, setExchangeLatencies] = useState<Record<string, number>>({});
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const byExchange = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const o of opps) {
      if (o?.exchangeA) (map[o.exchangeA] ||= []).push(o.pair);
      if (o?.exchangeB) (map[o.exchangeB] ||= []).push(o.pair);
    }
    for (const ex of Object.keys(map)) map[ex] = [...new Set(map[ex])];
    return map;
  }, [opps]);

  // One request per tick for ALL exchanges via the unified /live/batch
  // endpoint — this is the fix that stops per-exchange polling from tripping
  // the rate limiter when many exchanges are selected.
  const depKey = useMemo(
    () => Object.entries(byExchange).map(([ex, syms]) => `${ex}:${[...syms].sort().join(',')}`).sort().join('|'),
    [byExchange]
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const requests = Object.entries(byExchange).map(([ex, syms]) => ({ exchange: ex, symbols: syms }));
    const load = async () => {
      try {
        if (requests.length === 0 || !enabled || document.hidden) return;
        const res: any = await apiClient.getLiveBatch(requests);
        if (!res?.ok) return;
        const nextPrices: Record<string, number> = {};
        const nextFunding: Record<string, LiveFunding> = {};
        for (const [k, p] of Object.entries(res.prices || {})) {
          if (typeof p === 'number' && isFinite(p) && p > 0) nextPrices[k] = p;
        }
        for (const [k, f] of Object.entries(res.funding || {})) {
          if (f && typeof (f as LiveFunding).ratePerHour === 'number' && isFinite((f as LiveFunding).ratePerHour)) {
            nextFunding[k] = f as LiveFunding;
          }
        }
        if (!cancelled) {
          setPrices((prev) => ({ ...prev, ...nextPrices }));
          setFunding((prev) => ({ ...prev, ...nextFunding }));
          if (res.latencies && typeof res.latencies === 'object') {
            setExchangeLatencies((prev) => ({ ...prev, ...res.latencies }));
          }
          setLatencyMs(res._latencyMs || apiClient.getLastLiveLatency() || null);
          setLastUpdated(Date.now());
        }
      } catch {
        /* keep previous data on transient error */
      }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [depKey, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return { prices, funding, exchangeLatencies, latencyMs, lastUpdated };
}

export function ArbitragePage() {
  const { user, arbOpportunities, arbAlerts, setArbAlerts, arbLoading, loadArbitrage, loadAlerts, liveFundingAt, subscription, arbError } = useApp();
  const { showToast } = useToast();
  const t = useT();
  const [activeTab, setActiveTab] = useState<'opportunities' | 'alerts' | 'spotfutures' | 'heatmap'>('opportunities');
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedOpportunity, setSelectedOpportunity] = useState<any>(null);
  const [capital, setCapital] = useState(1000);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [arbSortBy, setArbSortBy] = useState<ArbSortKey>('apy');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('ALL');
  const [exchangeFilter, setExchangeFilter] = useState<string[]>([]);
  const [minApy, setMinApy] = useState(0);
  const [pairQuery, setPairQuery] = useState('');
  const [syncSettlementOnly, setSyncSettlementOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(15);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const isGuest = !user?.provider || user.provider === 'guest';

  useEffect(() => {
    // Cache-first: these only fetch if data isn't already loaded (or in-flight),
    // so switching tabs keeps the previously loaded data instead of refetching.
    loadArbitrage();
    if (user?.id && !isGuest) loadAlerts();
  }, [user?.id, isGuest, loadArbitrage, loadAlerts]);

  // Live refresh: keep funding-rate opportunities fresh by re-fetching on an
  // interval (and whenever the server pushes fresh data over WebSocket).
  useEffect(() => {
    setLastUpdated(Date.now());
  }, [arbOpportunities, liveFundingAt]);

  useEffect(() => {
    // Background refreshes are silent: any transient miss keeps the last good
    // list on screen instead of spamming "can't load opportunities". Only the
    // first load and the manual 🔄 button surface errors.
    const id = setInterval(() => {
      if (!document.hidden) loadArbitrage(true, { silent: true });
    }, 90_000);
    const onVisible = () => {
      if (!document.hidden) loadArbitrage(true, { silent: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadArbitrage]);

  const handleToggleAlert = useCallback(async (alertId: string) => {
    try {
      const response: any = await apiClient.toggleArbitrageAlert(alertId);
      if (response.ok) {
        setArbAlerts((prev) =>
          prev.map((a) => (a.id === alertId ? { ...a, isActive: !a.isActive } : a))
        );
        showToast(t('arb.alertUpdated'), 'success');
      }
    } catch (error) {
      showToast(t('arb.alertUpdateError'), 'error');
    }
  }, [setArbAlerts, showToast]);

  const handleDeleteAlert = useCallback(async (alertId: string) => {
    try {
      const response: any = await apiClient.deleteArbitrageAlert(alertId);
      if (response.ok) {
        setArbAlerts((prev) => prev.filter((a) => a.id !== alertId));
        showToast(t('arb.alertDeleted'), 'success');
      }
    } catch (error) {
      showToast(t('arb.alertDeleteError'), 'error');
    }
  }, [setArbAlerts, showToast]);

  const confirmDelete = useCallback(() => {
    if (deleteConfirm) {
      handleDeleteAlert(deleteConfirm);
      setDeleteConfirm(null);
    }
  }, [deleteConfirm, handleDeleteAlert]);

  const filteredOpportunities = useMemo(() => {
    const q = pairQuery.trim().toLowerCase();
    const filtered = arbOpportunities.filter((o: any) => {
      if (riskFilter !== 'ALL' && (o.risk?.level || 'LOW') !== riskFilter) return false;
      if (exchangeFilter.length > 0 && !exchangeFilter.includes(o.exchangeA) && !exchangeFilter.includes(o.exchangeB)) {
        return false;
      }
      if (minApy > 0 && (o.profit?.annualReturn ?? 0) < minApy) return false;
      if (q && !o.pair.toLowerCase().includes(q)) return false;
      if (syncSettlementOnly) {
        const isSync = o.sameSettlementTime ?? (
          o.nextApplyA && o.nextApplyB
            ? Math.abs(o.nextApplyA - o.nextApplyB) < 60_000
            : o.intervalA_hours === o.intervalB_hours
        );
        if (!isSync) return false;
      }
      return true;
    });

    const sorted = [...filtered].sort((a: any, b: any) => {
      switch (arbSortBy) {
        case 'apy':
          return (b.profit?.annualReturn ?? 0) - (a.profit?.annualReturn ?? 0);
        case 'daily':
          return (b.difference_per_day ?? 0) - (a.difference_per_day ?? 0);
        case 'hourly':
          return (b.difference ?? 0) - (a.difference ?? 0);
        case 'risk': {
          const order: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
          const ra = order[a.risk?.level || 'LOW'] ?? 0;
          const rb = order[b.risk?.level || 'LOW'] ?? 0;
          if (ra !== rb) return ra - rb;
          return (b.profit?.annualReturn ?? 0) - (a.profit?.annualReturn ?? 0);
        }
        default:
          return 0;
      }
    });

    return sorted;
  }, [arbOpportunities, arbSortBy, riskFilter, exchangeFilter, minApy, pairQuery, syncSettlementOnly]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (arbSortBy !== 'apy') n++;
    if (riskFilter !== 'ALL') n++;
    if (exchangeFilter.length > 0) n++;
    if (minApy > 0) n++;
    if (pairQuery.trim()) n++;
    if (syncSettlementOnly) n++;
    return n;
  }, [arbSortBy, riskFilter, exchangeFilter, minApy, pairQuery, syncSettlementOnly]);

  const resetFilters = useCallback(() => {
    setArbSortBy('apy');
    setRiskFilter('ALL');
    setExchangeFilter([]);
    setMinApy(0);
    setPairQuery('');
    setSyncSettlementOnly(false);
    setVisibleCount(15);
  }, []);

  // Infinite scroll: auto-load more when sentinel becomes visible
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleCount((c) => c + 15);
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [filteredOpportunities.length]);

  // Live prices for the symbols the user is actually looking at. Refreshed
  // every 10s inside the hook; falls back to each opportunity's mark price.
  const visibleOpportunities = useMemo(
    () => (isGuest ? filteredOpportunities.slice(0, 1) : filteredOpportunities.slice(0, visibleCount)),
    [filteredOpportunities, visibleCount, isGuest]
  );
  const { prices: priceMap, funding: fundingMap, exchangeLatencies, latencyMs: liveLatency, lastUpdated: liveFetchedAt } = useArbLivePrices(visibleOpportunities, activeTab === 'opportunities');

  return (
    <div className="px-3 py-4 sm:px-4">
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center text-[13px] font-extrabold text-[var(--on-brand)] shrink-0 font-mono"
          style={{ background: 'var(--cobalt)' }}
        >
          ff
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold leading-tight text-[var(--text)]">{t('arb.title')}</h1>
          <p className="text-sm text-muted leading-tight truncate">{t('arb.subtitle')}</p>
        </div>
        <div className="shrink-0">
          <LiveIndicator latencyMs={liveLatency} lastUpdated={liveFetchedAt || lastUpdated} />
        </div>
      </div>

      <div className="tab-strip mb-4 flex items-center gap-2 overflow-x-auto no-scrollbar scroll-smooth pb-1" role="tablist">
        <button
          onClick={() => setActiveTab('opportunities')}
          className={clsx('py-2 px-3.5 sm:py-2.5 sm:px-4 rounded-xl font-medium transition-all shrink-0 text-xs sm:text-sm whitespace-nowrap', activeTab === 'opportunities' ? 'btn-primary' : 'btn-secondary')}
          role="tab"
          aria-selected={activeTab === 'opportunities'}
        >
          {t('arb.opportunities')}
        </button>
        <button
          onClick={() => setActiveTab('alerts')}
          className={clsx('py-2 px-3.5 sm:py-2.5 sm:px-4 rounded-xl font-medium transition-all shrink-0 text-xs sm:text-sm whitespace-nowrap', activeTab === 'alerts' ? 'btn-primary' : 'btn-secondary')}
          role="tab"
          aria-selected={activeTab === 'alerts'}
        >
          {t('arb.alerts')}
        </button>
        <button
          onClick={() => setActiveTab('spotfutures')}
          className={clsx('py-2 px-3.5 sm:py-2.5 sm:px-4 rounded-xl font-medium transition-all shrink-0 text-xs sm:text-sm whitespace-nowrap', activeTab === 'spotfutures' ? 'btn-primary' : 'btn-secondary')}
          role="tab"
          aria-selected={activeTab === 'spotfutures'}
        >
          {t('arb.spotFutures')}
        </button>
        <button
          onClick={() => setActiveTab('heatmap')}
          className={clsx('py-2 px-3.5 sm:py-2.5 sm:px-4 rounded-xl font-medium transition-all shrink-0 text-xs sm:text-sm whitespace-nowrap', activeTab === 'heatmap' ? 'btn-primary' : 'btn-secondary')}
          role="tab"
          aria-selected={activeTab === 'heatmap'}
        >
          {t('heatmap.title')}
        </button>
      </div>

      {activeTab === 'opportunities' && (
        <div className="card">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-semibold">{t('arb.arbOpportunities')}</h2>
            <button
              onClick={() => loadArbitrage(true)}
              disabled={arbLoading}
              className="btn btn-refresh text-sm py-2 px-4 w-auto"
            >
              {t('arb.refreshBtn')}
            </button>
          </div>

          {arbLoading && arbOpportunities.length === 0 ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="p-3 rounded-lg border border-[var(--border)] bg-[var(--card)] animate-pulse">
                  <div className="h-4 bg-[var(--bg2)] rounded w-1/3 mb-2" />
                  <div className="h-3 bg-[var(--bg2)] rounded w-1/2 mb-2" />
                  <div className="grid grid-cols-2 gap-2">
                    <div className="h-12 bg-[var(--bg2)] rounded" />
                    <div className="h-12 bg-[var(--bg2)] rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : arbError && arbOpportunities.length === 0 ? (
            <div className="text-center py-10 text-[var(--text-muted)]">
              <IconSearch size={40} className="mx-auto mb-3 text-[var(--text3)]" aria-hidden />
              <p className="font-medium">{t('arb.loadError')}</p>
              <p className="text-xs mt-1">{t('arb.loadErrorHint')}</p>
              <button
                onClick={() => loadArbitrage(true, { silent: true })}
                className="btn btn-primary text-sm py-2 px-4 mt-4"
              >
                {t('arb.retry')}
              </button>
            </div>
          ) : arbOpportunities.length === 0 ? (
            <div className="text-center py-10 text-[var(--text-muted)]">
              <IconSearch size={40} className="mx-auto mb-3 text-[var(--text3)]" aria-hidden />
              <p className="font-medium">{t('arb.noOpportunities')}</p>
              <p className="text-xs mt-1">{t('arb.noOpportunitiesHint')}</p>
              <button
                onClick={() => loadArbitrage(true, { silent: true })}
                className="btn btn-primary text-sm py-2 px-4 mt-4"
              >
                {t('arb.refreshBtn')}
              </button>
            </div>
          ) : (
            <>
              <FilterBar activeCount={activeFilterCount} title={t('filter.title')}>
                <FilterField label={t('filter.sort')}>
                  <select
                    value={arbSortBy}
                    onChange={(e) => setArbSortBy(e.target.value as ArbSortKey)}
                    className="input-field text-sm w-full"
                    aria-label={t('arb.sortAria')}
                  >
                    <option value="apy">{t('filter.sort.apy')}</option>
                    <option value="daily">{t('filter.sort.daily')}</option>
                    <option value="hourly">{t('filter.sort.hourly')}</option>
                    <option value="risk">{t('filter.sort.risk')}</option>
                  </select>
                </FilterField>

                <FilterField label={t('filter.minApy')}>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={minApy}
                    onChange={(e) => setMinApy(Math.max(0, Number(e.target.value) || 0))}
                    placeholder={t('arb.minApyPlaceholder')}
                    className="input-field text-sm w-full"
                    aria-label={t('arb.minApyAria')}
                  />
                </FilterField>

                <FilterField label={t('filter.risk')}>
                  <SegmentedControl<RiskFilter>
                    value={riskFilter}
                    onChange={setRiskFilter}
                    options={[
                       { value: 'ALL', label: t('filter.risk.all') },
                      { value: 'LOW', label: t('filter.risk.low') },
                      { value: 'MEDIUM', label: t('filter.risk.medium') },
                      { value: 'HIGH', label: t('filter.risk.high') },
                    ]}
                  />
                </FilterField>

                <ExchangeSelect selected={exchangeFilter} onChange={setExchangeFilter} />

                <FilterField label={t('filter.pair')}>
                  <input
                    type="text"
                    value={pairQuery}
                    onChange={(e) => setPairQuery(e.target.value)}
                    placeholder={t('arb.pairPlaceholder')}
                    className="input-field text-sm w-full"
                    aria-label={t('arb.pairAria')}
                  />
                </FilterField>

                <FilterField label={t('filter.settlementTiming')}>
                  <label className="flex items-start gap-2 cursor-pointer text-sm select-none py-1">
                    <input
                      type="checkbox"
                      checked={syncSettlementOnly}
                      onChange={(e) => setSyncSettlementOnly(e.target.checked)}
                      className="w-4 h-4 mt-0.5 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]"
                    />
                    <div>
                      <span className="font-medium text-[var(--text)]">{t('filter.syncFundingOnly')}</span>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">{t('filter.syncFundingHint')}</p>
                    </div>
                  </label>
                </FilterField>

                {activeFilterCount > 0 && (
                  <button onClick={resetFilters} className="btn btn-secondary text-sm py-2 w-full">
                    {t('common.resetFilters')}
                  </button>
                )}
              </FilterBar>

              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => setSyncSettlementOnly((prev) => !prev)}
                  className={clsx(
                    'text-xs font-semibold px-3 py-1.5 rounded-full border transition-all flex items-center gap-1.5 cursor-pointer',
                    syncSettlementOnly
                      ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-sm'
                      : 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border)] hover:border-[var(--text-muted)]'
                  )}
                  title={t('filter.syncFundingHint')}
                >
                  <span>⚡</span>
                  <span>{t('filter.syncFundingPill')}</span>
                  {syncSettlementOnly && <span className="ml-0.5 text-xs">✓</span>}
                </button>
              </div>

              {filteredOpportunities.length === 0 ? (
                  <div className="text-center py-8 text-[var(--text-muted)]">
                    <IconClock size={32} className="mx-auto mb-2 text-[var(--text3)]" aria-hidden />
                    <p>{t('arb.noFiltered')}</p>
                    <button onClick={resetFilters} className="btn btn-secondary text-xs mt-2 py-1.5 px-3">
                      {t('common.resetFilters')}
                    </button>
                  </div>
              ) : (
                <>
                  <div className="text-xs text-[var(--text-muted)] mb-2">
                    {t('arb.shown', { x: isGuest ? 1 : Math.min(visibleCount, filteredOpportunities.length), y: isGuest ? Math.max(filteredOpportunities.length, 6) : filteredOpportunities.length })}
                  </div>
                  <div className="space-y-3">
                    {(isGuest ? filteredOpportunities.slice(0, 1) : filteredOpportunities.slice(0, visibleCount)).map((opp) => (
                      <OpportunityCard
                        key={opp.id ?? `${opp.pair}-${opp.exchangeA}-${opp.exchangeB}`}
                        opportunity={opp}
                        priceMap={priceMap}
                        fundingMap={fundingMap}
                        exchangeLatencies={exchangeLatencies}
                        latencyMs={liveLatency}
                        onCalculate={() => {
                          setSelectedOpportunity(opp);
                          setShowModal(true);
                        }}
                      />
                    ))}
                  </div>

                  {isGuest && (
                    <div className="card text-center p-6 mt-4 border border-[var(--cobalt)]/40 bg-[var(--surface-2)]">
                      <div
                        className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3 text-xl font-extrabold shadow-sm"
                        style={{ background: 'var(--cobalt)', color: 'var(--on-brand)' }}
                      >
                        🔒
                      </div>
                      <h3 className="text-lg font-bold text-[var(--text)] mb-1">
                        {t('arb.guestTeaserTitle', { count: Math.max(3, filteredOpportunities.length > 1 ? filteredOpportunities.length - 1 : 7) })}
                      </h3>
                      <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto mb-4">
                        {t('arb.guestTeaserDesc')}
                      </p>
                      <button
                        onClick={() => openLoginModal()}
                        className="btn btn-primary text-sm py-2.5 px-6 mx-auto font-semibold shadow-md"
                      >
                        {t('arb.guestTeaserBtn')}
                      </button>
                    </div>
                  )}

                  {!isGuest && visibleCount < filteredOpportunities.length && (
                    <div ref={loadMoreRef} className="py-4 text-center text-xs text-[var(--text-muted)]">
                      {t('arb.loadingMore')}
                    </div>
                  )}
                  {!isGuest && visibleCount >= filteredOpportunities.length && filteredOpportunities.length > 15 && (
                    <div className="py-3 text-center text-xs text-[var(--text-muted)]">
                      {t('arb.allLoaded', { count: filteredOpportunities.length })}
                    </div>
                  )}

                  {!isGuest && subscription === 'free' && (
                    <div className="mt-3">
                      <SoftPaywallBanner
                        used={Math.min(visibleCount, 5)}
                        total={10}
                        featureLabel={t('arb.opportunities') || 'arbitrage scans'}
                      />
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

       {activeTab === 'spotfutures' && (
         <SpotFuturesPanel />
       )}

       {activeTab === 'heatmap' && (
         <Heatmap />
       )}

       {activeTab === 'alerts' && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-3">{t('arb.myAlerts')}</h2>

          {isGuest || !user?.id ? (
            <div className="text-center py-8 text-[var(--text-muted)]">
              <p className="mb-3">{t('arb.guestLoginPrompt') || t('arb.loginToManage')}</p>
              <button onClick={() => openLoginModal()} className="btn btn-primary text-sm py-2 px-5 mx-auto">
                {t('login.login') || 'Войти'}
              </button>
            </div>
          ) : arbAlerts.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-muted)]">{t('arb.noAlerts')}</div>
          ) : (
            <div className="space-y-2">
              {arbAlerts.map((alert) => (
                <div key={alert.id} className={clsx('p-3 rounded-lg border bg-[var(--card)]', alert.isActive ? 'border-[var(--green)] bg-[var(--green-soft)]' : 'border-[var(--border)] opacity-70')}>
                  <div className="flex justify-between items-start">
                    <div>
                      <strong className="font-mono">{alert.pair} ({alert.exchangeA} vs {alert.exchangeB})</strong>
                  <div className="text-sm text-[var(--text-muted)]">
                        {t('arb.conditionDiff', { threshold: alert.threshold })}
                      </div>
                      <div className="text-sm text-[var(--text-muted)]">
                          {t('arb.direction', { dir: alert.direction === 'both' ? t('arb.any') : alert.direction })}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { haptic('light'); handleToggleAlert(alert.id); }}
                        className="w-11 h-11 rounded-lg flex items-center justify-center bg-[var(--bg1)] border border-[var(--border)] active:opacity-80 transition-all"
                        aria-label={alert.isActive ? 'Disable alert' : 'Enable alert'}
                      >
                        {alert.isActive
                          ? <IconBellOff size={18} className="text-[var(--text2)]" aria-hidden />
                          : <IconBell size={18} className="text-[var(--text2)]" aria-hidden />}
                      </button>
                      <button
                        onClick={() => { haptic('light'); setDeleteConfirm(alert.id); }}
                        className="w-11 h-11 rounded-lg flex items-center justify-center bg-[var(--red-soft)] text-[var(--red)] border border-[var(--red)] active:opacity-80 transition-all"
                        aria-label="Delete alert"
                      >
                        <IconTrash2 size={18} aria-hidden />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showModal && selectedOpportunity && (
        <ProfitCalculator
          opportunity={selectedOpportunity}
          capital={capital}
          setCapital={setCapital}
          onClose={() => setShowModal(false)}
        />
      )}

      <ConfirmDialog
        open={deleteConfirm !== null}
        title={t('arb.deleteAlertTitle')}
        message={t('arb.deleteAlertMessage')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}

const OpportunityCard = memo(function OpportunityCard({
  opportunity: opp,
  priceMap,
  fundingMap,
  exchangeLatencies,
  latencyMs,
  onCalculate,
}: {
  opportunity: any;
  priceMap?: Record<string, number>;
  fundingMap?: Record<string, { ratePerHour: number; intervalHours: number; rawRate: number; nextApply: number }>;
  exchangeLatencies?: Record<string, number>;
  latencyMs?: number | null;
  onCalculate: () => void;
}) {
  const t = useT();
  const [showCalc, setShowCalc] = useState(false);
  const [showLiq, setShowLiq] = useState(false);
  const [calcCapital, setCalcCapital] = useState(1000);
  const priceA = resolvePrice(priceMap, opp.exchangeA, opp.pair, opp.markPriceA);
  const priceB = resolvePrice(priceMap, opp.exchangeB, opp.pair, opp.markPriceB);

  const calcProfit = useMemo<ClientProfit | null>(() => {
    if (!showCalc) return null;
    return profitCalcClient({
      exchangeA: opp.exchangeA,
      exchangeB: opp.exchangeB,
      difference: opp.difference,
      volumeA: opp.volumeA,
      volumeB: opp.volumeB,
    }, calcCapital);
  }, [showCalc, opp.exchangeA, opp.exchangeB, opp.difference, opp.volumeA, opp.volumeB, calcCapital]);
  // Live funding (falling back to the scan's values so the card is never blank).
  const fundA = fundingMap?.[livePriceKey(opp.exchangeA, opp.pair)];
  const fundB = fundingMap?.[livePriceKey(opp.exchangeB, opp.pair)];
  const fundingA = fundA ? fundA.ratePerHour : opp.fundingA_per_hour;
  const fundingB = fundB ? fundB.ratePerHour : opp.fundingB_per_hour;
  const intervalA = fundA ? fundA.intervalHours : opp.intervalA_hours;
  const intervalB = fundB ? fundB.intervalHours : opp.intervalB_hours;

  const nextApplyA = fundA?.nextApply || opp.nextApplyA;
  const nextApplyB = fundB?.nextApply || opp.nextApplyB;
  const isSync = opp.sameSettlementTime ?? (
    nextApplyA && nextApplyB
      ? Math.abs(nextApplyA - nextApplyB) < 60_000
      : intervalA === intervalB
  );

  const riskLevel = (opp.risk?.level || 'low').toLowerCase();
  const riskBadgeText = t(`arb.risk.${riskLevel}`) || opp.risk?.level || 'LOW';

  const labelA = exchangeLabel(opp.exchangeA);
  const labelB = exchangeLabel(opp.exchangeB);

  const strategyText = /SHORT on/i.test(opp.opportunity)
    ? t('arb.strategyShortLong', { shortEx: labelA, longEx: labelB }) || `SHORT on ${labelA}, LONG on ${labelB}`
    : t('arb.strategyLongShort', { longEx: labelA, shortEx: labelB }) || `LONG on ${labelA}, SHORT on ${labelB}`;

  return (
    <div className="opportunity-card">
      <div className="opportunity-head">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <strong className="text-base break-words font-mono">{opp.pair}</strong>
            <span className={clsx('text-xs px-2 py-1 rounded-full font-semibold', getRiskColor(opp.risk?.level))} title={t('arb.riskLevelTitle')}>
              {riskBadgeText}
            </span>
            {isSync ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--green-soft)] text-[var(--green)] border border-[var(--green)]/30 font-semibold flex items-center gap-1" title={t('arb.syncSettlementNotice')}>
                {t('arb.syncBadge', { hours: intervalA })}
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border)] font-medium flex items-center gap-1">
                {t('arb.asyncBadge', { hoursA: intervalA, hoursB: intervalB })}
              </span>
            )}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-2 font-mono" title={t('arb.untilFundingTitle')}>
            {isSync ? (
              <div className="inline-flex items-center gap-1.5 flex-wrap">
                <CountdownTimer intervalHours={intervalA} targetTimestamp={nextApplyA} className="font-semibold text-xs text-[var(--text)]" showProgress />
                <span className="text-[11px] text-[var(--text-muted)]">
                  {t('arb.untilFundingBoth', { exA: labelA, exB: labelB })}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 flex-wrap">
                <div className="inline-flex items-center gap-1 bg-[var(--surface-2)] border border-[var(--border)] px-2 py-0.5 rounded-md">
                  <span className="text-[10px] text-[var(--text-muted)] font-mono uppercase font-bold">{labelA}:</span>
                  <CountdownTimer intervalHours={intervalA} targetTimestamp={nextApplyA} className="font-semibold text-[11px] text-[var(--text)]" />
                </div>
                <div className="inline-flex items-center gap-1 bg-[var(--surface-2)] border border-[var(--border)] px-2 py-0.5 rounded-md">
                  <span className="text-[10px] text-[var(--text-muted)] font-mono uppercase font-bold">{labelB}:</span>
                  <CountdownTimer intervalHours={intervalB} targetTimestamp={nextApplyB} className="font-semibold text-[11px] text-[var(--text)]" />
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="opportunity-hero">
          <span className="hero-metric text-[var(--green)]" title={t('arb.apyTitle')}>
            {opp.profit?.annualReturn != null ? `${opp.profit.annualReturn.toFixed(1)}%` : '—'}
          </span>
          <span className="text-xs text-[var(--text-muted)]">{t('arb.netApy')}</span>
          {opp.score != null && (
            <span className="text-xs text-[var(--text2)] font-mono mt-2 text-right">
              {cleanLabel(t('arb.compositeScore'))} {opp.score.toFixed(1)}
            </span>
          )}
        </div>
      </div>

      <div className="strategy-summary">
        <span className="section-title">{cleanLabel(t('arb.strategy'))}</span>
        <strong>{strategyText}</strong>
      </div>

      <div className="section-block mt-4">
        <div className="section-title">{cleanLabel(t('arb.prices'))}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ExchangePriceCell
          exchange={opp.exchangeA}
          price={priceA}
          funding={fundingA}
          interval={intervalA}
          live={!!fundA}
          latencyMs={exchangeLatencies?.[opp.exchangeA] ?? opp.latencyA ?? latencyMs ?? getEstimatedExchangeLatency(opp.exchangeA)}
        />
        <ExchangePriceCell
          exchange={opp.exchangeB}
          price={priceB}
          funding={fundingB}
          interval={intervalB}
          live={!!fundB}
          latencyMs={exchangeLatencies?.[opp.exchangeB] ?? opp.latencyB ?? latencyMs ?? getEstimatedExchangeLatency(opp.exchangeB)}
        />
      </div>
      </div>

      {opp.intervalMismatch && (
        <div className="text-xs text-[var(--amber)] bg-[var(--amber-soft)] p-2 rounded-lg mb-2 font-mono">
          {t('arb.intervalMismatch', { a: opp.intervalA_hours, b: opp.intervalB_hours })}
        </div>
      )}

      <div className="section-block mt-4">
        <div className="section-title">{cleanLabel(t('arb.netDaily'))}</div>
      <div className="metric-stack">
          <div className="metric-row">
            <span className="metric-label">{cleanLabel(t('arb.fundingIncome'))}</span>
            <span className="metric-value">+${opp.profit?.grossDaily != null ? opp.profit.grossDaily.toFixed(2) : '0.00'} {t('unit.usdtPerDay')}</span>
          </div>
          <div className="metric-row">
            <span className="metric-label">{cleanLabel(t('arb.oneTimeCosts'))}</span>
            <span className="metric-value">${((opp.profit?.fees ?? 0) + (opp.profit?.slippage ?? 0)).toFixed(2)} USDT</span>
          </div>
        <div className="metric-row">
           <span className="metric-label">{cleanLabel(t('arb.netDaily'))}</span>
           <span className={clsx('metric-value text-base', (opp.profit?.netDaily ?? 0) >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>
            {(opp.profit?.netDaily ?? 0) >= 0 ? '+' : ''}${opp.profit?.netDaily?.toFixed(2)} USDT
          </span>
        </div>
        {(() => {
          const oneTimeCost = (opp.profit?.fees ?? 0) + (opp.profit?.slippage ?? 0);
          const grossDaily = opp.profit?.grossDaily ?? 0;
          if (grossDaily <= 0 || oneTimeCost <= 0) return null;
          const breakEven = oneTimeCost / grossDaily;
          const intervalHours = opp.intervalA_hours || 8;
          const cycles = Math.ceil(breakEven * 24 / intervalHours);
          return (
            <div className="metric-row">
              <span className="metric-label">{cleanLabel(t('arb.breakEven'))}</span>
              <strong className={clsx('metric-value', breakEven <= 30 ? 'text-[var(--green)]' : 'text-[var(--amber)]')}>
                ~{breakEven.toFixed(1)} {t('unit.daysShort')} · {cycles} {t('unit.settlementCycles')}
              </strong>
            </div>
          );
        })()}
      </div>
      </div>

      {opp.risk?.reasons?.length > 0 && (
        <div className="risk-notes">
          {opp.risk.reasons.map((r: string, i: number) => (
            <div key={i} className="flex items-center gap-1">
              <IconAlertTriangle size={12} aria-hidden className="shrink-0" /> {r}
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => { haptic('light'); openExchange(opp.exchangeA, opp.pair); setTimeout(() => openExchange(opp.exchangeB, opp.pair), 400); }}
         className="btn btn-primary text-sm py-2 w-full mt-3 mb-3"
        title={t('arb.openBothTitle', { pair: opp.pair, a: exchangeLabel(opp.exchangeA), b: exchangeLabel(opp.exchangeB) })}
      >
        {t('arb.openBoth', { a: exchangeLabel(opp.exchangeA), b: exchangeLabel(opp.exchangeB) })}
      </button>

       <details className="advanced-details mt-2">
        <summary>{t('arb.moreDetails')}</summary>
        <div className="details-grid">
          <div className="metric-row"><span className="metric-label">{cleanLabel(t('arb.grossLabel'))}</span><span className="metric-value">{opp.profit?.grossDaily != null ? `${(opp.profit.grossDaily / 1000 * 100).toFixed(1)}%` : '—'}</span></div>
          <div className="metric-row"><span className="metric-label">{cleanLabel(t('arb.fees'))}</span><span className="metric-value">{opp.profit?.fees != null ? `${(opp.profit.fees / 1000 * 100).toFixed(2)}%` : '—'}</span></div>
          <div className="metric-row"><span className="metric-label">{cleanLabel(t('arb.slippage'))}</span><span className="metric-value">{opp.profit?.slippage != null ? `${(opp.profit.slippage / 1000 * 100).toFixed(2)}%` : '—'}</span></div>
          {opp.accumulated && <div className="metric-row"><span className="metric-label">{cleanLabel(t('arb.accumulated'))}</span><span className="metric-value">1D {(opp.accumulated.d1 * 100).toFixed(2)}% · 7D {(opp.accumulated.d7 * 100).toFixed(2)}%</span></div>}
          <div className="text-xs text-[var(--text-muted)]" title={t('arb.oiSignalTitle')}>
            {(() => {
              const minVol = Math.min(opp.volumeA || 0, opp.volumeB || 0);
              const label = minVol > 10_000_000 ? t('arb.oiSignalHigh') : minVol > 1_000_000 ? t('arb.oiSignalMed') : minVol > 100_000 ? t('arb.oiSignalLow') : t('arb.oiSignalThin');
              return `${cleanLabel(t('arb.oiSignal'))}: ${label} (${minVol > 1_000_000 ? `${(minVol / 1_000_000).toFixed(1)}M` : `${(minVol / 1000).toFixed(0)}K`})`;
            })()}
          </div>
        </div>
        <div className="card-actions">
        <button
          onClick={() => { haptic('light'); setShowCalc(!showCalc); }}
          className="btn btn-success text-sm py-2 flex-[1.4]"
        >
          <IconCalculator size={16} className="inline mr-1" aria-hidden /> {showCalc ? t('arb.hideCalc') : t('arb.calculate')}
        </button>
        <button
          onClick={onCalculate}
          className="btn btn-secondary text-sm py-2 flex-1"
        >
          <IconChartLine size={16} className="inline mr-1" aria-hidden /> {t('arb.fullCalc')}
        </button>
        <button
          onClick={() => { haptic('light'); openExchange(opp.exchangeA, opp.pair); }}
          className="btn btn-secondary text-sm py-2 flex-1"
          title={t('arb.openOnExchange', { pair: opp.pair, ex: exchangeLabel(opp.exchangeA) })}
      >
          {t('arb.openEx', { ex: exchangeLabel(opp.exchangeA) })}
        </button>
        <button
          onClick={() => { haptic('light'); openExchange(opp.exchangeB, opp.pair); }}
          className="btn btn-secondary text-sm py-2 flex-1"
          title={t('arb.openOnExchange', { pair: opp.pair, ex: exchangeLabel(opp.exchangeB) })}
      >
          {t('arb.openEx', { ex: exchangeLabel(opp.exchangeB) })}
        </button>
        </div>
      </details>

      {showCalc && calcProfit && (
        <div className="mt-2 p-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
          <div className="flex items-center gap-2 mb-2">
            <label className="text-xs text-[var(--text-muted)] shrink-0">{t('arb.capital')}</label>
            <input
              type="number"
              min={100}
              max={1000000}
              value={calcCapital}
              onChange={(e) => setCalcCapital(Math.max(100, Math.min(1000000, Number(e.target.value) || 100)))}
              className="input-field text-xs py-1 flex-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <div className="text-[var(--text-muted)]">{t('arb.netDaily')}</div>
            <div className={clsx('font-bold text-right font-mono', calcProfit.netDaily >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>
              ${calcProfit.netDaily.toFixed(2)}
            </div>
            <div className="text-[var(--text-muted)]">{t('arb.netApy')}</div>
            <div className={clsx('font-bold text-right font-mono', calcProfit.netApr >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>
              {calcProfit.netApr.toFixed(1)}%
            </div>
            <div className="text-[var(--text-muted)]">{t('arb.fees')}</div>
            <div className="text-right font-mono">${calcProfit.fees.toFixed(2)}</div>
            <div className="text-[var(--text-muted)]">{t('arb.slippage')}</div>
            <div className="text-right font-mono">${calcProfit.slippage.toFixed(2)}</div>
            <div className="text-[var(--text-muted)]">{t('arb.breakEven')}</div>
            <div className="text-right font-mono">
              {(() => {
                const be = breakEvenDays(calcProfit);
                return (
                  <span className={be <= 30 ? 'text-[var(--green)]' : 'text-[var(--amber)]'}>
                    ~{be === Infinity ? '∞' : be.toFixed(1)} {t('unit.daysShort')}
                  </span>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {priceA.value > 0 && (
        <button
          onClick={() => { haptic('light'); setShowLiq(!showLiq); }}
          className="btn btn-secondary text-xs py-2 w-full mt-1 min-h-[44px]"
        >
          {showLiq ? <IconChevronDown size={14} className="inline mr-1" aria-hidden /> : <IconChevronRight size={14} className="inline mr-1" aria-hidden />} {t('arb.liqHeatmap')}
        </button>
      )}

      {showLiq && priceA.value > 0 && (
        <LiquidationHeatmap price={priceA.value} className="mt-1" />
      )}

    </div>
  );
});

// One exchange's live price + funding rate inside an arbitrage card. A green
// pulsing dot on the price means it's a fresh live fetch; gray means we're
// showing the last scan's mark price as a fallback (never blank/NaN). The price
// uses a precision-aware formatter so even very cheap coins show their real value.
function ExchangePriceCell({
  exchange,
  price,
  funding,
  interval,
  live,
  latencyMs,
}: {
  exchange: string;
  price: { value: number; live: boolean };
  funding: number;
  interval: number;
  live: boolean;
  latencyMs?: number | null;
}) {
  const t = useT();
  const valid = isFinite(price.value) && price.value > 0;
  const fundingColor = funding > 0 ? 'text-[var(--green)]' : funding < 0 ? 'text-[var(--red)]' : 'text-[var(--text2)]';
  const latencyDisplay = latencyMs && latencyMs > 0 ? (latencyMs < 1000 ? `${Math.round(latencyMs)}ms` : `${(latencyMs / 1000).toFixed(1)}s`) : null;

  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2 border border-[var(--border)]">
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs font-medium text-[var(--text-muted)] truncate" title={exchangeLabel(exchange)}>{exchangeLabel(exchange)}</span>
        <span className="flex items-center gap-1.5 shrink-0">
          {price.live && (
            <span className="live-label inline-flex items-center gap-1" title={latencyDisplay ? `Задержка обновления: ${latencyDisplay}` : undefined}>
              <span>{t('arb.live')}</span>
              {latencyDisplay && <span className="opacity-80 text-[10px] font-mono font-medium">· {latencyDisplay}</span>}
            </span>
          )}
          <span className="text-sm font-semibold font-mono text-[var(--text)]">${valid ? formatPrice(price.value) : '—'}</span>
        </span>
      </div>
      <div className="flex items-center justify-between mt-1.5 gap-1">
        <span className="text-xs text-[var(--text-muted)]">{t('arb.fundingRate')}</span>
        <span className="flex items-center gap-1.5 shrink-0">
          {live && (
            <span className="live-label inline-flex items-center gap-1" title={latencyDisplay ? `Задержка обновления: ${latencyDisplay}` : undefined}>
              <span>{t('arb.live')}</span>
              {latencyDisplay && <span className="opacity-80 text-[10px] font-mono font-medium">· {latencyDisplay}</span>}
            </span>
          )}
          <span className={clsx('text-xs font-semibold font-mono truncate max-w-full', fundingColor)} title={`${(funding * 100).toFixed(4)}%/${t('unit.hoursShort', { h: interval })}`}>
            {(funding * 100).toFixed(4)}{t('unit.pctPerHour')} ({t('unit.hoursShort', { h: interval })})
          </span>
        </span>
      </div>
    </div>
  );
}

function ProfitCalculator({
  opportunity,
  capital,
  setCapital,
  onClose,
}: {
  opportunity: any;
  capital: number;
  setCapital: (v: number) => void;
  onClose: () => void;
}) {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [backtest, setBacktest] = useState<any>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const { showToast } = useToast();
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const handleCalculate = useCallback(async () => {
    try {
      setLoading(true);
      const response: any = await apiClient.calculateProfit(opportunity, capital);
      if (response.ok) {
        setResult(response);
      }
    } catch (error) {
      showToast(t('arb.calcError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [opportunity, capital, showToast]);

  const handleBacktest = useCallback(async () => {
    try {
      setBacktestLoading(true);
      const response: any = await apiClient.getBacktest(
        opportunity.pair,
        opportunity.exchangeA,
        opportunity.exchangeB,
        capital,
        30,
      );
      if (response.ok) {
        setBacktest(response);
      } else {
        showToast(t('arb.backtestNoData'), 'info');
      }
    } catch {
      showToast(t('arb.backtestError'), 'error');
    } finally {
      setBacktestLoading(false);
    }
  }, [opportunity, capital, showToast]);

  return (
    <div
      className="fixed inset-0 bg-[rgba(5,7,12,0.5)] flex items-center justify-center z-50 p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="calculator-title"
    >
      <div className="bg-surface rounded-xl max-w-md w-full">
        <div className="card">
          <h2 id="calculator-title" className="text-lg font-semibold mb-2">{t('arb.profitCalc')}</h2>
          <div className="text-center mb-4">
            <div className="font-bold font-mono">{opportunity.pair}</div>
            <div className="text-sm text-[var(--text-muted)] font-mono">{opportunity.exchangeA} vs {opportunity.exchangeB}</div>
            <div className="text-[var(--green)] font-bold font-mono">{(opportunity.difference_per_day * 100).toFixed(4)}{t('unit.pctPerDay')}</div>
            {opportunity.intervalMismatch && (
               <div className="text-xs text-[var(--amber)]">{t('arb.intervalMismatchShort')}</div>
            )}
          </div>

          <div className="mb-4">
              <label className="block text-sm font-medium text-[var(--text)] mb-1" htmlFor="calc-capital">
              {t('arb.capital')}
            </label>
            <input
              id="calc-capital"
              type="number"
              value={capital}
              onChange={(e) => {
                const val = Math.max(100, Math.min(1000000, Number(e.target.value) || 100));
                setCapital(val);
              }}
              min={100}
              max={1000000}
              className="input-field"
            />
          </div>

          <button onClick={handleCalculate} disabled={loading} className="btn btn-success mb-3 w-full">
            {loading ? t('arb.calculating') : t('arb.calculateProfit')}
          </button>

          <button onClick={handleBacktest} disabled={backtestLoading} className="btn btn-secondary mb-4 w-full text-sm">
            {backtestLoading ? t('arb.calculating') : <span className="inline-flex items-center gap-1.5"><IconTrendingUp size={14} aria-hidden /> {t('arb.backtest')}</span>}
          </button>

          {result && (
            <div className="bg-[var(--surface-2)] p-3 rounded-lg">
              <div className="text-xs text-[var(--text-muted)] mb-2">
                {t('arb.netProfitNote')}
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm font-mono">
                <div className="font-sans">{t('arb.perHour')}</div>
                <div className={clsx('font-bold', result.profit.netHourly >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{result.profit.netHourly.toFixed(4)} USDT</div>
                <div className="font-sans">{t('arb.perDay')}</div>
                <div className={clsx('font-bold', result.profit.netDaily >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{result.profit.netDaily.toFixed(2)} USDT</div>
                <div className="font-sans">{t('arb.perWeek')}</div>
                <div className={clsx('font-bold', result.profit.netWeekly >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{result.profit.netWeekly.toFixed(2)} USDT</div>
                <div className="font-sans">{t('arb.perYear')}</div>
                <div className={clsx('font-bold', result.profit.netAnnual >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{result.profit.netAnnual.toFixed(2)} USDT</div>
              </div>
              <div className="mt-2 pt-2 border-t border-[var(--border)] font-mono">
                <div className="flex justify-between">
                  <span className="font-sans">{t('arb.annualReturn')}</span>
                  <strong className={result.profit.annualReturn >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}>{result.profit.annualReturn.toFixed(2)}%</strong>
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-[var(--border)]">
                {(() => {
                  const oneTimeCost = (result.profit.fees || 0) + (result.profit.slippage || 0);
                  const grossDaily = result.profit.grossDaily || 0;
                  const breakEven = grossDaily > 0 ? oneTimeCost / grossDaily : Infinity;
                  const intervalHours = opportunity.intervalA_hours || 8;
                  const cycles = Math.ceil(breakEven * 24 / intervalHours);
                  return (
                    <div className="flex justify-between text-sm font-mono">
                      <span className="font-sans">{t('arb.breakEven')}</span>
                      <strong className={breakEven > 0 && breakEven <= 30 ? 'text-[var(--green)]' : 'text-[var(--amber)]'}>
                        {t('arb.breakEvenValue', { days: breakEven.toFixed(1), cycles })}
                      </strong>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {backtest && backtest.available && (
            <div className="bg-[var(--surface-2)] p-3 rounded-lg mb-3">
              <div className="text-sm font-semibold mb-2 font-mono">{t('arb.backtest')} ({backtest.days}d)</div>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="text-[var(--text-muted)] font-sans">{t('arb.backtestDays')}</div>
                <div className="text-right">{backtest.daysWithSpread} / {backtest.totalDays}</div>
                <div className="text-[var(--text-muted)] font-sans">{t('arb.backtestWinRate')}</div>
                <div className={clsx('text-right font-bold', backtest.winRate >= 50 ? 'text-[var(--green)]' : 'text-[var(--amber)]')}>
                  {backtest.winRate.toFixed(0)}%
                </div>
                <div className="text-[var(--text-muted)] font-sans">{t('arb.backtestCumulative')}</div>
                <div className="text-right font-bold">{backtest.cumulativePct.toFixed(2)}%</div>
                <div className="text-[var(--text-muted)] font-sans">{t('arb.backtestAnnualized')}</div>
                <div className={clsx('text-right font-bold', backtest.annualizedPct >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>
                  {backtest.annualizedPct.toFixed(1)}%
                </div>
                <div className="text-[var(--text-muted)] font-sans">{t('arb.backtestProfit')}</div>
                <div className={clsx('text-right font-bold', backtest.totalProfit >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>
                  ${backtest.totalProfit.toFixed(2)}
                </div>
                <div className="text-[var(--text-muted)] font-sans">{t('arb.backtestMaxDD')}</div>
                <div className="text-right text-[var(--red)]">${backtest.maxDrawdown.toFixed(2)}</div>
              </div>
              {backtest.daily && backtest.daily.length > 0 && (
                <div className="mt-2 pt-2 border-t border-[var(--border)]">
                  <div className="text-xs text-[var(--text-muted)] mb-1">{t('arb.backtestDaily')}</div>
                  <div className="flex gap-px items-end h-12">
                    {backtest.daily.map((d: any, i: number) => {
                      const maxAbs = Math.max(...backtest.daily.map((x: any) => Math.abs(x.profitUsd)), 1);
                      const h = Math.abs(d.profitUsd) / maxAbs * 100;
                      return (
                        <div
                          key={i}
                          className={clsx('flex-1 rounded-t', d.profitUsd >= 0 ? 'bg-[var(--green)]' : 'bg-[var(--red)]')}
                          style={{ height: `${Math.max(4, h)}%` }}
                          title={`${d.date}: $${d.profitUsd.toFixed(2)}`}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {backtest && !backtest.available && (
            <div className="bg-[var(--surface-2)] p-3 rounded-lg mb-3 text-xs text-[var(--text-muted)] text-center">
              {t('arb.backtestNoData')}
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

