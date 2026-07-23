import { useState, useEffect, useCallback, useRef, memo, useMemo } from 'react';
import { clsx } from 'clsx';
import { useApp } from '../App';
import { useToast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { apiClient } from '../api/client';
import { getRiskColor, formatPrice } from '../utils/formatters';
import { openExchange, exchangeLabel } from '../utils/exchanges';
import { CountdownTimer } from '../components/CountdownTimer';
import { ExchangeSelect } from '../components/ExchangeSelect';
import { FilterBar, FilterField, SegmentedControl } from '../components/FilterBar';
import { useT } from '../i18n';
import { SpotFuturesPanel } from '../components/SpotFuturesPanel';
import { profitCalcClient, breakEvenDays, type ClientProfit } from '../utils/profitCalc';
import { LiquidationHeatmap } from '../components/LiquidationHeatmap';
type ArbSortKey = 'apy' | 'daily' | 'hourly' | 'risk';
type RiskFilter = 'ALL' | 'LOW' | 'MEDIUM' | 'HIGH';

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

function useArbLivePrices(opps: any[]): {
  prices: Record<string, number>;
  funding: Record<string, LiveFunding>;
} {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [funding, setFunding] = useState<Record<string, LiveFunding>>({});

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
  // the rate limiter when many exchanges are selected. The response is keyed by
  // `${exchange}:${SYMBOL}` so it maps straight onto livePriceKey.
  const depKey = useMemo(
    () => Object.entries(byExchange).map(([ex, syms]) => `${ex}:${[...syms].sort().join(',')}`).sort().join('|'),
    [byExchange]
  );

  useEffect(() => {
    let cancelled = false;
    const requests = Object.entries(byExchange).map(([ex, syms]) => ({ exchange: ex, symbols: syms }));
    const load = async () => {
      try {
        if (requests.length === 0) return;
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
        }
      } catch {
        /* keep previous data on transient error */
      }
    };
    load();
    const id = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [depKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return { prices, funding };
}

export function ArbitragePage() {
  const { user, arbOpportunities, arbAlerts, setArbAlerts, arbLoading, loadArbitrage, loadAlerts, liveFundingAt } = useApp();
  const { showToast } = useToast();
  const t = useT();
  const [activeTab, setActiveTab] = useState<'opportunities' | 'alerts' | 'spotfutures'>('opportunities');
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
  const [visibleCount, setVisibleCount] = useState(15);
  // Spot-Futures panel is hidden from the UI until the backend feature is
  // finished. The backend endpoint stays live for later completion; we only
  // gate the frontend via the backend's feature flag so it can be toggled
  // without a redeploy.
  const [spotFuturesEnabled, setSpotFuturesEnabled] = useState(false);

  useEffect(() => {
    apiClient.getFeatureFlags().then((flags: any[]) => {
      const f = flags.find((x) => x.name === 'spot_futures');
      setSpotFuturesEnabled(!!f?.enabled);
    });
  }, []);

  useEffect(() => {
    // Cache-first: these only fetch if data isn't already loaded (or in-flight),
    // so switching tabs keeps the previously loaded data instead of refetching.
    loadArbitrage();
    if (user?.id) loadAlerts();
  }, [user?.id, loadArbitrage, loadAlerts]);

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
  }, [arbOpportunities, arbSortBy, riskFilter, exchangeFilter, minApy, pairQuery]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (arbSortBy !== 'apy') n++;
    if (riskFilter !== 'ALL') n++;
    if (exchangeFilter.length > 0) n++;
    if (minApy > 0) n++;
    if (pairQuery.trim()) n++;
    return n;
  }, [arbSortBy, riskFilter, exchangeFilter, minApy, pairQuery]);

  const resetFilters = useCallback(() => {
    setArbSortBy('apy');
    setRiskFilter('ALL');
    setExchangeFilter([]);
    setMinApy(0);
    setPairQuery('');
    setVisibleCount(15);
  }, []);

  // Live prices for the symbols the user is actually looking at. Refreshed
  // every 10s inside the hook; falls back to each opportunity's mark price.
  const visibleOpportunities = useMemo(
    () => filteredOpportunities.slice(0, visibleCount),
    [filteredOpportunities, visibleCount]
  );
  const { prices: priceMap, funding: fundingMap } = useArbLivePrices(visibleOpportunities);

  return (
    <div className="px-3 py-4 sm:px-4">
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-11 h-11 rounded-2xl flex items-center justify-center text-lg font-black text-white shrink-0"
          style={{ background: 'linear-gradient(135deg, #3390ec, #1f4fb0)' }}
        >
          FF
        </div>
        <div>
          <h1 className="text-xl font-bold leading-tight text-[var(--text)]">{t('arb.title')}</h1>
          <p className="text-sm text-muted leading-tight">{t('arb.subtitle')}</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs shrink-0" title={lastUpdated ? t('arb.liveUpdated', { time: new Date(lastUpdated).toLocaleTimeString() }) : undefined}>
          <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" aria-hidden="true" />
          <span className="text-green-600 font-medium">{t('arb.live')}</span>
        </div>
      </div>

      <div className="flex gap-2 mb-4" role="tablist">
        <button
          onClick={() => setActiveTab('opportunities')}
          className={clsx('flex-1 py-2.5 rounded-xl font-medium transition-all', activeTab === 'opportunities' ? 'btn-primary' : 'btn-secondary')}
          role="tab"
          aria-selected={activeTab === 'opportunities'}
        >
          {t('arb.opportunities')}
        </button>
        <button
          onClick={() => setActiveTab('alerts')}
          className={clsx('flex-1 py-2.5 rounded-xl font-medium transition-all', activeTab === 'alerts' ? 'btn-primary' : 'btn-secondary')}
          role="tab"
          aria-selected={activeTab === 'alerts'}
        >
          {t('arb.alerts')}
        </button>
        {spotFuturesEnabled && (
          <button
            onClick={() => setActiveTab('spotfutures')}
            className={clsx('flex-1 py-2.5 rounded-xl font-medium transition-all', activeTab === 'spotfutures' ? 'btn-primary' : 'btn-secondary')}
            role="tab"
            aria-selected={activeTab === 'spotfutures'}
          >
            {t('arb.spotFutures')}
          </button>
        )}
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

          {arbLoading ? (
            <div className="text-center py-8 text-[var(--text-muted)]" role="status">{t('common.loading')}</div>
          ) : arbOpportunities.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-muted)]">{t('arb.noOpportunities')}</div>
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

                {activeFilterCount > 0 && (
                  <button onClick={resetFilters} className="btn btn-secondary text-sm py-2 w-full">
                    {t('common.resetFilters')}
                  </button>
                )}
              </FilterBar>

              {filteredOpportunities.length === 0 ? (
                  <div className="text-center py-8 text-[var(--text-muted)]">
                    {t('arb.noFiltered')}
                  </div>
              ) : (
                <>
                  <div className="text-xs text-[var(--text-muted)] mb-2">
                    {t('arb.shown', { x: Math.min(visibleCount, filteredOpportunities.length), y: filteredOpportunities.length })}
                  </div>
                  <div className="space-y-3">
                    {filteredOpportunities.slice(0, visibleCount).map((opp, idx) => (
                      <OpportunityCard
                        key={`${opp.pair}-${opp.exchangeA}-${opp.exchangeB}-${idx}`}
                        opportunity={opp}
                        priceMap={priceMap}
                        fundingMap={fundingMap}
                        onCalculate={() => {
                          setSelectedOpportunity(opp);
                          setShowModal(true);
                        }}
                      />
                    ))}
                  </div>
                  {visibleCount < filteredOpportunities.length && (
                    <button
                      onClick={() => setVisibleCount((c) => c + 15)}
                      className="btn btn-secondary text-sm py-2 w-full mt-3"
                    >
                      {t('arb.showMore', { n: filteredOpportunities.length - visibleCount })}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'spotfutures' && spotFuturesEnabled && (
        <SpotFuturesPanel />
      )}

      {activeTab === 'alerts' && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-3">{t('arb.myAlerts')}</h2>

          {!user?.id ? (
            <div className="text-center py-8 text-[var(--text-muted)]">{t('arb.loginToManage')}</div>
          ) : arbAlerts.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-muted)]">{t('arb.noAlerts')}</div>
          ) : (
            <div className="space-y-2">
              {arbAlerts.map((alert) => (
                <div key={alert.id} className={clsx('p-3 rounded-lg border-l-4', alert.isActive ? 'border-green-500 bg-green-50' : 'border-gray-400 bg-gray-50 opacity-70')}>
                  <div className="flex justify-between items-start">
                    <div>
                      <strong>{alert.pair} ({alert.exchangeA} vs {alert.exchangeB})</strong>
                  <div className="text-sm text-[var(--text-muted)]">
                        {t('arb.conditionDiff', { threshold: alert.threshold })}
                      </div>
                      <div className="text-sm text-[var(--text-muted)]">
                          {t('arb.direction', { dir: alert.direction === 'both' ? t('arb.any') : alert.direction })}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleToggleAlert(alert.id)}
                        className="w-9 h-9 rounded-lg flex items-center justify-center bg-[var(--surface-2)] border border-[var(--border)] hover:bg-[var(--border)] transition-all text-base"
                        aria-label={alert.isActive ? 'Disable alert' : 'Enable alert'}
                      >
                        {alert.isActive ? '🔕' : '🔔'}
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(alert.id)}
                        className="w-9 h-9 rounded-lg flex items-center justify-center bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-all text-base"
                        aria-label="Delete alert"
                      >
                        🗑️
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
  onCalculate,
}: {
  opportunity: any;
  priceMap?: Record<string, number>;
  fundingMap?: Record<string, { ratePerHour: number; intervalHours: number; rawRate: number; nextApply: number }>;
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
  return (
    <div className={clsx('p-3 rounded-lg border-l-4', getRiskColor(opp.risk?.level))}>
      <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:items-start mb-2">
        <div className="min-w-0">
          <strong className="break-words">{opp.pair}</strong>
          <span className={clsx('ml-2 text-xs px-2 py-0.5 rounded-full', getRiskColor(opp.risk?.level))} title={t('arb.riskLevelTitle')}>
            {opp.risk?.level}
          </span>
          {opp.persistenceGrade && (
            <span className={clsx('ml-1 text-xs px-1.5 py-0.5 rounded-full font-bold', {
              'bg-green-100 text-green-700': opp.persistenceGrade === 'A',
              'bg-blue-100 text-blue-700': opp.persistenceGrade === 'B',
              'bg-yellow-100 text-yellow-700': opp.persistenceGrade === 'C',
              'bg-orange-100 text-orange-700': opp.persistenceGrade === 'D',
              'bg-red-100 text-red-700': opp.persistenceGrade === 'F',
            })} title={t('arb.persistenceTitle')}>
              {t('arb.persistenceGrade', { grade: opp.persistenceGrade })}
            </span>
          )}
           <div className="text-xs text-[var(--text-muted)] mt-0.5" title={t('arb.untilFundingTitle')}>
              <CountdownTimer intervalHours={opp.intervalA_hours} className="font-medium" showProgress /> {t('arb.untilFundingEx', { ex: opp.exchangeA })}
          </div>
        </div>
        <div className="sm:text-right">
          <div className="flex items-baseline gap-1 justify-end">
            <span className="text-lg font-bold text-[var(--success)]" title={t('arb.apyTitle')}>
              {opp.profit?.annualReturn?.toFixed(1)}%
            </span>
            <span className="text-xs font-normal text-[var(--text-muted)]">{t('arb.netApy')}</span>
          </div>
           <div className="text-xs text-[var(--text-muted)]" title={t('arb.dailySpreadTitle')}>
            {t('arb.grossLabel')}: {(opp.profit?.grossDaily != null ? (opp.profit.grossDaily / 1000 * 100).toFixed(1) : '—')}% · {t('arb.fees')}: {(opp.profit?.fees != null ? (opp.profit.fees / 1000 * 100).toFixed(2) : '—')}% · {t('arb.slippage')}: {(opp.profit?.slippage != null ? (opp.profit.slippage / 1000 * 100).toFixed(2) : '—')}%
          </div>
          <div className="text-[10px] text-[var(--text-muted)] mt-0.5" title={t('arb.oiSignalTitle')}>
            {(() => {
              const minVol = Math.min(opp.volumeA || 0, opp.volumeB || 0);
              const label = minVol > 10_000_000 ? t('arb.oiSignalHigh') : minVol > 1_000_000 ? t('arb.oiSignalMed') : minVol > 100_000 ? t('arb.oiSignalLow') : t('arb.oiSignalThin');
              const color = minVol > 10_000_000 ? 'text-green-600' : minVol > 1_000_000 ? 'text-blue-600' : minVol > 100_000 ? 'text-yellow-600' : 'text-red-500';
              return <span className={color}>● {t('arb.oiSignal')}: {label} (${minVol > 1_000_000 ? `${(minVol / 1_000_000).toFixed(1)}M` : `${(minVol / 1_000).toFixed(0)}K`})</span>;
            })()}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-[var(--text-muted)]">{t('arb.prices')}</span>
        <span className="text-xs text-[var(--text-muted)]">{t('arb.live')}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        <ExchangePriceCell
          exchange={opp.exchangeA}
          price={priceA}
          funding={fundingA}
          interval={intervalA}
          live={!!fundA}
        />
        <ExchangePriceCell
          exchange={opp.exchangeB}
          price={priceB}
          funding={fundingB}
          interval={intervalB}
          live={!!fundB}
        />
      </div>

      {opp.intervalMismatch && (
        <div className="text-xs text-orange-600 mb-2 bg-orange-50 p-2 rounded">
          {t('arb.intervalMismatch', { a: opp.intervalA_hours, b: opp.intervalB_hours })}
        </div>
      )}

      <div className="text-sm mb-2">
          <div>{t('arb.fundingIncome')} +${opp.profit?.grossHourly?.toFixed(4)} {t('unit.usdtPerHour')} · +${opp.profit?.grossDaily?.toFixed(2)} {t('unit.usdtPerDay')}</div>
          <div>{t('arb.oneTimeCosts')} ${((opp.profit?.fees ?? 0) + (opp.profit?.slippage ?? 0)).toFixed(2)} USDT</div>
        <div>
           {t('arb.netDaily')} <span className={clsx((opp.profit?.netDaily ?? 0) >= 0 ? 'text-green-600' : 'text-red-500')}>
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
            <div className="text-xs text-[var(--text-muted)]">
              {t('arb.breakEven')}: <strong className={breakEven <= 30 ? 'text-green-600' : 'text-yellow-600'}>
                ~{breakEven.toFixed(1)} {t('unit.daysShort')} · {cycles} {t('unit.settlementCycles')}
              </strong>
            </div>
          );
        })()}
      </div>

      <div className="text-xs text-[var(--text-muted)] mb-2">
          {t('arb.fees')} ${opp.profit?.fees?.toFixed(2)} USDT | {t('arb.slippage')} ${opp.profit?.slippage?.toFixed(2)} USDT
      </div>

      <div className="text-sm bg-blue-50 p-2 rounded mb-2">
         <strong>{t('arb.strategy')}</strong> {opp.opportunity}
      </div>

      {opp.risk?.reasons?.length > 0 && (
        <div className="text-xs text-yellow-600 mb-2">
          {opp.risk.reasons.map((r: string, i: number) => (
            <div key={i}>⚠️ {r}</div>
          ))}
        </div>
      )}

      <button
        onClick={() => {
          openExchange(opp.exchangeA, opp.pair);
          setTimeout(() => openExchange(opp.exchangeB, opp.pair), 400);
        }}
        className="btn btn-primary text-sm py-2 w-full mb-2"
        title={t('arb.openBothTitle', { pair: opp.pair, a: exchangeLabel(opp.exchangeA), b: exchangeLabel(opp.exchangeB) })}
      >
        {t('arb.openBoth', { a: exchangeLabel(opp.exchangeA), b: exchangeLabel(opp.exchangeB) })}
      </button>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setShowCalc(!showCalc)}
          className="btn btn-success text-sm py-2 flex-[1.4]"
        >
          💰 {showCalc ? t('arb.hideCalc') : t('arb.calculate')}
        </button>
        <button
          onClick={onCalculate}
          className="btn btn-secondary text-sm py-2 flex-1"
        >
          📊 {t('arb.fullCalc')}
        </button>
        <button
          onClick={() => openExchange(opp.exchangeA, opp.pair)}
          className="btn btn-secondary text-sm py-2 flex-1"
          title={t('arb.openOnExchange', { pair: opp.pair, ex: exchangeLabel(opp.exchangeA) })}
      >
          {t('arb.openEx', { ex: exchangeLabel(opp.exchangeA) })}
        </button>
        <button
          onClick={() => openExchange(opp.exchangeB, opp.pair)}
          className="btn btn-secondary text-sm py-2 flex-1"
          title={t('arb.openOnExchange', { pair: opp.pair, ex: exchangeLabel(opp.exchangeB) })}
      >
          {t('arb.openEx', { ex: exchangeLabel(opp.exchangeB) })}
        </button>
      </div>

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
            <div className={clsx('font-bold text-right', calcProfit.netDaily >= 0 ? 'text-green-600' : 'text-red-500')}>
              ${calcProfit.netDaily.toFixed(2)}
            </div>
            <div className="text-[var(--text-muted)]">{t('arb.netApy')}</div>
            <div className={clsx('font-bold text-right', calcProfit.annualReturn >= 0 ? 'text-green-600' : 'text-red-500')}>
              {calcProfit.annualReturn.toFixed(1)}%
            </div>
            <div className="text-[var(--text-muted)]">{t('arb.fees')}</div>
            <div className="text-right">${calcProfit.fees.toFixed(2)}</div>
            <div className="text-[var(--text-muted)]">{t('arb.slippage')}</div>
            <div className="text-right">${calcProfit.slippage.toFixed(2)}</div>
            <div className="text-[var(--text-muted)]">{t('arb.breakEven')}</div>
            <div className="text-right">
              {(() => {
                const be = breakEvenDays(calcProfit);
                return (
                  <span className={be <= 30 ? 'text-green-600' : 'text-yellow-600'}>
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
          onClick={() => setShowLiq(!showLiq)}
          className="btn btn-secondary text-xs py-1.5 w-full mt-1"
        >
          {showLiq ? '▾' : '▸'} {t('arb.liqHeatmap')}
        </button>
      )}

      {showLiq && priceA.value > 0 && (
        <LiquidationHeatmap price={priceA.value} className="mt-1" />
      )}

      <p className="text-xs text-[var(--text-muted)] mt-2 text-center">
        💡 {t('arb.hint', { pair: opp.pair })}
      </p>
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
}: {
  exchange: string;
  price: { value: number; live: boolean };
  funding: number;
  interval: number;
  live: boolean;
}) {
  const t = useT();
  const valid = isFinite(price.value) && price.value > 0;
  const fundingColor = funding > 0 ? 'text-green-600' : funding < 0 ? 'text-red-600' : 'text-gray-600';
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2 border border-[var(--border)]">
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs font-medium text-[var(--text-muted)] truncate" title={exchangeLabel(exchange)}>{exchangeLabel(exchange)}</span>
        <span className="flex items-center gap-1.5 shrink-0">
          <span className={clsx('inline-block w-2 h-2 rounded-full', price.live ? 'bg-green-500 animate-pulse' : 'bg-gray-400')} aria-hidden="true" />
          <span className="text-sm font-semibold text-[var(--text)]">${valid ? formatPrice(price.value) : '—'}</span>
        </span>
      </div>
      <div className="flex items-center justify-between mt-1.5 gap-1">
        <span className="text-xs text-[var(--text-muted)]">{t('arb.fundingRate')}</span>
        <span className="flex items-center gap-1.5 shrink-0">
          <span className={clsx('inline-block w-2 h-2 rounded-full', live ? 'bg-green-500 animate-pulse' : 'bg-gray-400')} aria-hidden="true" />
          <span className={clsx('text-xs font-semibold truncate max-w-full', fundingColor)} title={`${(funding * 100).toFixed(4)}%/${t('unit.hoursShort', { h: interval })}`}>
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
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="calculator-title"
    >
      <div className="bg-surface rounded-xl max-w-md w-full">
        <div className="card">
          <h2 id="calculator-title" className="text-lg font-semibold mb-2">{t('arb.profitCalc')}</h2>
          <div className="text-center mb-4">
            <div className="font-bold">{opportunity.pair}</div>
            <div className="text-sm text-[var(--text-muted)]">{opportunity.exchangeA} vs {opportunity.exchangeB}</div>
            <div className="text-[var(--success)] font-bold">{(opportunity.difference_per_day * 100).toFixed(4)}{t('unit.pctPerDay')}</div>
            {opportunity.intervalMismatch && (
               <div className="text-xs text-[var(--warning)]">{t('arb.intervalMismatchShort')}</div>
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
            {backtestLoading ? t('arb.calculating') : `📈 ${t('arb.backtest')}`}
          </button>

          {result && (
            <div className="bg-[var(--surface-2)] p-3 rounded-lg">
              <div className="text-xs text-[var(--text-muted)] mb-2">
                {t('arb.netProfitNote')}
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>{t('arb.perHour')}</div>
                <div className={clsx('font-bold', result.profit.netHourly >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{result.profit.netHourly.toFixed(4)} USDT</div>
                <div>{t('arb.perDay')}</div>
                <div className={clsx('font-bold', result.profit.netDaily >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{result.profit.netDaily.toFixed(2)} USDT</div>
                <div>{t('arb.perWeek')}</div>
                <div className={clsx('font-bold', result.profit.netWeekly >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{result.profit.netWeekly.toFixed(2)} USDT</div>
                <div>{t('arb.perYear')}</div>
                <div className={clsx('font-bold', result.profit.netAnnual >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{result.profit.netAnnual.toFixed(2)} USDT</div>
              </div>
              <div className="mt-2 pt-2 border-t border-[var(--border)]">
                <div className="flex justify-between">
                  <span>{t('arb.annualReturn')}</span>
                  <strong className={clsx(result.profit.annualReturn >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{result.profit.annualReturn.toFixed(2)}%</strong>
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
                    <div className="flex justify-between text-sm">
                      <span>{t('arb.breakEven')}</span>
                      <strong className={breakEven > 0 && breakEven <= 30 ? 'text-green-600' : 'text-yellow-600'}>
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
              <div className="text-sm font-semibold mb-2">{t('arb.backtest')} ({backtest.days}d)</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="text-[var(--text-muted)]">{t('arb.backtestDays')}</div>
                <div className="text-right">{backtest.daysWithSpread} / {backtest.totalDays}</div>
                <div className="text-[var(--text-muted)]">{t('arb.backtestWinRate')}</div>
                <div className={clsx('text-right font-bold', backtest.winRate >= 50 ? 'text-green-600' : 'text-yellow-600')}>
                  {backtest.winRate.toFixed(0)}%
                </div>
                <div className="text-[var(--text-muted)]">{t('arb.backtestCumulative')}</div>
                <div className="text-right font-bold">{backtest.cumulativePct.toFixed(2)}%</div>
                <div className="text-[var(--text-muted)]">{t('arb.backtestAnnualized')}</div>
                <div className={clsx('text-right font-bold', backtest.annualizedPct >= 0 ? 'text-green-600' : 'text-red-500')}>
                  {backtest.annualizedPct.toFixed(1)}%
                </div>
                <div className="text-[var(--text-muted)]">{t('arb.backtestProfit')}</div>
                <div className={clsx('text-right font-bold', backtest.totalProfit >= 0 ? 'text-green-600' : 'text-red-500')}>
                  ${backtest.totalProfit.toFixed(2)}
                </div>
                <div className="text-[var(--text-muted)]">{t('arb.backtestMaxDD')}</div>
                <div className="text-right text-red-500">${backtest.maxDrawdown.toFixed(2)}</div>
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
                          className={clsx('flex-1 rounded-t', d.profitUsd >= 0 ? 'bg-green-400' : 'bg-red-400')}
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

