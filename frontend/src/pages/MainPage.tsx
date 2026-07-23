import { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { useApp } from '../App';
import { useToast } from '../components/Toast';
import { PaywallModal } from '../components/PaywallModal';
import { PaywallFeature, PlanLimits } from '../utils/plans';
import { apiClient } from '../api/client';
import { formatNumber, formatPrice, getFundingColor } from '../utils/formatters';
import { openExchange, exchangeLabel } from '../utils/exchanges';
import { ExchangeSelector } from '../components/ExchangeSelector';
import { ExchangeSelect } from '../components/ExchangeSelect';
import { HistoryChart } from '../components/HistoryChart';
import { FundingCalendar } from '../components/FundingCalendar';
import { CountdownTimer } from '../components/CountdownTimer';
import { QuickStart } from '../components/QuickStart';
import { PairMatrix } from '../components/PairMatrix';
import { RiskProfileModal } from '../components/RiskProfileModal';
import { ResultSkeleton } from '../components/Skeleton';
import { ActivationChecklist } from '../components/ActivationChecklist';
import { ExchangeResult } from '../types';
import { useT, useI18n } from '../i18n';

type SortKey = 'rate' | 'volume' | 'interval';

export function MainPage() {
  const { scanResults, scanLoading, scanStatus, runScan, selectedExchanges, setSelectedExchanges, planLimits, watchlist, user } = useApp();
  const [showWatchlistOnly, setShowWatchlistOnly] = useState(false);
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [paywallFeature, setPaywallFeature] = useState<PaywallFeature | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [capital, setCapital] = useState(1000);
  const [aiText, setAiText] = useState('');
  const [recommendationsText, setRecommendationsText] = useState('');
  const [showAi, setShowAi] = useState(false);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [historyModal, setHistoryModal] = useState<{ exchange: string; contract: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showMatrix, setShowMatrix] = useState(false);
  const [showRisk, setShowRisk] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('rate');
  const [alertModal, setAlertModal] = useState<{ exchange: string; contract: string } | null>(null);
  const [alertCondition, setAlertCondition] = useState<'above' | 'below'>('above');
  const [alertThreshold, setAlertThreshold] = useState(0.01);
  const [alertCreating, setAlertCreating] = useState(false);
  // Bumped after each manual scan so the funding calendar (which polls on its
  // own timer) refreshes immediately instead of waiting up to 60s.
  const [calendarRefresh, setCalendarRefresh] = useState(0);
  const [exchangeFilter, setExchangeFilter] = useState<string[]>([]);
  const t = useT();
  const { lang } = useI18n();

  const handleScan = useCallback(async () => {
    if (selectedExchanges.length === 0) {
      showToast(t('main.selectExchangeError'), 'error');
      return;
    }
    setShowAi(false);
    setShowRecommendations(false);
    // Fire-and-continue: the scan runs in shared state and keeps going even if
    // the user switches tabs; results are stored centrally.
    await runScan(selectedExchanges);
    setCalendarRefresh((n) => n + 1);
  }, [selectedExchanges, runScan, showToast]);

  const handleShareCard = useCallback(async () => {
    if (!scanResults) return;
    try {
      const all = [
        ...(scanResults.highYield || []),
        ...(scanResults.mediumYield || []),
        ...(scanResults.lowYield || []),
      ];
      const opps = all.slice(0, 5).map((r: any) => ({
        pair: r.contract,
        exchangeA: r.exchange,
        exchangeB: r.exchange,
        annualReturn: r.annualized_rate ?? 0,
        rate: r.funding_rate_per_hour ?? 0,
      }));
      const { shareCardAsImage } = await import('../utils/shareCard');
      await shareCardAsImage(opps, { username: user?.username ? '@' + user.username : undefined, lang, referralCode: user?.referralCode });
    } catch (e) {
      showToast(t('main.shareError') || 'Не удалось создать картинку', 'error');
    }
  }, [scanResults, user, showToast, t, lang]);

  const handleAiAnalysis = useCallback(async () => {
    if (!scanResults) return;

    setActionLoading(true);
    setShowAi(true);
    setAiText(t('main.analyzing'));

    try {
      const listText = createListText(scanResults, t);
      const response: any = await apiClient.aiAnalyze(listText);
      if (response.ok && response.ai?.text) {
        setAiText(response.ai.text);
      } else {
        setAiText(response.ai?.note || t('main.aiNoResults'));
      }
    } catch (error) {
      setAiText(t('main.aiRequestErrorPrefix') + (error as Error).message);
    } finally {
      setActionLoading(false);
    }
  }, [scanResults]);

  const handleRecommendations = useCallback(async () => {
    if (!scanResults) return;

    setActionLoading(true);
    setShowRecommendations(true);
    setRecommendationsText(t('main.generatingRecs'));

    try {
      const allResults = [
        ...(scanResults.highYield || []),
        ...(scanResults.mediumYield || []),
      ];
      const response: any = await apiClient.getRecommendations(allResults, capital);
      if (response.ok && response.text) {
        setRecommendationsText(response.text);
      } else {
        setRecommendationsText(t('main.recsError'));
      }
    } catch (error) {
      setRecommendationsText(t('main.recsRequestErrorPrefix') + (error as Error).message);
    } finally {
      setActionLoading(false);
    }
  }, [scanResults, capital]);

  const handleCreateAlert = useCallback(async () => {
    if (!alertModal) return;
    setAlertCreating(true);
    try {
      const response: any = await apiClient.createGeneralAlert({
        pair: alertModal.contract,
        exchange: alertModal.exchange,
        condition: alertCondition,
        threshold: alertThreshold / 100, // convert from % to decimal
      });
      if (response.ok) {
        showToast(t('main.alertCreated'), 'success');
        setAlertModal(null);
      } else {
        showToast(t('main.alertCreateError', { error: response.error || t('main.unknownError') }), 'error');
      }
    } catch (error) {
      showToast(t('app.networkError', { error: (error as Error).message }), 'error');
    } finally {
      setAlertCreating(false);
    }
  }, [alertModal, alertCondition, alertThreshold, showToast]);

  const isPremium = planLimits.aiEnabled;

  const autoScanDone = useRef(false);

  useEffect(() => {
    if (!scanResults && selectedExchanges.length > 0 && !autoScanDone.current) {
      autoScanDone.current = true;
      runScan(selectedExchanges);
    }
  }, [runScan, scanResults, selectedExchanges]);

  // The single best actionable pick across all yield tiers — surfaces the
  // fastest route from "opened the app" to "open a position".
  const topPick = useMemo(() => {
    if (!scanResults) return null;
    const all = [...(scanResults.highYield || []), ...(scanResults.mediumYield || [])];
    if (all.length === 0) return null;
    return all.reduce((best, it) =>
      Math.abs(it.funding_rate_per_hour) > Math.abs(best.funding_rate_per_hour) ? it : best
    );
  }, [scanResults]);

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
          <h1 className="text-xl font-bold leading-tight text-[var(--text)]">Funding Finder</h1>
          <p className="text-sm text-muted leading-tight">{t('main.subtitle')}</p>
        </div>
      </div>

      <QuickStart hasScanResults={Boolean(scanResults)} selectedCount={selectedExchanges.length} />

      {!planLimits.aiEnabled && <ActivationChecklist />}

      <div className="card">
        <ExchangeSelector
          value={selectedExchanges}
          onChange={setSelectedExchanges}
          maxExchanges={planLimits.maxExchanges}
          onLimitReached={() => setPaywallFeature('exchanges')}
          title={t('main.selectExchanges')}
          showCount
        />

        <div className="mb-4">
            <label className="block text-sm font-medium text-[var(--text)] mb-1" htmlFor="capital-input">
              {t('main.capital')}
            </label>
          <input
            id="capital-input"
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

        <button
          onClick={handleScan}
          disabled={scanLoading}
          className="btn btn-primary w-full"
          aria-label="Scan exchanges for funding rates"
        >
            {scanLoading ? t('main.scanningBtn') : t('main.scanBtn')}
        </button>
      </div>

      <div className="rounded-xl p-3 text-center text-sm" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }} role="status">
        {scanStatus}
      </div>

      <FundingCalendar exchanges={selectedExchanges} refreshSignal={calendarRefresh} />

      {scanLoading && (
        <div className="card">
            <h2 className="text-lg font-semibold mb-3">{t('main.scanResults')}</h2>
            <ResultSkeleton />
        </div>
      )}

      {!scanLoading && scanResults && (
        <div className="card">
          <div className="flex items-center justify-between mb-3 gap-2">
            <h2 className="text-lg font-semibold">{t('main.scanResults')}</h2>
            <div className="flex gap-2">
              <button
                onClick={handleShareCard}
                className="btn btn-secondary text-sm py-1.5 px-3"
                title={t('main.shareCardTitle')}
              >
                🖼 {t('main.shareCard')}
              </button>
              <button
                onClick={() => navigate('/arbitrage')}
                className="btn btn-secondary text-sm py-1.5 px-3"
                title={t('main.arbSpreadsTitle')}
              >
                ↔ {t('main.arbitrage')}
              </button>
            </div>
          </div>

          {topPick && (
            <div
              className="rounded-xl p-4 mb-4 relative overflow-hidden"
              style={{ background: 'linear-gradient(135deg, var(--brand) 0%, var(--brand-hover) 100%)' }}
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-white opacity-95" title={t('main.bestOpportunityTitle')}>{t('main.bestOpportunity')}</div>
              <div className="flex items-end justify-between mt-1">
                <div>
                  <div className="text-xl font-bold text-white">{topPick.exchange.toUpperCase()}: {topPick.contract}</div>
                  <div className="text-white text-sm">
                    {t('main.topRateLine', { h: ((topPick.funding_rate_per_hour ?? 0) * 100).toFixed(6), d: ((topPick.funding_rate_per_day ?? 0) * 100).toFixed(4) })}
                  </div>
                </div>
                <button
                  onClick={() => openExchange(topPick.exchange, topPick.contract)}
                  className="btn text-sm py-2 px-4 shrink-0"
                  style={{ background: '#ffffff', color: 'var(--brand)' }}
                >
                  ↗ {t('main.openPositionBtn')}
                </button>
              </div>
            </div>
          )
}


          <div className="flex gap-2 mb-4">
            <input
              type="text"
              placeholder={t('main.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field flex-1 text-sm"
              aria-label="Search results"
            />
            <button
              onClick={() => setShowWatchlistOnly((v) => !v)}
              className={clsx('btn text-sm py-2 w-auto px-3', showWatchlistOnly ? 'btn-primary' : 'btn-secondary')}
              aria-pressed={showWatchlistOnly}
              title={t('main.watchlistOnlyTitle')}
            >
              ⭐ {watchlist.length}
            </button>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="input-field w-auto text-sm"
              aria-label="Sort results"
            >
              <option value="rate">{t('main.sortRate')}</option>
              <option value="volume">{t('main.sortVolume')}</option>
              <option value="interval">{t('main.sortInterval')}</option>
            </select>
          </div>

          <ExchangeSelect selected={exchangeFilter} onChange={setExchangeFilter} />


          {scanResults.metrics?.intervalDistribution && (
            <div className="mb-4 p-3 rounded-xl" style={{ background: 'var(--brand-soft)' }}>
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--brand)' }} title={t('main.intervalDistTitle')}>{t('main.intervalDist')}</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(scanResults.metrics.intervalDistribution).map(([interval, count]) => (
                  <span key={interval} className="text-xs px-2 py-1 rounded" style={{ background: 'var(--surface)', color: 'var(--text)' }}>
                    {interval}: {String(count)}
                  </span>
                ))}
              </div>
                <p className="text-xs mt-1" style={{ color: 'var(--brand)' }}>
                  {t('main.avgInterval', { x: scanResults.metrics.averageIntervalHours?.toFixed(1) || '8' })}
                </p>
            </div>
          )}

          {scanResults.highYield?.length > 0 && (
            <ResultSection
              title={t('main.highYield')}
              count={scanResults.highYield.length}
              items={scanResults.highYield.slice(0, 10)}
              limit={10}
              colorClass="text-green-700"
              onHistory={setHistoryModal}
              onAlert={setAlertModal}
              searchQuery={searchQuery}
              sortBy={sortBy}
              showWatchlistOnly={showWatchlistOnly}
              exchangeFilter={exchangeFilter}
              planLimits={planLimits}
              watchlistCount={watchlist.length}
              onWatchlistLimit={() => setPaywallFeature('watchlist')}
            />
          )}

          {scanResults.mediumYield?.length > 0 && (
            <ResultSection
              title={t('main.mediumYield')}
              count={scanResults.mediumYield.length}
              items={scanResults.mediumYield.slice(0, 10)}
              limit={10}
              colorClass="text-yellow-700"
              onHistory={setHistoryModal}
              onAlert={setAlertModal}
              searchQuery={searchQuery}
              sortBy={sortBy}
              showWatchlistOnly={showWatchlistOnly}
              exchangeFilter={exchangeFilter}
              planLimits={planLimits}
              watchlistCount={watchlist.length}
              onWatchlistLimit={() => setPaywallFeature('watchlist')}
            />
          )}

          {scanResults.lowYield?.length > 0 && (
            <ResultSection
              title={t('main.lowYield')}
              count={scanResults.lowYield.length}
              items={scanResults.lowYield.slice(0, 5)}
              limit={5}
              colorClass="text-gray-700"
              onHistory={setHistoryModal}
              onAlert={setAlertModal}
              searchQuery={searchQuery}
              sortBy={sortBy}
              showWatchlistOnly={showWatchlistOnly}
              exchangeFilter={exchangeFilter}
              planLimits={planLimits}
              watchlistCount={watchlist.length}
              onWatchlistLimit={() => setPaywallFeature('watchlist')}
            />
          )}

          <div className="flex gap-2 mt-4">
            <button
              onClick={() => planLimits.aiEnabled ? handleAiAnalysis() : setPaywallFeature('ai')}
              disabled={actionLoading || scanLoading}
              className="btn btn-secondary flex-1"
            >
               {t('main.aiAnalysis')} {!planLimits.aiEnabled && <span className="ml-1" aria-hidden="true">🔒</span>}
            </button>
            <button
              onClick={() => planLimits.recommendationsEnabled ? handleRecommendations() : setPaywallFeature('recommendations')}
              disabled={actionLoading || scanLoading}
              className="btn btn-success flex-1"
            >
               {t('main.recommendations')} {!planLimits.recommendationsEnabled && <span className="ml-1" aria-hidden="true">🔒</span>}
            </button>
          </div>
          <button
            onClick={() => setShowRisk(true)}
            className="btn btn-secondary text-sm py-2 w-full mt-2"
          >
            {t('main.riskProfile')}
          </button>
          {!isPremium && (
            <p className="text-xs text-center mt-2" style={{ color: 'var(--text-muted)' }}>
               {t('main.proOnly')}
            </p>
          )}

          <button
            onClick={() => setShowMatrix((v) => !v)}
            className="btn btn-secondary text-sm py-2 w-full mt-4"
            aria-expanded={showMatrix}
          >
            {showMatrix ? t('main.hideMatrix') : t('main.showMatrix')}
          </button>
          {showMatrix && (
            <div className="mt-3">
              <PairMatrix scanResults={scanResults} exchanges={selectedExchanges} />
            </div>
          )}
        </div>
      )}

      {showAi && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-2">{t('main.aiAnalysisTitle')}</h2>
          <pre className="bg-[var(--surface-2)] p-3 rounded-lg text-sm whitespace-pre-wrap overflow-auto max-h-96">
            {aiText}
          </pre>
        </div>
      )}

      {showRecommendations && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-2">{t('main.recommendationsTitle')}</h2>
          <pre className="bg-[var(--surface-2)] p-3 rounded-lg text-sm whitespace-pre-wrap overflow-auto max-h-96">
            {recommendationsText}
          </pre>
        </div>
      )}

      {historyModal && (
        <HistoryChart
          exchange={historyModal.exchange}
          contract={historyModal.contract}
          onClose={() => setHistoryModal(null)}
        />
      )}

      {alertModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="alert-dialog-title"
        >
           <div className="bg-surface rounded-xl max-w-md w-full">
            <div className="card">
              <h2 id="alert-dialog-title" className="text-lg font-semibold mb-2">{t('main.createAlert')}</h2>
              <p className="text-sm text-[var(--text-muted)] mb-4">
                {alertModal.exchange.toUpperCase()}: {alertModal.contract}
              </p>

              <div className="mb-4">
                  <label className="block text-sm font-medium text-[var(--text)] mb-1">{t('main.condition')}</label>
                <select
                  value={alertCondition}
                  onChange={(e) => setAlertCondition(e.target.value as 'above' | 'below')}
                  className="input-field"
                >
                  <option value="above">{t('main.above')}</option>
                  <option value="below">{t('main.below')}</option>
                </select>
              </div>

              <div className="mb-4">
                  <label className="block text-sm font-medium text-[var(--text)] mb-1" htmlFor="alert-threshold">
                    {t('main.threshold')}
                  </label>
                <input
                  id="alert-threshold"
                  type="number"
                  value={alertThreshold}
                  onChange={(e) => setAlertThreshold(Number(e.target.value) || 0)}
                  step={0.001}
                  min={0}
                  className="input-field"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setAlertModal(null)}
                  className="btn btn-secondary flex-1"
                >
                   {t('common.cancel')}
                </button>
                <button
                  onClick={handleCreateAlert}
                  disabled={alertCreating || alertThreshold <= 0}
                  className="btn btn-primary flex-1"
                >
                  {alertCreating ? t('main.creating') : t('common.create')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <PaywallModal
        open={paywallFeature !== null}
        feature={paywallFeature || 'exchanges'}
        onClose={() => setPaywallFeature(null)}
      />

      <RiskProfileModal
        open={showRisk}
        onClose={() => setShowRisk(false)}
        scanResults={scanResults}
        defaultCapital={capital}
      />
    </div>
  );
}

