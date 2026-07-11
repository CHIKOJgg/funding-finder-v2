import { useState, useEffect, useCallback, memo } from 'react';
import { useApp } from '../App';
import { useToast } from '../components/Toast';
import { PaywallModal } from '../components/PaywallModal';
import { PaywallFeature } from '../utils/plans';
import { apiClient } from '../api/client';
import { PortfolioPosition } from '../types';

const EXCHANGES = ['gate', 'binance', 'bybit', 'mexc', 'okx'] as const;

function formatUsd(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

export function PortfolioPage() {
  const { planLimits } = useApp();
  const { showToast } = useToast();
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [paywall, setPaywall] = useState<PaywallFeature | null>(null);

  // form state
  const [exchange, setExchange] = useState<string>('binance');
  const [pair, setPair] = useState('');
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [sizeUsd, setSizeUsd] = useState(1000);
  const [leverage, setLeverage] = useState(1);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res: any = await apiClient.getPortfolio();
      if (res?.ok) setPositions(res.positions || []);
    } catch {
      /* handled by paywall for 403 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!planLimits.portfolioEnabled) {
      setPaywall('portfolio');
      setLoading(false);
      return;
    }
    load();
  }, [planLimits.portfolioEnabled, load]);

  const handleAdd = useCallback(async () => {
    if (!pair.trim()) {
      showToast('Введите пару (например, BTCUSDT)', 'error');
      return;
    }
    setSaving(true);
    try {
      const res: any = await apiClient.addPortfolio({ exchange, pair: pair.trim().toUpperCase(), side, sizeUsd, leverage });
      if (res?.ok) {
        showToast('Позиция добавлена', 'success');
        setPair('');
        load();
      } else if (res?.error) {
        showToast(res.error, 'error');
      }
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  }, [exchange, pair, side, sizeUsd, leverage, showToast, load]);

  const handleRemove = useCallback(async (id: string) => {
    try {
      await apiClient.removePortfolio(id);
      setPositions((prev) => prev.filter((p) => p.id !== id));
    } catch { /* ignore */ }
  }, []);

  const totalIncome = positions.reduce((sum, p) => sum + (p.pnl?.fundingIncome || 0), 0);

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-1">💼 Портфель (симуляция)</h1>
      <p className="text-sm text-muted mb-4">
        Paper PnL: расчёт дохода от фандинга без реальных позиций и ключей бирж.
      </p>

      {!planLimits.portfolioEnabled ? (
        <div className="card text-center py-8">
          <div className="text-4xl mb-3" aria-hidden="true">💼</div>
          <p className="text-muted mb-3">Симулятор портфеля доступен на тарифе Pro.</p>
          <button onClick={() => setPaywall('portfolio')} className="btn btn-primary">
            🔒 Открыть в Pro
          </button>
        </div>
      ) : (
        <>
          <div className="card mb-4">
            <h2 className="text-base font-semibold mb-3">Добавить позицию</h2>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <select value={exchange} onChange={(e) => setExchange(e.target.value)} className="input-field text-sm">
                {EXCHANGES.map((ex) => <option key={ex} value={ex}>{ex}</option>)}
              </select>
              <input
                value={pair}
                onChange={(e) => setPair(e.target.value)}
                placeholder="BTCUSDT"
                className="input-field text-sm"
                aria-label="Pair"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <select value={side} onChange={(e) => setSide(e.target.value as 'long' | 'short')} className="input-field text-sm">
                <option value="long">Long</option>
                <option value="short">Short</option>
              </select>
              <label className="text-xs text-muted flex flex-col">
                Размер, $
                <input type="number" min={1} value={sizeUsd} onChange={(e) => setSizeUsd(Math.max(1, Number(e.target.value) || 1))} className="input-field text-sm" />
              </label>
              <label className="text-xs text-muted flex flex-col">
                Плечо
                <input type="number" min={1} value={leverage} onChange={(e) => setLeverage(Math.max(1, Number(e.target.value) || 1))} className="input-field text-sm" />
              </label>
            </div>
            <button onClick={handleAdd} disabled={saving} className="btn btn-primary w-full">
              {saving ? 'Добавление...' : '➕ Добавить позицию'}
            </button>
          </div>

          <div className="card mb-4">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-base font-semibold">Позиции</h2>
              <div className="text-right">
                <div className="text-xs text-muted">Симулировано дохода</div>
                <div className={`font-bold stat ${(totalIncome >= 0 ? 'text-green-700' : 'text-red-700')}`}>
                  {totalIncome >= 0 ? '+' : ''}{formatUsd(totalIncome)} $
                </div>
              </div>
            </div>

            {loading ? (
              <div className="text-center py-6 text-muted" role="status">Загрузка...</div>
            ) : positions.length === 0 ? (
              <div className="text-center py-6 text-muted">Позиций пока нет</div>
            ) : (
              <div className="space-y-2">
                {positions.map((p) => (
                  <PortfolioRow key={p.id} position={p} onRemove={() => handleRemove(p.id)} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <PaywallModal open={paywall !== null} feature={paywall || 'portfolio'} onClose={() => setPaywall(null)} />
    </div>
  );
}

const PortfolioRow = memo(function PortfolioRow({
  position,
  onRemove,
}: {
  position: PortfolioPosition;
  onRemove: () => void;
}) {
  const pnl = position.pnl;
  const income = pnl?.fundingIncome || 0;
  return (
    <div className="border-b border-gray-100 pb-2">
      <div className="flex justify-between items-start">
        <div>
          <strong className="text-sm">{position.exchange.toUpperCase()}: {position.pair}</strong>
          <div className="text-xs text-gray-500">
            {position.side === 'long' ? 'Long' : 'Short'} · {formatUsd(position.sizeUsd)}$ · x{position.leverage}
          </div>
          {pnl && (
            <div className="text-xs text-gray-500">
              ~{(pnl.hoursHeld).toFixed(1)} ч удержания
            </div>
          )}
        </div>
        <div className="text-right">
          <div className={`font-bold ${(income >= 0 ? 'text-green-700' : 'text-red-700')}`}>
            {income >= 0 ? '+' : ''}{formatUsd(income)}$
          </div>
          {pnl && (
            <div className="text-xs text-gray-500">
              ≈ {(pnl.annualizedPct).toFixed(2)}%/год
            </div>
          )}
          <button onClick={onRemove} className="text-xs text-red-500 hover:underline mt-1">Удалить</button>
        </div>
      </div>
    </div>
  );
});
