import { useState, useEffect, useCallback, memo } from 'react';
import { useApp } from '../App';
import { useToast } from '../components/Toast';
import { PaywallModal } from '../components/PaywallModal';
import { PaywallFeature } from '../utils/plans';
import { apiClient } from '../api/client';
import { PortfolioPosition } from '../types';
import { openExchange, exchangeLabel } from '../utils/exchanges';

const EXCHANGES = ['binance', 'bybit', 'okx'] as const;
const SIM_EXCHANGES = ['gate', 'binance', 'bybit', 'mexc', 'okx'] as const;

function formatUsd(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

export function PortfolioPage() {
  const { planLimits } = useApp();
  const { showToast } = useToast();
  const [tab, setTab] = useState<'sim' | 'live'>('sim');
  const [paywall, setPaywall] = useState<PaywallFeature | null>(null);

  // ---- Simulation (paper) ----
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [exchange, setExchange] = useState<string>('binance');
  const [pair, setPair] = useState('');
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [sizeUsd, setSizeUsd] = useState(1000);
  const [leverage, setLeverage] = useState(1);
  const [saving, setSaving] = useState(false);

  // ---- Live (real, via API keys) ----
  const [keys, setKeys] = useState<any[]>([]);
  const [live, setLive] = useState<any>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [autoTarget, setAutoTarget] = useState<any>(null);

  const loadSim = useCallback(async () => {
    try {
      const res: any = await apiClient.getPortfolio();
      if (res?.ok) setPositions(res.positions || []);
    } catch {
      /* handled by paywall for 403 */
    } finally {
      setLoading(false);
    }
  }, []);

  const loadKeys = useCallback(async () => {
    try {
      const res: any = await apiClient.getApiKeys();
      if (res?.ok) setKeys(res.keys || []);
    } catch { /* ignore */ }
  }, []);

  const loadLive = useCallback(async () => {
    setLiveLoading(true);
    try {
      const res: any = await apiClient.getLivePortfolio();
      if (res?.ok) setLive(res);
    } catch (err: any) {
      showToast(err?.error || 'Не удалось загрузить позиции', 'error');
    } finally {
      setLiveLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (!planLimits.portfolioEnabled) {
      setPaywall('portfolio');
      setLoading(false);
      return;
    }
    loadSim();
    loadKeys();
    loadLive();
  }, [planLimits.portfolioEnabled, loadSim, loadKeys, loadLive]);

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
        loadSim();
      } else if (res?.error) {
        showToast(res.error, 'error');
      }
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  }, [exchange, pair, side, sizeUsd, leverage, showToast, loadSim]);

  const handleRemove = useCallback(async (id: string) => {
    try {
      await apiClient.removePortfolio(id);
      setPositions((prev) => prev.filter((p) => p.id !== id));
    } catch { /* ignore */ }
  }, []);

  const totalIncome = positions.reduce((sum, p) => sum + (p.pnl?.fundingIncome || 0), 0);

  if (!planLimits.portfolioEnabled) {
    return (
      <div className="p-4">
        <h1 className="text-xl font-bold mb-1">💼 Портфель</h1>
        <div className="card text-center py-8 mt-4">
          <div className="text-4xl mb-3" aria-hidden="true">💼</div>
          <p className="text-muted mb-3">Портфель (симуляция и реальные позиции) доступен на тарифе Pro.</p>
          <button onClick={() => setPaywall('portfolio')} className="btn btn-primary">
            🔒 Открыть в Pro
          </button>
        </div>
        <PaywallModal open={paywall !== null} feature={paywall || 'portfolio'} onClose={() => setPaywall(null)} />
      </div>
    );
  }

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-1">💼 Портфель</h1>

      <div className="flex gap-2 my-4" role="tablist">
        <button
          onClick={() => setTab('sim')}
          className={tab === 'sim' ? 'btn btn-primary flex-1 text-sm py-2.5' : 'btn btn-secondary flex-1 text-sm py-2.5'}
          role="tab"
          aria-selected={tab === 'sim'}
        >
          📊 Симуляция
        </button>
        <button
          onClick={() => setTab('live')}
          className={tab === 'live' ? 'btn btn-primary flex-1 text-sm py-2.5' : 'btn btn-secondary flex-1 text-sm py-2.5'}
          role="tab"
          aria-selected={tab === 'live'}
        >
          🔗 Реальные позиции
        </button>
      </div>

      {tab === 'sim' ? (
        <>
          <div className="card mb-4">
            <h2 className="text-base font-semibold mb-3">Добавить позицию</h2>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <select value={exchange} onChange={(e) => setExchange(e.target.value)} className="input-field text-sm">
                {SIM_EXCHANGES.map((ex) => <option key={ex} value={ex}>{ex}</option>)}
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
                <div className={`font-bold stat ${totalIncome >= 0 ? 'text-green-700' : 'text-red-700'}`}>
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
      ) : (
        <LiveTab
          keys={keys}
          live={live}
          loading={liveLoading}
          onRefresh={loadLive}
          onDeleteKey={async (id) => { await apiClient.deleteApiKey(id); loadKeys(); }}
          onAddKey={async (data) => {
            const res: any = await apiClient.addApiKey(data);
            if (res?.ok) { setShowKeyForm(false); loadKeys(); loadLive(); }
            return res;
          }}
          onAuto={setAutoTarget}
          showKeyForm={showKeyForm}
          setShowKeyForm={setShowKeyForm}
        />
      )}

      <PaywallModal open={paywall !== null} feature={paywall || 'portfolio'} onClose={() => setPaywall(null)} />

      {autoTarget && (
        <AutoExecuteDialog
          target={autoTarget}
          onClose={() => setAutoTarget(null)}
          onConfirm={async (notional) => {
            const res: any = await apiClient.autoExecuteOrder({
              exchange: autoTarget.exchange,
              symbol: autoTarget.symbol,
              side: autoTarget.side,
              notionalUsd: notional,
              confirm: true,
            });
            if (res?.ok) showToast('Ордер отправлен на биржу', 'success');
            else showToast(res?.error || 'Не удалось исполнить', 'error');
            return res;
          }}
        />
      )}
    </div>
  );
}

