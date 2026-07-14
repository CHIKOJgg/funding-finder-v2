import { useState, useEffect, useCallback, memo } from 'react';
import { useApp } from '../App';
import { useToast } from '../components/Toast';
import { PaywallModal } from '../components/PaywallModal';
import { PaywallFeature } from '../utils/plans';
import { apiClient } from '../api/client';
import { PortfolioPosition } from '../types';
import { openExchange, exchangeLabel } from '../utils/exchanges';
import { CountdownTimer } from '../components/CountdownTimer';
import { useT } from '../i18n';

const EXCHANGES = ['binance', 'bybit', 'okx', 'gate', 'mexc'] as const;
const SIM_EXCHANGES = ['gate', 'binance', 'bybit', 'mexc', 'okx'] as const;

function formatUsd(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

export function PortfolioPage() {
  const { planLimits } = useApp();
  const { showToast } = useToast();
  const t = useT();
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
      showToast(err?.message || t('portfolio.loadError'), 'error');
    } finally {
      setLiveLoading(false);
    }
  }, [showToast, t]);

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
      showToast(t('portfolio.pairRequired'), 'error');
      return;
    }
    setSaving(true);
    try {
      const res: any = await apiClient.addPortfolio({ exchange, pair: pair.trim().toUpperCase(), side, sizeUsd, leverage });
      if (res?.ok) {
        showToast(t('portfolio.positionAdded'), 'success');
        setPair('');
        loadSim();
      } else if (res?.error) {
        showToast(res.error, 'error');
      }
    } catch (err: any) {
      showToast(err?.message || t('portfolio.addError'), 'error');
    } finally {
      setSaving(false);
    }
  }, [exchange, pair, side, sizeUsd, leverage, showToast, loadSim]);

  const handleRemove = useCallback(async (id: string) => {
    try {
      await apiClient.removePortfolio(id);
      setPositions((prev) => prev.filter((p) => p.id !== id));
    } catch (err: any) {
      showToast(err?.message || t('portfolio.removeError'), 'error');
    }
  }, [showToast, t]);

  const totalIncome = positions.reduce((sum, p) => sum + (p.pnl?.fundingIncome || 0), 0);

  if (!planLimits.portfolioEnabled) {
    return (
      <div className="p-4">
        <h1 className="text-xl font-bold mb-1">{t('portfolio.title')}</h1>
        <div className="card text-center py-8 mt-4">
          <div className="text-4xl mb-3" aria-hidden="true">💼</div>
          <p className="text-muted mb-3">{t('portfolio.lockedDesc')}</p>
          <button onClick={() => setPaywall('portfolio')} className="btn btn-primary">
            {t('portfolio.openPro')}
          </button>
        </div>
        <PaywallModal open={paywall !== null} feature={paywall || 'portfolio'} onClose={() => setPaywall(null)} />
      </div>
    );
  }

  return (
    <div className="p-4">
        <h1 className="text-xl font-bold mb-1">{t('portfolio.title')}</h1>

      <div className="flex gap-2 my-4" role="tablist">
        <button
          onClick={() => setTab('sim')}
          className={tab === 'sim' ? 'btn btn-primary flex-1 text-sm py-2.5' : 'btn btn-secondary flex-1 text-sm py-2.5'}
          role="tab"
          aria-selected={tab === 'sim'}
        >
          📊 {t('portfolio.simTab')}
        </button>
        <button
          onClick={() => setTab('live')}
          className={tab === 'live' ? 'btn btn-primary flex-1 text-sm py-2.5' : 'btn btn-secondary flex-1 text-sm py-2.5'}
          role="tab"
          aria-selected={tab === 'live'}
        >
          🔗 {t('portfolio.liveTab')}
        </button>
      </div>

      {tab === 'sim' ? (
        <>
          <div className="card mb-4">
            <h2 className="text-base font-semibold mb-3">{t('portfolio.addPosition')}</h2>
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
                {t('portfolio.sizeLabel')}
                <input type="number" min={1} value={sizeUsd} onChange={(e) => setSizeUsd(Math.max(1, Number(e.target.value) || 1))} className="input-field text-sm" />
              </label>
              <label className="text-xs text-muted flex flex-col">
                {t('portfolio.leverageLabel')}
                <input type="number" min={1} value={leverage} onChange={(e) => setLeverage(Math.max(1, Number(e.target.value) || 1))} className="input-field text-sm" />
              </label>
            </div>
            <button onClick={handleAdd} disabled={saving} className="btn btn-primary w-full">
              {saving ? t('portfolio.adding') : t('portfolio.addPositionBtn')}
            </button>
          </div>

          <div className="card mb-4">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-base font-semibold">{t('portfolio.positions')}</h2>
              <div className="text-right">
                <div className="text-xs text-muted">{t('portfolio.simulatedIncome')}</div>
                <div className={`font-bold stat ${totalIncome >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {totalIncome >= 0 ? '+' : ''}{formatUsd(totalIncome)} USDT
                </div>
              </div>
            </div>

            {loading ? (
              <div className="text-center py-6 text-muted" role="status">{t('common.loading')}</div>
            ) : positions.length === 0 ? (
              <div className="text-center py-6 text-muted">{t('portfolio.noPositions')}</div>
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
            try {
              const res: any = await apiClient.autoExecuteOrder({
                exchange: autoTarget.exchange,
                symbol: autoTarget.symbol,
                side: autoTarget.side,
                notionalUsd: notional,
                confirm: true,
              });
              if (res?.ok) {
                showToast(t('portfolio.orderSent'), 'success');
                loadLive();
              } else {
                showToast(res?.error || t('portfolio.execFailed'), 'error');
              }
              return res;
            } catch (err: any) {
              showToast(err?.message || t('portfolio.execFailed'), 'error');
              throw err;
            }
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
  const t = useT();
  const [updatedAt, setUpdatedAt] = useState<number>(Date.now());
  const [exporting, setExporting] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);

  const loadOrders = useCallback(async () => {
    try {
      const res: any = await apiClient.getExecutedOrders();
      if (res?.ok) setOrders(res.orders || []);
    } catch { /* ignore */ }
  }, []);

  // Refresh order history when positions refresh (e.g. after an auto-execute).
  useEffect(() => {
    loadOrders();
  }, [live, loadOrders]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res: any = await apiClient.exportLivePortfolio();
      const blob = res instanceof Blob ? res : new Blob([res.data], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `live-positions-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast(t('portfolio.exportError'), 'error');
    } finally {
      setExporting(false);
    }
  };

  // Keep real positions fresh: poll every 30s while the live tab is mounted.
  useEffect(() => {
    const id = setInterval(() => {
      onRefresh();
      setUpdatedAt(Date.now());
    }, 30000);
    return () => clearInterval(id);
  }, [onRefresh]);

  const refresh = () => {
    onRefresh();
    setUpdatedAt(Date.now());
  };
  const [form, setForm] = useState({ exchange: 'binance', label: '', apiKey: '', secret: '', passphrase: '', permissions: 'read' as 'read' | 'trade' });
  const [saving, setSaving] = useState(false);

  const submitKey = async () => {
    if (!form.apiKey || !form.secret) {
      showToast(t('portfolio.keyRequired'), 'error');
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
      if (res?.ok) {
        showToast(t('portfolio.keyAdded'), 'success');
      } else if (res?.error) showToast(res.error, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="card mb-4">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-base font-semibold">🔗 {t('portfolio.liveExchanges')}</h2>
          <button onClick={() => setShowKeyForm(!showKeyForm)} className="text-sm" style={{ color: 'var(--brand)' }}>
              {showKeyForm ? t('common.cancel') : t('portfolio.addKey')}
          </button>
        </div>
          <p className="text-xs text-muted mb-3">
            {t('portfolio.keysNote')}
          </p>

        {showKeyForm && (
          <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--surface-2)' }}>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <select value={form.exchange} onChange={(e) => setForm({ ...form, exchange: e.target.value })} className="input-field text-sm">
                {EXCHANGES.map((ex) => <option key={ex} value={ex}>{exchangeLabel(ex)}</option>)}
              </select>
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder={t('portfolio.labelPlaceholder')} className="input-field text-sm" />
            </div>
            <input value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder="API Key" className="input-field text-sm mb-2" />
            <input value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} placeholder="Secret" type="password" className="input-field text-sm mb-2" />
            {form.exchange === 'okx' && (
              <input value={form.passphrase} onChange={(e) => setForm({ ...form, passphrase: e.target.value })} placeholder="Passphrase (OKX)" className="input-field text-sm mb-2" />
            )}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-muted">{t('portfolio.permissions')}</span>
              <select value={form.permissions} onChange={(e) => setForm({ ...form, permissions: e.target.value as 'read' | 'trade' })} className="input-field text-sm flex-1">
                <option value="read">{t('portfolio.permRead')}</option>
                <option value="trade">{t('portfolio.permTrade')}</option>
              </select>
            </div>
            <button onClick={submitKey} disabled={saving} className="btn btn-primary w-full text-sm py-2">
              {saving ? t('portfolio.savingKey') : t('portfolio.saveKey')}
            </button>
          </div>
        )}

        {keys.length === 0 ? (
              <div className="text-center py-4 text-muted text-sm">{t('portfolio.noKeys')}</div>
        ) : (
          <div className="space-y-2">
            {keys.map((k) => (
              <div key={k.id} className="flex justify-between items-center text-sm">
                <div>
                  <strong>{exchangeLabel(k.exchange)}</strong>
                  {k.label && <span className="text-muted"> · {k.label}</span>}
                  <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${k.permissions === 'trade' ? 'chip-brand' : 'chip'}`}>
                    {k.permissions === 'trade' ? t('portfolio.permTradeLabel') : t('portfolio.permReadLabel')}
                  </span>
                </div>
                <button onClick={() => onDeleteKey(k.id)} className="text-xs text-red-500 hover:underline">{t('common.delete')}</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card mb-4">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-base font-semibold">{t('portfolio.realPositions')}</h2>
          <div className="text-right">
            <div className="text-xs text-muted">
              {loading ? t('portfolio.updating') : t('portfolio.updated', { time: new Date(updatedAt).toLocaleTimeString('ru-RU') })}
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={handleExport} disabled={exporting} className="text-sm" style={{ color: 'var(--brand)' }}>⬇ CSV</button>
              <button onClick={refresh} disabled={loading} className="text-sm" style={{ color: 'var(--brand)' }}>              🔄 {t('portfolio.refresh')}</button>
            </div>
          </div>
        </div>

        {loading ? (
              <div className="text-center py-6 text-muted" role="status">{t('common.loading')}</div>
        ) : !live || live.totals.positions === 0 ? (
          <div className="text-center py-6 text-muted">
            {keys.length === 0 ? t('portfolio.noKeysHint') : t('portfolio.noOpenPositions')}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-4 text-center">
              <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
                <div className="text-xs text-muted">{t('portfolio.positionsCount')}</div>
                <div className="text-lg font-bold stat">{live.totals.positions}</div>
              </div>
              <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
                <div className="text-xs text-muted">PnL</div>
                <div className={`text-lg font-bold stat ${live.totals.unrealized >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {live.totals.unrealized >= 0 ? '+' : ''}{formatUsd(live.totals.unrealized)} USDT
                </div>
              </div>
              <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
                <div className="text-xs text-muted">{t('portfolio.funding')}</div>
                <div className="text-lg font-bold stat text-green-700">+{formatUsd(live.totals.funding)} USDT</div>
              </div>
            </div>

            {live.exchanges.map((ex: any) => (
              <div key={ex.exchange} className="mb-3 rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
                <div className="flex justify-between items-center mb-2">
                  <strong>{exchangeLabel(ex.exchange)}{ex.label ? ` · ${ex.label}` : ''}</strong>
                  <button onClick={() => openExchange(ex.exchange, '')} className="text-xs" style={{ color: 'var(--brand)' }}              >↗ {t('portfolio.exchangeBtn')}</button>
                </div>
                {ex.error ? (
                  <div className="text-xs text-red-500">⚠️ {ex.error}</div>
                ) : ex.positions.length === 0 ? (
                  <div className="text-xs text-muted">{t('portfolio.noOpenPositionsEx')}</div>
                ) : (
                  <div className="space-y-1.5">
                    {ex.positions.map((p: any, i: number) => (
                      <div key={i} className="flex justify-between items-center text-sm">
                        <div>
                          <span className="font-medium">{p.symbol}</span>
                          <span className="text-xs text-muted ml-1">{p.side === 'long' ? 'Long' : 'Short'} · {formatUsd(p.notional)} USDT · x{p.leverage}</span>
                          <div className="text-xs text-muted">
                            <CountdownTimer intervalHours={p.fundingIntervalHours || 8} className="font-medium" /> {t('main.untilFunding')}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`font-bold ${p.unrealizedPnl >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                            {p.unrealizedPnl >= 0 ? '+' : ''}{formatUsd(p.unrealizedPnl)} USDT
                          </span>
                          {ex.permissions === 'trade' && ex.supportsTrading && (
                            <button
                              onClick={() => onAuto({ exchange: ex.exchange, symbol: p.symbol, side: p.side, notional: p.notional })}
                              className="text-xs text-[var(--brand)] hover:underline"
                              title={t('portfolio.mirrorTitle')}
                            >⧉ {t('portfolio.openCopy')}</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          {orders.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold mb-2">{t('portfolio.autoHistory')}</h3>
              <div className="space-y-1.5">
                {orders.map((o: any) => (
                  <div key={o.id} className="flex justify-between items-center text-sm rounded-lg p-2" style={{ background: 'var(--surface-2)' }}>
                    <div>
                      <span className="font-medium">{exchangeLabel(o.exchange)}: {o.symbol}</span>
                      <span className="text-xs text-muted ml-1">{o.side === 'long' ? 'Long' : 'Short'} · {formatUsd(o.notionalUsd)} USDT</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">{new Date(o.createdAt).toLocaleString('ru-RU')}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${o.status === 'sent' || o.status === 'filled' ? 'chip-success' : o.status === 'failed' ? 'chip-danger' : 'chip'}`}>
                        {o.status === 'sent' || o.status === 'filled' ? t('profile.executed') : o.status === 'failed' ? t('profile.failed') : o.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
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
  const t = useT();

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
          <h2 className="text-lg font-semibold mb-1">{t('portfolio.autoTitle')}</h2>
          <p className="text-sm text-gray-600 mb-3">
            {t('portfolio.autoDesc', { side: target.side === 'long' ? t('portfolio.long') : t('portfolio.short'), symbol: target.symbol, exchange: exchangeLabel(target.exchange) })}
          </p>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('portfolio.sizeUsdt')}</label>
          <input
            type="number"
            min={1}
            value={notional}
            onChange={(e) => setNotional(Math.max(1, Number(e.target.value) || 1))}
            className="input-field mb-3"
          />
          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-secondary flex-1">{t('common.cancel')}</button>
            <button onClick={confirm} disabled={busy} className="btn btn-primary flex-1">
              {busy ? t('portfolio.opening') : t('portfolio.openConfirm')}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">{t('portfolio.autoWarn')}</p>
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
  const t = useT();
  const income = pnl?.fundingIncome || 0;
  return (
    <div className="border-b border-gray-100 pb-2">
      <div className="flex justify-between items-start">
        <div>
          <strong className="text-sm">{position.exchange.toUpperCase()}: {position.pair}</strong>
          <div className="text-xs text-gray-500">
            {position.side === 'long' ? 'Long' : 'Short'} · {formatUsd(position.sizeUsd)} USDT · x{position.leverage}
          </div>
          {pnl && (
            <div className="text-xs text-gray-500">
              ~{(pnl.hoursHeld).toFixed(1)} {t('portfolio.holdHours')}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className={`font-bold ${(income >= 0 ? 'text-green-700' : 'text-red-700')}`}>
            {income >= 0 ? '+' : ''}{formatUsd(income)} USDT
          </div>
          {pnl && (
            <div className="text-xs text-gray-500">
              ≈ {(pnl.annualizedPct).toFixed(2)}%/год
            </div>
          )}
            <button onClick={onRemove} className="text-xs text-red-500 hover:underline mt-1">{t('common.delete')}</button>
        </div>
      </div>
    </div>
  );
});
