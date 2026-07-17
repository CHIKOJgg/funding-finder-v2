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
        <button
          onClick={() => setActiveTab('spotfutures')}
          className={clsx('flex-1 py-2.5 rounded-xl font-medium transition-all', activeTab === 'spotfutures' ? 'btn-primary' : 'btn-secondary')}
          role="tab"
          aria-selected={activeTab === 'spotfutures'}
        >
          {t('arb.spotFutures')}
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

      {activeTab === 'spotfutures' && (
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
  const priceA = resolvePrice(priceMap, opp.exchangeA, opp.pair, opp.markPriceA);
  const priceB = resolvePrice(priceMap, opp.exchangeB, opp.pair, opp.markPriceB);
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
           <div className="text-xs text-[var(--text-muted)] mt-0.5" title={t('arb.untilFundingTitle')}>
              <CountdownTimer intervalHours={opp.intervalA_hours} className="font-medium" /> {t('arb.untilFundingEx', { ex: opp.exchangeA })}
          </div>
        </div>
        <div className="sm:text-right">
          <div className="text-[var(--success)] font-bold break-words" title={t('arb.dailySpreadTitle')}>{(opp.difference_per_day * 100).toFixed(4)}{t('unit.pctPerDay')}</div>
          <div className="text-xs text-[var(--brand)] font-medium" title={t('arb.apyTitle')}>{opp.profit?.annualReturn?.toFixed(1)}% APY</div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-[var(--text-muted)]">{t('arb.prices')}</span>
        <span className="text-xs text-[var(--text-muted)]">{t('arb.live')}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
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
         <div>{t('arb.yearApy')} <strong>{opp.profit?.annualReturn?.toFixed(1)}%</strong></div>
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
          onClick={onCalculate}
          className="btn btn-success text-sm py-2 flex-[1.4]"
        >
          💰 {t('arb.calculate')}
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
          <span className={clsx('text-xs font-semibold', fundingColor)}>
            {(funding * 100).toFixed(6)}{t('unit.pctPerHour')} ({t('unit.hoursShort', { h: interval })})
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

          <button onClick={handleCalculate} disabled={loading} className="btn btn-success mb-4 w-full">
            {loading ? t('arb.calculating') : t('arb.calculateProfit')}
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

