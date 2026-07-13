import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { clsx } from 'clsx';
import { useApp } from '../App';
import { useToast } from '../components/Toast';
import { PaywallModal } from '../components/PaywallModal';
import { PaywallFeature } from '../utils/plans';
import { apiClient } from '../api/client';
import { formatNumber, getFundingColor } from '../utils/formatters';
import { openExchange, exchangeLabel, ALL_EXCHANGES } from '../utils/exchanges';
import { HistoryChart } from '../components/HistoryChart';
import { FundingCalendar } from '../components/FundingCalendar';
import { CountdownTimer } from '../components/CountdownTimer';
import { QuickStart } from '../components/QuickStart';
import { PairMatrix } from '../components/PairMatrix';
import { RiskProfileModal } from '../components/RiskProfileModal';
import { ResultSkeleton } from '../components/Skeleton';
import { ExchangeResult } from '../types';

const EXCHANGES = ALL_EXCHANGES as unknown as readonly string[];

type SortKey = 'rate' | 'volume' | 'interval';

export function MainPage() {
  const { scanResults, scanLoading, scanStatus, runScan, selectedExchanges, setSelectedExchanges, planLimits, watchlist } = useApp();
  const [showWatchlistOnly, setShowWatchlistOnly] = useState(false);
  const { showToast } = useToast();
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

  const toggleExchange = useCallback((exchange: string) => {
    setSelectedExchanges((prev: string[]) => {
      if (prev.includes(exchange)) {
        return prev.filter((e: string) => e !== exchange);
      }
      if (prev.length >= planLimits.maxExchanges) {
        setPaywallFeature('exchanges');
        return prev;
      }
      return [...prev, exchange];
    });
  }, [setSelectedExchanges, planLimits.maxExchanges]);

  const handleScan = useCallback(async () => {
    if (selectedExchanges.length === 0) {
      showToast('Выберите хотя бы одну биржу', 'error');
      return;
    }
    setShowAi(false);
    setShowRecommendations(false);
    // Fire-and-continue: the scan runs in shared state and keeps going even if
    // the user switches tabs; results are stored centrally.
    await runScan(selectedExchanges);
    setCalendarRefresh((n) => n + 1);
  }, [selectedExchanges, runScan, showToast]);

  const handleAiAnalysis = useCallback(async () => {
    if (!scanResults) return;

    setActionLoading(true);
    setShowAi(true);
    setAiText('Анализируем данные...');

    try {
      const listText = createListText(scanResults);
      const response: any = await apiClient.aiAnalyze(listText);
      if (response.ok && response.ai?.text) {
        setAiText(response.ai.text);
      } else {
        setAiText('AI не вернул результатов');
      }
    } catch (error) {
      setAiText('Ошибка при запросе AI: ' + (error as Error).message);
    } finally {
      setActionLoading(false);
    }
  }, [scanResults]);

  const handleRecommendations = useCallback(async () => {
    if (!scanResults) return;

    setActionLoading(true);
    setShowRecommendations(true);
    setRecommendationsText('Генерируем рекомендации...');

    try {
      const allResults = [
        ...(scanResults.highYield || []),
        ...(scanResults.mediumYield || []),
      ];
      const response: any = await apiClient.getRecommendations(allResults, capital);
      if (response.ok && response.text) {
        setRecommendationsText(response.text);
      } else {
        setRecommendationsText('Ошибка при генерации рекомендаций');
      }
    } catch (error) {
      setRecommendationsText('Ошибка при запросе рекомендаций: ' + (error as Error).message);
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
        showToast('Оповещение создано', 'success');
        setAlertModal(null);
      } else {
        showToast('Ошибка: ' + (response.error || 'Неизвестная ошибка'), 'error');
      }
    } catch (error) {
      showToast('Ошибка сети: ' + (error as Error).message, 'error');
    } finally {
      setAlertCreating(false);
    }
  }, [alertModal, alertCondition, alertThreshold, showToast]);

  const isPremium = planLimits.aiEnabled;

  // Auto-scan once on first visit so the user lands directly on opportunities
  // instead of having to press "Сканировать" before seeing anything.
  useEffect(() => {
    if (!scanResults && selectedExchanges.length > 0) {
      runScan(selectedExchanges);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <div className="p-4">
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-11 h-11 rounded-2xl flex items-center justify-center text-lg font-black text-white shrink-0"
          style={{ background: 'linear-gradient(135deg, #3390ec, #1f4fb0)' }}
        >
          FF
        </div>
        <div>
          <h1 className="text-xl font-bold leading-tight">Funding Finder</h1>
          <p className="text-sm text-muted leading-tight">Арбитраж ставок фандинга в реальном времени</p>
        </div>
      </div>

      <QuickStart hasScanResults={Boolean(scanResults)} selectedCount={selectedExchanges.length} />

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Выберите биржи</h2>
          <span className="chip" style={{ color: 'var(--text-muted)' }}>
            {selectedExchanges.length}/{planLimits.maxExchanges}
          </span>
        </div>
        <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="Exchange selection">
          {EXCHANGES.map((exchange) => (
            <button
              key={exchange}
              onClick={() => toggleExchange(exchange)}
              className={clsx('exchange-btn', selectedExchanges.includes(exchange) && 'active')}
              aria-pressed={selectedExchanges.includes(exchange)}
              aria-label={`${exchange} exchange`}
            >
              {exchange.charAt(0).toUpperCase() + exchange.slice(1)}
            </button>
          ))}
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="capital-input">
            Капитал (USDT):
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
          {scanLoading ? 'Сканирование...' : '🔎 Сканировать'}
        </button>
      </div>

      <div className="rounded-xl p-3 text-center text-sm" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }} role="status">
        {scanStatus}
      </div>

      <FundingCalendar exchanges={selectedExchanges} refreshSignal={calendarRefresh} />

      {scanLoading && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-3">Результаты сканирования</h2>
          <ResultSkeleton />
        </div>
      )}

      {!scanLoading && scanResults && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-3">Результаты сканирования</h2>

          {topPick && (
            <div
              className="rounded-xl p-4 mb-4 relative overflow-hidden"
              style={{ background: 'linear-gradient(135deg, var(--brand) 0%, var(--brand-hover) 100%)' }}
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-white opacity-80">🔥 Лучшая возможность</div>
              <div className="flex items-end justify-between mt-1">
                <div>
                  <div className="text-xl font-bold text-white">{topPick.exchange.toUpperCase()}: {topPick.contract}</div>
                  <div className="text-white opacity-90 text-sm">
                    {((topPick.funding_rate_per_hour ?? 0) * 100).toFixed(6)}%/ч · ≈ {((topPick.funding_rate_per_day ?? 0) * 100).toFixed(4)}%/день
                  </div>
                </div>
                <button
                  onClick={() => openExchange(topPick.exchange, topPick.contract)}
                  className="btn text-sm py-2 px-4 shrink-0"
                  style={{ background: '#ffffff', color: 'var(--brand)' }}
                >
                  ↗ Открыть позицию
                </button>
              </div>
            </div>
          )
}


          <div className="flex gap-2 mb-4">
            <input
              type="text"
              placeholder="Поиск по бирже или контракту..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field flex-1 text-sm"
              aria-label="Search results"
            />
            <button
              onClick={() => setShowWatchlistOnly((v) => !v)}
              className={clsx('btn text-sm py-2 w-auto px-3', showWatchlistOnly ? 'btn-primary' : 'btn-secondary')}
              aria-pressed={showWatchlistOnly}
              title="Только избранное"
            >
              ⭐ {watchlist.length}
            </button>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="input-field w-auto text-sm"
              aria-label="Sort results"
            >
              <option value="rate">По ставке</option>
              <option value="volume">По объёму</option>
              <option value="interval">По интервалу</option>
            </select>
          </div>


          {scanResults.metrics?.intervalDistribution && (
            <div className="mb-4 p-3 rounded-xl" style={{ background: 'var(--brand-soft)' }}>
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--brand)' }}>Распределение интервалов:</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(scanResults.metrics.intervalDistribution).map(([interval, count]) => (
                  <span key={interval} className="text-xs px-2 py-1 rounded" style={{ background: 'var(--surface)', color: 'var(--text)' }}>
                    {interval}: {String(count)}
                  </span>
                ))}
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--brand)' }}>
                Средний интервал: {scanResults.metrics.averageIntervalHours?.toFixed(1) || '8'}ч
              </p>
            </div>
          )}

          {scanResults.highYield?.length > 0 && (
            <ResultSection
              title="Высокая доходность"
              count={scanResults.highYield.length}
              items={scanResults.highYield.slice(0, 10)}
              colorClass="text-green-700"
              onHistory={setHistoryModal}
              onAlert={setAlertModal}
              searchQuery={searchQuery}
              sortBy={sortBy}
              showWatchlistOnly={showWatchlistOnly}
            />
          )}

          {scanResults.mediumYield?.length > 0 && (
            <ResultSection
              title="Средняя доходность"
              count={scanResults.mediumYield.length}
              items={scanResults.mediumYield.slice(0, 10)}
              colorClass="text-yellow-700"
              onHistory={setHistoryModal}
              onAlert={setAlertModal}
              searchQuery={searchQuery}
              sortBy={sortBy}
              showWatchlistOnly={showWatchlistOnly}
            />
          )}

          {scanResults.lowYield?.length > 0 && (
            <ResultSection
              title="Низкая доходность"
              count={scanResults.lowYield.length}
              items={scanResults.lowYield.slice(0, 5)}
              colorClass="text-gray-700"
              onHistory={setHistoryModal}
              onAlert={setAlertModal}
              searchQuery={searchQuery}
              sortBy={sortBy}
              showWatchlistOnly={showWatchlistOnly}
            />
          )}

          <div className="flex gap-2 mt-4">
            <button
              onClick={() => planLimits.aiEnabled ? handleAiAnalysis() : setPaywallFeature('ai')}
              disabled={actionLoading || scanLoading}
              className="btn btn-secondary flex-1"
            >
              🧠 AI Анализ {!planLimits.aiEnabled && <span className="ml-1" aria-hidden="true">🔒</span>}
            </button>
            <button
              onClick={() => planLimits.recommendationsEnabled ? handleRecommendations() : setPaywallFeature('recommendations')}
              disabled={actionLoading || scanLoading}
              className="btn btn-success flex-1"
            >
              🤖 Рекомендации {!planLimits.recommendationsEnabled && <span className="ml-1" aria-hidden="true">🔒</span>}
            </button>
          </div>
          <button
            onClick={() => setShowRisk(true)}
            className="btn btn-secondary text-sm py-2 w-full mt-2"
          >
            🎯 Риск-профиль (собрать корзину позиций)
          </button>
          {!isPremium && (
            <p className="text-xs text-center mt-2" style={{ color: 'var(--text-muted)' }}>
              🔒 AI Анализ и Рекомендации — только для подписчиков Pro
            </p>
          )}

          <button
            onClick={() => setShowMatrix((v) => !v)}
            className="btn btn-secondary text-sm py-2 w-full mt-4"
            aria-expanded={showMatrix}
          >
            {showMatrix ? '▾ Скрыть матрицу пар' : '▸ Матрица пар (спред по биржам)'}
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
          <h2 className="text-lg font-semibold mb-2">AI Анализ</h2>
          <pre className="bg-gray-50 p-3 rounded-lg text-sm whitespace-pre-wrap overflow-auto max-h-96">
            {aiText}
          </pre>
        </div>
      )}

      {showRecommendations && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-2">Рекомендации</h2>
          <pre className="bg-gray-50 p-3 rounded-lg text-sm whitespace-pre-wrap overflow-auto max-h-96">
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
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="alert-dialog-title"
        >
          <div className="bg-white rounded-xl max-w-sm w-full">
            <div className="card">
              <h2 id="alert-dialog-title" className="text-lg font-semibold mb-2">🔔 Создать оповещение</h2>
              <p className="text-sm text-gray-600 mb-4">
                {alertModal.exchange.toUpperCase()}: {alertModal.contract}
              </p>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Условие</label>
                <select
                  value={alertCondition}
                  onChange={(e) => setAlertCondition(e.target.value as 'above' | 'below')}
                  className="input-field"
                >
                  <option value="above">Выше</option>
                  <option value="below">Ниже</option>
                </select>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="alert-threshold">
                  Порог (% в час)
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
                  Отмена
                </button>
                <button
                  onClick={handleCreateAlert}
                  disabled={alertCreating || alertThreshold <= 0}
                  className="btn btn-primary flex-1"
                >
                  {alertCreating ? 'Создание...' : 'Создать'}
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

const ResultSection = memo(function ResultSection({
  title,
  count,
  items,
  colorClass,
  onHistory,
  onAlert,
  searchQuery,
  sortBy,
  showWatchlistOnly,
}: {
  title: string;
  count: number;
  items: ExchangeResult[];
  colorClass: string;
  onHistory: (data: { exchange: string; contract: string }) => void;
  onAlert: (data: { exchange: string; contract: string }) => void;
  searchQuery: string;
  sortBy: SortKey;
  showWatchlistOnly: boolean;
}) {
  const { isWatchlisted } = useApp();
  const filtered = items.filter((item) => {
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

  if (sorted.length === 0 && searchQuery) return null;

  return (
    <div className="mb-4">
      <h3 className={clsx('text-md font-medium mb-2', colorClass)}>
        {title} ({sorted.length}{sorted.length < count ? ` из ${count}` : ''})
      </h3>
      <div className="space-y-2">
        {sorted.map((item) => (
          <ResultItem key={`${item.exchange}:${item.contract}`} item={item} onHistory={onHistory} onAlert={onAlert} />
        ))}
      </div>
    </div>
  );
});

const ResultItem = memo(function ResultItem({
  item,
  onHistory,
  onAlert,
}: {
  item: ExchangeResult;
  onHistory: (data: { exchange: string; contract: string }) => void;
  onAlert: (data: { exchange: string; contract: string }) => void;
}) {
  const { isWatchlisted, toggleWatchlist } = useApp();
  const starred = isWatchlisted(item.exchange, item.contract);
  return (
    <div className="border-b border-gray-100 pb-2">
      <div className="flex justify-between items-start">
        <div>
          <strong className="text-sm">{item.exchange.toUpperCase()}: {item.contract}</strong>
          <div className="text-xs text-gray-500">
            Объем: {formatNumber(item.volume_24h_settle)} USD
          </div>
          <div className="text-xs text-gray-500">
            Цена: {formatNumber(item.mark_price)}
          </div>
          <div className="text-xs text-gray-500">
            Интервал: {item.funding_interval_hours}ч ({item.funding_interval_source})
          </div>
          <div className="text-xs text-gray-500">
            <CountdownTimer intervalHours={item.funding_interval_hours} className="font-medium" />
            <span className="ml-1">до фандинга</span>
          </div>
        </div>
        <div className="text-right">
          <div className={clsx('font-bold', getFundingColor(item.funding_rate_per_hour))}>
            {((item.funding_rate_per_hour ?? 0) * 100).toFixed(6)}%/ч
          </div>
          <div className="text-xs text-gray-500">
            ≈ {((item.funding_rate_per_day ?? 0) * 100).toFixed(4)}%/день
          </div>
          <div className="text-xs text-gray-500">
            ≈ {(item.annualized_rate * 100)?.toFixed(2)}%/год
          </div>
          <div className="flex gap-2 justify-end mt-1">
            <button
              onClick={() => toggleWatchlist(item.exchange, item.contract)}
              className={clsx('text-xs hover:underline', starred ? 'text-yellow-500' : 'text-gray-400')}
              aria-label={`${starred ? 'Remove from' : 'Add to'} watchlist ${item.exchange} ${item.contract}`}
              aria-pressed={starred}
            >
              {starred ? '⭐' : '☆'}
            </button>
            <button
              onClick={() => onAlert({ exchange: item.exchange, contract: item.contract })}
              className="text-xs text-orange-500 hover:underline"
              aria-label={`Create alert for ${item.exchange} ${item.contract}`}
            >
              🔔
            </button>
             <button
               onClick={() => onHistory({ exchange: item.exchange, contract: item.contract })}
               className="text-xs text-[var(--brand)] hover:underline"
               aria-label={`View history for ${item.exchange} ${item.contract}`}
             >
               📊
             </button>
             <button
               onClick={() => openExchange(item.exchange, item.contract)}
               className="text-xs text-green-600 hover:underline"
               aria-label={`Open ${item.exchange} ${item.contract} on exchange`}
               title={`Открыть ${item.contract} на ${exchangeLabel(item.exchange)}`}
             >
               ↗ Открыть
             </button>
          </div>
        </div>
      </div>
    </div>
  );
});

function createListText(results: any) {
  let text = '';
  if (results.highYield?.length > 0) {
    text += 'Высокая доходность (>0.01%/час):\n';
    results.highYield.slice(0, 10).forEach((item: any) => {
      text += `${item.exchange.toUpperCase()}:${item.contract} | rate/h=${((item.funding_rate_per_hour ?? 0) * 100).toFixed(6)}% | interval=${item.funding_interval_hours}h | mark=${item.mark_price} | vol24=${item.volume_24h_settle}\n`;
    });
  }
  if (results.mediumYield?.length > 0) {
    text += '\nСредняя доходность (0.001-0.01%/час):\n';
    results.mediumYield.slice(0, 10).forEach((item: any) => {
      text += `${item.exchange.toUpperCase()}:${item.contract} | rate/h=${((item.funding_rate_per_hour ?? 0) * 100).toFixed(6)}% | interval=${item.funding_interval_hours}h | mark=${item.mark_price} | vol24=${item.volume_24h_settle}\n`;
    });
  }
  return text;
}

