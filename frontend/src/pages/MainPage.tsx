import { useState, useCallback, memo } from 'react';
import { clsx } from 'clsx';
import { useApp } from '../App';
import { useToast } from '../components/Toast';
import { apiClient } from '../api/client';
import { formatNumber, getFundingColor } from '../utils/formatters';
import { HistoryChart } from '../components/HistoryChart';
import { ResultSkeleton } from '../components/Skeleton';
import { ExchangeResult } from '../types';

const EXCHANGES = ['gate', 'binance', 'bybit', 'mexc', 'okx'] as const;

type SortKey = 'rate' | 'volume' | 'interval';

export function MainPage() {
  const { scanResults, scanLoading, scanStatus, runScan, selectedExchanges, setSelectedExchanges, user } = useApp();
  const { showToast } = useToast();
  const [actionLoading, setActionLoading] = useState(false);
  const [capital, setCapital] = useState(1000);
  const [aiText, setAiText] = useState('');
  const [recommendationsText, setRecommendationsText] = useState('');
  const [showAi, setShowAi] = useState(false);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [historyModal, setHistoryModal] = useState<{ exchange: string; contract: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('rate');

  const toggleExchange = useCallback((exchange: string) => {
    setSelectedExchanges((prev: string[]) =>
      prev.includes(exchange)
        ? prev.filter((e: string) => e !== exchange)
        : [...prev, exchange]
    );
  }, [setSelectedExchanges]);

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

  const isPremium = user?.id && (user as any).subscription !== 'basic';

  return (
    <div className="p-4">
      <div className="card">
        <h1 className="text-xl font-bold mb-2">Funding Finder</h1>
        <p className="text-gray-600 text-sm">Сканируйте биржи для поиска лучших ставок финансирования</p>
        <p className="text-gray-500 text-xs mt-1">Все ставки нормализованы к часовой базе для честного сравнения</p>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-3">Выберите биржи</h2>
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

      <div className="card bg-gray-50">
        <p className="text-center text-gray-600" role="status">{scanStatus}</p>
      </div>

      {scanLoading && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-3">Результаты сканирования</h2>
          <ResultSkeleton />
        </div>
      )}

      {!scanLoading && scanResults && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-3">Результаты сканирования</h2>

          <div className="flex gap-2 mb-4">
            <input
              type="text"
              placeholder="Поиск по бирже или контракту..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field flex-1 text-sm"
              aria-label="Search results"
            />
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
            <div className="mb-4 p-3 bg-blue-50 rounded-lg">
              <p className="text-sm font-medium text-blue-800 mb-1">Распределение интервалов:</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(scanResults.metrics.intervalDistribution).map(([interval, count]) => (
                  <span key={interval} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                    {interval}: {String(count)}
                  </span>
                ))}
              </div>
              <p className="text-xs text-blue-600 mt-1">
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
              searchQuery={searchQuery}
              sortBy={sortBy}
            />
          )}

          {scanResults.mediumYield?.length > 0 && (
            <ResultSection
              title="Средняя доходность"
              count={scanResults.mediumYield.length}
              items={scanResults.mediumYield.slice(0, 10)}
              colorClass="text-yellow-700"
              onHistory={setHistoryModal}
              searchQuery={searchQuery}
              sortBy={sortBy}
            />
          )}

          {scanResults.lowYield?.length > 0 && (
            <ResultSection
              title="Низкая доходность"
              count={scanResults.lowYield.length}
              items={scanResults.lowYield.slice(0, 5)}
              colorClass="text-gray-700"
              onHistory={setHistoryModal}
              searchQuery={searchQuery}
              sortBy={sortBy}
            />
          )}

          <div className="flex gap-2 mt-4">
            <button
              onClick={handleAiAnalysis}
              disabled={actionLoading || scanLoading || !isPremium}
              aria-disabled={!isPremium}
              className={clsx('btn btn-secondary flex-1', !isPremium && 'opacity-50 cursor-not-allowed')}
              title={!isPremium ? 'Требуется подписка Pro' : ''}
            >
              🧠 AI Анализ
            </button>
            <button
              onClick={handleRecommendations}
              disabled={actionLoading || scanLoading || !isPremium}
              aria-disabled={!isPremium}
              className={clsx('btn btn-success flex-1', !isPremium && 'opacity-50 cursor-not-allowed')}
              title={!isPremium ? 'Требуется подписка Pro' : ''}
            >
              🤖 Рекомендации
            </button>
          </div>
          {!isPremium && (
            <p className="text-xs text-gray-500 text-center mt-2">
              AI Анализ и Рекомендации доступны для подписчиков Pro
            </p>
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
    </div>
  );
}

const ResultSection = memo(function ResultSection({
  title,
  count,
  items,
  colorClass,
  onHistory,
  searchQuery,
  sortBy,
}: {
  title: string;
  count: number;
  items: ExchangeResult[];
  colorClass: string;
  onHistory: (data: { exchange: string; contract: string }) => void;
  searchQuery: string;
  sortBy: SortKey;
}) {
  const filtered = items.filter((item) => {
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
          <ResultItem key={`${item.exchange}:${item.contract}`} item={item} onHistory={onHistory} />
        ))}
      </div>
    </div>
  );
});

const ResultItem = memo(function ResultItem({
  item,
  onHistory,
}: {
  item: ExchangeResult;
  onHistory: (data: { exchange: string; contract: string }) => void;
}) {
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
          <button
            onClick={() => onHistory({ exchange: item.exchange, contract: item.contract })}
            className="text-xs text-telegram-blue hover:underline mt-1"
            aria-label={`View history for ${item.exchange} ${item.contract}`}
          >
            📊 История
          </button>
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