// Fetches live perp prices for the symbols the user is actually viewing.
// Prices are requested per exchange in one batched call and re-fetched every
// 15s only while the rows are on screen — we never parse the whole market.
function useLivePrices(items: ExchangeResult[]): Record<string, number> {
  const [prices, setPrices] = useState<Record<string, number>>({});

  // One request per tick for ALL exchanges via the unified /live/batch
  // endpoint — this is the fix that stops per-exchange polling from tripping
  // the rate limiter when many exchanges are selected. The response is keyed by
  // `${exchange}:${SYMBOL}`; we re-key to `${exchange}:${contract}` so the
  // existing ResultItem lookup keeps working.
  const byExchange = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const it of items) {
      (map[it.exchange] ||= []).push(it.contract);
    }
    return map;
  }, [items]);

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
        if (!res?.ok || !res.prices) return;
        const next: Record<string, number> = {};
        for (const [k, p] of Object.entries(res.prices as Record<string, number>)) {
          const [ex] = k.split(':');
          const contract = k.slice(ex.length + 1);
          next[`${ex}:${contract}`] = p;
        }
        if (!cancelled) setPrices(next);
      } catch {
        /* keep previous prices on transient error */
      }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [depKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return prices;
}

const ResultSection = memo(function ResultSection({
  title,
  count,
  items,
  limit,
  colorClass,
  onHistory,
  onAlert,
  searchQuery,
  sortBy,
  showWatchlistOnly,
  exchangeFilter = [],
  planLimits,
  watchlistCount,
  onWatchlistLimit,
}: {
  title: string;
  count: number;
  items: ExchangeResult[];
  limit: number;
  colorClass: string;
  onHistory: (data: { exchange: string; contract: string }) => void;
  onAlert: (data: { exchange: string; contract: string }) => void;
  searchQuery: string;
  sortBy: SortKey;
  showWatchlistOnly: boolean;
  exchangeFilter?: string[];
  planLimits: PlanLimits;
  watchlistCount: number;
  onWatchlistLimit: () => void;
}) {
  const { isWatchlisted } = useApp();
  const t = useT();
  const filtered = items.filter((item) => {
    if (exchangeFilter.length > 0 && !exchangeFilter.includes(item.exchange)) return false;
    if (showWatchlistOnly && !isWatchlisted(item.exchange, item.contract)) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return item.exchange.toLowerCase().includes(q) || item.contract.toLowerCase().includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'rate':
        return Math.abs(b.funding_rate_per_hour) - Math.abs(a.funding_rate_per_hour);
      case 'volume':
        return b.volume_24h_settle - a.volume_24h_settle;
      case 'interval':
        return (a.funding_interval_hours || 0) - (b.funding_interval_hours || 0);
      default:
        return 0;
    }
  });

  // Only the visible rows are ever shown / fetched — this is the optimization
  // that keeps price parsing cheap (no whole-market scan on every refresh).
  const visible = sorted.slice(0, limit);
  const priceMap = useLivePrices(visible);

  if (sorted.length === 0 && searchQuery) return null;

  return (
    <div className="mb-4">
      <h3 className={clsx('text-md font-medium mb-2', colorClass)}>
        {title} ({sorted.length}{sorted.length < count ? t('main.outOf', { count }) : ''})
      </h3>
      <div className="space-y-2">
        {visible.map((item) => (
          <ResultItem key={`${item.exchange}:${item.contract}`} item={item} livePrice={priceMap[`${item.exchange}:${item.contract}`]} onHistory={onHistory} onAlert={onAlert} planLimits={planLimits} watchlistCount={watchlistCount} onWatchlistLimit={onWatchlistLimit} />
        ))}
      </div>
    </div>
  );
});