const LiveTab = memo(function LiveTab({
  keys,
  live,
  loading,
  onRefresh,
  onDeleteKey,
  onAddKey,
  onAuto,
  showKeyForm,
  setShowKeyForm,
}: {
  keys: any[];
  live: any;
  loading: boolean;
  onRefresh: () => void;
  onDeleteKey: (id: string) => void;
  onAddKey: (data: any) => Promise<any>;
  onAuto: (pos: any) => void;
  showKeyForm: boolean;
  setShowKeyForm: (v: boolean) => void;
}) {
  const { showToast } = useToast();
  const [form, setForm] = useState({ exchange: 'binance', label: '', apiKey: '', secret: '', passphrase: '', permissions: 'read' as 'read' | 'trade' });
  const [saving, setSaving] = useState(false);

  const submitKey = async () => {
    if (!form.apiKey || !form.secret) {
      showToast('Введите API key и secret', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await onAddKey({
        exchange: form.exchange,
        label: form.label || undefined,
        apiKey: form.apiKey,
        secret: form.secret,
        passphrase: form.exchange === 'okx' ? form.passphrase : undefined,
        permissions: form.permissions,
      });
      if (res?.ok) showToast('Ключ добавлен (зашифрован)', 'success');
      else if (res?.error) showToast(res.error, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="card mb-4">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-base font-semibold">🔗 Подключённые биржи</h2>
          <button onClick={() => setShowKeyForm(!showKeyForm)} className="text-sm" style={{ color: 'var(--brand)' }}>
            {showKeyForm ? 'Отмена' : '+ Ключ'}
          </button>
        </div>
        <p className="text-xs text-muted mb-3">
          Ключи хранятся зашифрованными (AES-256-GCM). Используйте <b>read-only</b> для просмотра позиций. Trade-права нужны только для авто-исполнения.
        </p>

        {showKeyForm && (
          <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--surface-2)' }}>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <select value={form.exchange} onChange={(e) => setForm({ ...form, exchange: e.target.value })} className="input-field text-sm">
                {EXCHANGES.map((ex) => <option key={ex} value={ex}>{exchangeLabel(ex)}</option>)}
              </select>
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Метка (необяз.)" className="input-field text-sm" />
            </div>
            <input value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder="API Key" className="input-field text-sm mb-2" />
            <input value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} placeholder="Secret" type="password" className="input-field text-sm mb-2" />
            {form.exchange === 'okx' && (
              <input value={form.passphrase} onChange={(e) => setForm({ ...form, passphrase: e.target.value })} placeholder="Passphrase (OKX)" className="input-field text-sm mb-2" />
            )}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-muted">Права:</span>
              <select value={form.permissions} onChange={(e) => setForm({ ...form, permissions: e.target.value as 'read' | 'trade' })} className="input-field text-sm flex-1">
                <option value="read">Только чтение</option>
                <option value="trade">Торговля</option>
              </select>
            </div>
            <button onClick={submitKey} disabled={saving} className="btn btn-primary w-full text-sm py-2">
              {saving ? 'Сохранение...' : '💾 Сохранить ключ'}
            </button>
          </div>
        )}

        {keys.length === 0 ? (
          <div className="text-center py-4 text-muted text-sm">Ключи не добавлены</div>
        ) : (
          <div className="space-y-2">
            {keys.map((k) => (
              <div key={k.id} className="flex justify-between items-center text-sm">
                <div>
                  <strong>{exchangeLabel(k.exchange)}</strong>
                  {k.label && <span className="text-muted"> · {k.label}</span>}
                  <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${k.permissions === 'trade' ? 'chip-brand' : 'chip'}`}>
                    {k.permissions === 'trade' ? 'торговля' : 'чтение'}
                  </span>
                </div>
                <button onClick={() => onDeleteKey(k.id)} className="text-xs text-red-500 hover:underline">Удалить</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card mb-4">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-base font-semibold">Реальные позиции</h2>
          <button onClick={onRefresh} disabled={loading} className="text-sm" style={{ color: 'var(--brand)' }}>🔄 Обновить</button>
        </div>

        {loading ? (
          <div className="text-center py-6 text-muted" role="status">Загрузка...</div>
        ) : !live || live.totals.positions === 0 ? (
          <div className="text-center py-6 text-muted">
            {keys.length === 0 ? 'Добавьте read-only ключ биржи, чтобы увидеть позиции' : 'Открытых позиций нет'}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-4 text-center">
              <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
                <div className="text-xs text-muted">Позиций</div>
                <div className="text-lg font-bold stat">{live.totals.positions}</div>
              </div>
              <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
                <div className="text-xs text-muted">PnL</div>
                <div className={`text-lg font-bold stat ${live.totals.unrealized >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {live.totals.unrealized >= 0 ? '+' : ''}{formatUsd(live.totals.unrealized)}$
                </div>
              </div>
              <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
                <div className="text-xs text-muted">Фандинг</div>
                <div className="text-lg font-bold stat text-green-700">+{formatUsd(live.totals.funding)}$</div>
              </div>
            </div>

            {live.exchanges.map((ex: any) => (
              <div key={ex.exchange} className="mb-3 rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
                <div className="flex justify-between items-center mb-2">
                  <strong>{exchangeLabel(ex.exchange)}{ex.label ? ` · ${ex.label}` : ''}</strong>
                  <button onClick={() => openExchange(ex.exchange, '')} className="text-xs" style={{ color: 'var(--brand)' }}>↗ Биржа</button>
                </div>
                {ex.error ? (
                  <div className="text-xs text-red-500">⚠️ {ex.error}</div>
                ) : ex.positions.length === 0 ? (
                  <div className="text-xs text-muted">Нет открытых позиций</div>
                ) : (
                  <div className="space-y-1.5">
                    {ex.positions.map((p: any, i: number) => (
                      <div key={i} className="flex justify-between items-center text-sm">
                        <div>
                          <span className="font-medium">{p.symbol}</span>
                          <span className="text-xs text-muted ml-1">{p.side === 'long' ? 'Long' : 'Short'} · {formatUsd(p.notional)}$ · x{p.leverage}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`font-bold ${p.unrealizedPnl >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                            {p.unrealizedPnl >= 0 ? '+' : ''}{formatUsd(p.unrealizedPnl)}$
                          </span>
                          {ex.permissions === 'trade' && (
                            <button
                              onClick={() => onAuto({ exchange: ex.exchange, symbol: p.symbol, side: p.side, notional: p.notional })}
                              className="text-xs text-[var(--brand)] hover:underline"
                              title="Открыть зеркальную позицию на этом же размере"
                            >⧉ копия</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
});

const AutoExecuteDialog = memo(function AutoExecuteDialog({
  target,
  onClose,
  onConfirm,
}: {
  target: any;
  onClose: () => void;
  onConfirm: (notional: number) => Promise<any>;
}) {
  const [notional, setNotional] = useState(Math.round(target.notional || 100));
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm(notional);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl max-w-sm w-full">
        <div className="card">
          <h2 className="text-lg font-semibold mb-1">⧉ Авто-исполнение</h2>
          <p className="text-sm text-gray-600 mb-3">
            Открыть {target.side === 'long' ? 'лонг' : 'шорт'} {target.symbol} на {exchangeLabel(target.exchange)} через ваш trade-ключ.
          </p>
          <label className="block text-sm font-medium text-gray-700 mb-1">Размер (USDT)</label>
          <input
            type="number"
            min={1}
            value={notional}
            onChange={(e) => setNotional(Math.max(1, Number(e.target.value) || 1))}
            className="input-field mb-3"
          />
          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-secondary flex-1">Отмена</button>
            <button onClick={confirm} disabled={busy} className="btn btn-primary flex-1">
              {busy ? 'Отправка...' : 'Открыть ✓'}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">⚠️ Реальная рыночная сделка. Проверьте сумму и плечо на бирже.</p>
        </div>
      </div>
    </div>
  );
});

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
