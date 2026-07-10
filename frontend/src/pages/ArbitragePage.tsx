import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { clsx } from 'clsx';
import { useApp } from '../App';
import { useToast } from '../components/Toast';
import { apiClient } from '../api/client';
import { getRiskColor } from '../utils/formatters';
import { useWebSocket } from '../hooks/useWebSocket';

export function ArbitragePage() {
  const { user } = useApp();
  const { showToast } = useToast();
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'opportunities' | 'alerts'>('opportunities');
  const [showModal, setShowModal] = useState(false);
  const [selectedOpportunity, setSelectedOpportunity] = useState<any>(null);
  const [capital, setCapital] = useState(1000);

  const loadOpportunities = useCallback(async () => {
    try {
      setLoading(true);
      const response: any = await apiClient.getArbitrageOpportunities();
      if (response.ok) {
        setOpportunities(response.opportunities || []);
      }
    } catch (error) {
      console.error('Failed to load opportunities:', error);
      showToast('Не удалось загрузить возможности', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const loadAlerts = useCallback(async () => {
    try {
      const response: any = await apiClient.getArbitrageAlerts();
      if (response.ok) {
        setAlerts(response.alerts || []);
      }
    } catch (error) {
      console.error('Failed to load alerts:', error);
    }
  }, []);

  const initData = window.Telegram?.WebApp?.initData || null;
  useWebSocket(initData, {
    onScan: useCallback(() => {
      loadOpportunities();
    }, [loadOpportunities]),
    onAlertTriggered: useCallback(() => {
      loadAlerts();
      showToast('Получено новое оповещение!', 'success');
    }, [loadAlerts, showToast]),
  });

  useEffect(() => {
    loadOpportunities();
    if (user?.id) loadAlerts();
  }, [user?.id, loadOpportunities, loadAlerts]);

  const handleToggleAlert = useCallback(async (alertId: string) => {
    try {
      const response: any = await apiClient.toggleArbitrageAlert(alertId);
      if (response.ok) {
        setAlerts((prev) =>
          prev.map((a) => (a.id === alertId ? { ...a, isActive: !a.isActive } : a))
        );
        showToast('Оповещение обновлено', 'success');
      }
    } catch (error) {
      showToast('Не удалось обновить оповещение', 'error');
    }
  }, [showToast]);

  const handleDeleteAlert = useCallback(async (alertId: string) => {
    try {
      const response: any = await apiClient.deleteArbitrageAlert(alertId);
      if (response.ok) {
        setAlerts((prev) => prev.filter((a) => a.id !== alertId));
        showToast('Оповещение удалено', 'success');
      }
    } catch (error) {
      showToast('Не удалось удалить оповещение', 'error');
    }
  }, [showToast]);

  return (
    <div className="p-4">
      <div className="card">
        <h1 className="text-xl font-bold mb-2">Арбитраж и Оповещения</h1>
        <p className="text-gray-600 text-sm">Управляйте арбитражными возможностями и оповещениями</p>
        <p className="text-gray-500 text-xs mt-1">Все ставки нормализованы к часовой базе</p>
      </div>

      <div className="flex gap-2 mb-4" role="tablist">
        <button
          onClick={() => setActiveTab('opportunities')}
          className={clsx('flex-1 py-2 rounded-lg font-medium', activeTab === 'opportunities' ? 'bg-telegram-blue text-white' : 'bg-gray-200')}
          role="tab"
          aria-selected={activeTab === 'opportunities'}
        >
          Возможности
        </button>
        <button
          onClick={() => setActiveTab('alerts')}
          className={clsx('flex-1 py-2 rounded-lg font-medium', activeTab === 'alerts' ? 'bg-telegram-blue text-white' : 'bg-gray-200')}
          role="tab"
          aria-selected={activeTab === 'alerts'}
        >
          Оповещения
        </button>
      </div>

      {activeTab === 'opportunities' && (
        <div className="card">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-semibold">Арбитражные возможности</h2>
            <button onClick={loadOpportunities} disabled={loading} className="text-sm text-telegram-blue">
              🔄 Обновить
            </button>
          </div>

          {loading ? (
            <div className="text-center py-8 text-gray-500" role="status">Загрузка...</div>
          ) : opportunities.length === 0 ? (
            <div className="text-center py-8 text-gray-500">Арбитражные возможности не найдены</div>
          ) : (
            <div className="space-y-3">
              {opportunities.slice(0, 15).map((opp, idx) => (
                <OpportunityCard
                  key={`${opp.pair}-${opp.exchangeA}-${opp.exchangeB}-${idx}`}
                  opportunity={opp}
                  onCalculate={() => {
                    setSelectedOpportunity(opp);
                    setShowModal(true);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'alerts' && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-3">Мои оповещения</h2>

          {!user?.id ? (
            <div className="text-center py-8 text-gray-500">Войдите в систему для управления оповещениями</div>
          ) : alerts.length === 0 ? (
            <div className="text-center py-8 text-gray-500">У вас нет оповещений</div>
          ) : (
            <div className="space-y-2">
              {alerts.map((alert) => (
                <div key={alert.id} className={clsx('p-3 rounded-lg border-l-4', alert.isActive ? 'border-green-500 bg-green-50' : 'border-gray-400 bg-gray-50 opacity-70')}>
                  <div className="flex justify-between items-start">
                    <div>
                      <strong>{alert.pair} ({alert.exchangeA} vs {alert.exchangeB})</strong>
                      <div className="text-sm text-gray-600">
                        Условие: Разница {'>'} {alert.threshold}
                      </div>
                      <div className="text-sm text-gray-600">
                        Направление: {alert.direction === 'both' ? 'Любое' : alert.direction}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleToggleAlert(alert.id)}
                        className="text-sm"
                        aria-label={alert.isActive ? 'Disable alert' : 'Enable alert'}
                      >
                        {alert.isActive ? '🔕' : '🔔'}
                      </button>
                      <button
                        onClick={() => handleDeleteAlert(alert.id)}
                        className="text-sm text-red-500"
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
    </div>
  );
}

const OpportunityCard = memo(function OpportunityCard({
  opportunity: opp,
  onCalculate,
}: {
  opportunity: any;
  onCalculate: () => void;
}) {
  return (
    <div className={clsx('p-3 rounded-lg border-l-4', getRiskColor(opp.risk?.level))}>
      <div className="flex justify-between items-start mb-2">
        <div>
          <strong>{opp.pair}</strong>
          <span className={clsx('ml-2 text-xs px-2 py-0.5 rounded-full', getRiskColor(opp.risk?.level))}>
            {opp.risk?.level}
          </span>
        </div>
        <div className="text-right">
          <div className="text-green-500 font-bold">{(opp.difference_per_day * 100).toFixed(4)}%/день</div>
          <div className="text-xs text-blue-500">{opp.profit?.annualReturn?.toFixed(1)}% APY</div>
        </div>
      </div>

      <div className="text-sm text-gray-600 mb-2">
        <div className="flex justify-between">
          <span>{opp.exchangeA}:</span>
          <span>{(opp.fundingA_per_hour * 100).toFixed(6)}%/ч ({opp.intervalA_hours}ч)</span>
        </div>
        <div className="flex justify-between">
          <span>{opp.exchangeB}:</span>
          <span>{(opp.fundingB_per_hour * 100).toFixed(6)}%/ч ({opp.intervalB_hours}ч)</span>
        </div>
      </div>

      {opp.intervalMismatch && (
        <div className="text-xs text-orange-600 mb-2 bg-orange-50 p-2 rounded">
          ⚠️ Разные интервалы финансирования ({opp.intervalA_hours}ч vs {opp.intervalB_hours}ч)
        </div>
      )}

      <div className="text-sm mb-2">
        <div>Доход фандинга: +${opp.profit?.grossHourly?.toFixed(4)}/ч · +${opp.profit?.grossDaily?.toFixed(2)}/день</div>
        <div>Разовые издержки (вход/выход): ${((opp.profit?.fees ?? 0) + (opp.profit?.slippage ?? 0)).toFixed(2)}</div>
        <div>
          Чистыми за день: <span className={clsx((opp.profit?.netDaily ?? 0) >= 0 ? 'text-green-600' : 'text-red-500')}>
            {(opp.profit?.netDaily ?? 0) >= 0 ? '+' : ''}${opp.profit?.netDaily?.toFixed(2)}
          </span>
        </div>
        <div>Год (APY): <strong>{opp.profit?.annualReturn?.toFixed(1)}%</strong></div>
      </div>

      <div className="text-xs text-gray-500 mb-2">
        Комиссии: ${opp.profit?.fees?.toFixed(2)} | Проскальзывание: ${opp.profit?.slippage?.toFixed(2)}
      </div>

      <div className="text-sm bg-blue-50 p-2 rounded mb-2">
        <strong>Стратегия:</strong> {opp.opportunity}
      </div>

      {opp.risk?.reasons?.length > 0 && (
        <div className="text-xs text-yellow-600 mb-2">
          {opp.risk.reasons.map((r: string, i: number) => (
            <div key={i}>⚠️ {r}</div>
          ))}
        </div>
      )}

      <button
        onClick={onCalculate}
        className="btn btn-success text-sm py-2 w-full"
      >
        💰 Рассчитать с моим капиталом
      </button>
    </div>
  );
});

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
      showToast('Не удалось рассчитать прибыль', 'error');
    } finally {
      setLoading(false);
    }
  }, [opportunity, capital, showToast]);

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="calculator-title"
    >
      <div className="bg-white rounded-xl max-w-md w-full">
        <div className="card">
          <h2 id="calculator-title" className="text-lg font-semibold mb-2">💰 Калькулятор прибыли</h2>
          <div className="text-center mb-4">
            <div className="font-bold">{opportunity.pair}</div>
            <div className="text-sm text-gray-600">{opportunity.exchangeA} vs {opportunity.exchangeB}</div>
            <div className="text-green-500 font-bold">{(opportunity.difference_per_day * 100).toFixed(4)}%/день</div>
            {opportunity.intervalMismatch && (
              <div className="text-xs text-orange-600">⚠️ Разные интервалы</div>
            )}
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="calc-capital">
              Ваш капитал (USDT):
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
            {loading ? 'Расчет...' : 'Рассчитать прибыль'}
          </button>

          {result && (
            <div className="bg-gray-50 p-3 rounded-lg">
              <div className="text-xs text-gray-500 mb-2">
                Чистая прибыль при удержании период (разовый вход/выход)
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>В час:</div>
                <div className={clsx('font-bold', result.profit.netHourly >= 0 ? 'text-green-500' : 'text-red-500')}>${result.profit.netHourly.toFixed(4)}</div>
                <div>В день:</div>
                <div className={clsx('font-bold', result.profit.netDaily >= 0 ? 'text-green-500' : 'text-red-500')}>${result.profit.netDaily.toFixed(2)}</div>
                <div>В неделю:</div>
                <div className={clsx('font-bold', result.profit.netWeekly >= 0 ? 'text-green-500' : 'text-red-500')}>${result.profit.netWeekly.toFixed(2)}</div>
                <div>В год:</div>
                <div className={clsx('font-bold', result.profit.netAnnual >= 0 ? 'text-green-500' : 'text-red-500')}>${result.profit.netAnnual.toFixed(2)}</div>
              </div>
              <div className="mt-2 pt-2 border-t border-gray-200">
                <div className="flex justify-between">
                  <span>Годовая доходность (APY):</span>
                  <strong className={clsx(result.profit.annualReturn >= 0 ? 'text-green-500' : 'text-red-500')}>{result.profit.annualReturn.toFixed(2)}%</strong>
                </div>
              </div>
            </div>
          )}

          <button ref={closeRef} onClick={onClose} className="btn btn-secondary mt-4 w-full">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