const ResultItem = memo(function ResultItem({
  item,
  livePrice,
  onHistory,
  onAlert,
  planLimits,
  watchlistCount,
  onWatchlistLimit,
}: {
  item: ExchangeResult;
  livePrice?: number;
  onHistory: (data: { exchange: string; contract: string }) => void;
  onAlert: (data: { exchange: string; contract: string }) => void;
  planLimits: PlanLimits;
  watchlistCount: number;
  onWatchlistLimit: () => void;
}) {
  const { isWatchlisted, toggleWatchlist } = useApp();
  const t = useT();
  const starred = isWatchlisted(item.exchange, item.contract);
  const price = livePrice != null && !isNaN(livePrice) ? livePrice : item.mark_price;
  return (
    <div className="border-b border-[var(--border)] pb-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start">
        <div className="min-w-0">
          <strong className="text-sm break-words">{item.exchange.toUpperCase()}: {item.contract}</strong>
          <div className="text-xs text-[var(--text-muted)]">
            {t('main.volume', { v: formatNumber(item.volume_24h_settle) })}
          </div>
          <div className="text-xs flex items-center gap-1">
            <span className={clsx('inline-block w-2 h-2 rounded-full shrink-0', livePrice != null ? 'bg-green-500 animate-pulse' : 'bg-gray-400')} aria-hidden="true" />
            <span className="text-[var(--text)] font-semibold">${formatPrice(price)}</span>
            <span className="text-[var(--text-muted)]">{t('arb.live')}</span>
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {t('main.realRate', { r: ((item.currentFunding ?? 0) * 100).toFixed(4) })}
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {t('main.interval', { h: item.funding_interval_hours, s: item.funding_interval_source })}
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            <CountdownTimer intervalHours={item.funding_interval_hours} className="font-medium" />
            <span className="ml-1">{t('main.untilFunding')}</span>
          </div>
        </div>
        <div className="sm:text-right">
          <div className={clsx('font-bold break-words', getFundingColor(item.funding_rate_per_hour))}>
            {t('main.ratePerHour', { value: ((item.funding_rate_per_hour ?? 0) * 100).toFixed(4) })}
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {t('main.ratePerDay', { value: ((item.funding_rate_per_day ?? 0) * 100).toFixed(4) })}
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {t('main.ratePerYear', { value: (item.annualized_rate * 100)?.toFixed(2) })}
          </div>
          <div className="flex flex-wrap gap-1.5 justify-start sm:justify-end mt-1.5">
            <button
              onClick={() => {
                if (!starred && planLimits.watchlistLimit >= 0 && watchlistCount >= planLimits.watchlistLimit) {
                  onWatchlistLimit();
                  return;
                }
                toggleWatchlist(item.exchange, item.contract);
              }}
              className={clsx(
                'w-8 h-8 rounded-lg flex items-center justify-center transition-all shrink-0',
                starred
                  ? 'bg-yellow-100 text-yellow-600 border border-yellow-300'
                  : 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-yellow-50 hover:text-yellow-500'
              )}
              aria-label={`${starred ? 'Remove from' : 'Add to'} watchlist ${item.exchange} ${item.contract}`}
              aria-pressed={starred}
            >
              {starred ? '⭐' : '☆'}
            </button>
            <button
              onClick={() => onAlert({ exchange: item.exchange, contract: item.contract })}
              className="w-8 h-8 rounded-lg flex items-center justify-center bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100 transition-all shrink-0"
              aria-label={`Create alert for ${item.exchange} ${item.contract}`}
            >
              🔔
            </button>
            <button
              onClick={() => onHistory({ exchange: item.exchange, contract: item.contract })}
              className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 transition-all shrink-0"
              aria-label={`View history for ${item.exchange} ${item.contract}`}
            >
              📊
            </button>
            <button
              onClick={() => openExchange(item.exchange, item.contract)}
                className="h-8 px-3 sm:h-9 sm:px-4 rounded-lg flex items-center justify-center bg-green-600 text-white border border-green-600 hover:bg-green-700 transition-all text-xs font-semibold shrink-0"
              aria-label={`Open ${item.exchange} ${item.contract} on exchange`}
              title={t('main.openOnExchange', { contract: item.contract, exchange: exchangeLabel(item.exchange) })}
            >
              {t('main.open')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

function createListText(results: any, t: (key: string) => string) {
  let text = '';
  if (results.highYield?.length > 0) {
    text += t('main.listHighYield') + '\n';
    results.highYield.slice(0, 10).forEach((item: any) => {
      text += `${item.exchange.toUpperCase()}:${item.contract} | rate/h=${((item.funding_rate_per_hour ?? 0) * 100).toFixed(6)}% | interval=${item.funding_interval_hours}h | mark=${item.mark_price} | vol24=${item.volume_24h_settle}\n`;
    });
  }
  if (results.mediumYield?.length > 0) {
    text += '\n' + t('main.listMediumYield') + '\n';
    results.mediumYield.slice(0, 10).forEach((item: any) => {
      text += `${item.exchange.toUpperCase()}:${item.contract} | rate/h=${((item.funding_rate_per_hour ?? 0) * 100).toFixed(6)}% | interval=${item.funding_interval_hours}h | mark=${item.mark_price} | vol24=${item.volume_24h_settle}\n`;
    });
  }
  return text;
}

