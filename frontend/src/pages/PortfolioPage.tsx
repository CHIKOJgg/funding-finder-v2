import { useState, useEffect, useCallback, memo, useRef } from 'react';
import { useApp } from '../App';
import { useToast } from '../components/Toast';
import { PaywallModal } from '../components/PaywallModal';
import { PaywallFeature } from '../utils/plans';
import { apiClient } from '../api/client';
import { PortfolioPosition } from '../types';
import { openExchange, exchangeLabel } from '../utils/exchanges';
import { CountdownTimer } from '../components/CountdownTimer';
import { useT, useI18n } from '../i18n';
import { IconWallet, IconChartLine, IconLink2, IconDownload, IconExternalLink, IconAlertTriangle } from '../components/icons';

const EXCHANGES = ['binance', 'bybit', 'okx', 'gate', 'mexc', 'bitget', 'phemex', 'htx', 'hyperliquid', 'bingx', 'woo', 'coinex', 'weex', 'coinw', 'bitmart', 'blofin', 'apex', 'aster'] as const;
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
      if (err?.message && /authentication|subscription|pro/i.test(err.message)) {
        setPaywall('portfolio');
      } else {
        showToast(err?.message || t('portfolio.loadError'), 'error');
      }
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
        <h1 className="text-xl font-bold mb-1 text-[var(--text)]">{t('portfolio.title')}</h1>
        <div className="card text-center py-8 mt-4">
          <IconWallet size={40} className="block mx-auto mb-3 text-[var(--text3)]" aria-hidden />
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
        <h1 className="text-xl font-bold mb-1 text-[var(--text)]">{t('portfolio.title')}</h1>

      <div className="flex gap-2 my-4" role="tablist">
          <button
            onClick={() => setTab('sim')}
            className={tab === 'sim' ? 'btn btn-primary flex-1 text-sm py-2.5 gap-1.5' : 'btn btn-secondary flex-1 text-sm py-2.5 gap-1.5'}
            role="tab"
            aria-selected={tab === 'sim'}
          >
            <IconChartLine className="w-4 h-4" aria-hidden /> {t('portfolio.simTab')}
          </button>
          <button
            onClick={() => setTab('live')}
            className={tab === 'live' ? 'btn btn-primary flex-1 text-sm py-2.5 gap-1.5' : 'btn btn-secondary flex-1 text-sm py-2.5 gap-1.5'}
            role="tab"
            aria-selected={tab === 'live'}
          >
            <IconLink2 className="w-4 h-4" aria-hidden /> {t('portfolio.liveTab')}
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
                id="portfolio-pair"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <select value={side} onChange={(e) => setSide(e.target.value as 'long' | 'short')} className="input-field text-sm">
                <option value="long">{t('portfolio.long')}</option>
                <option value="short">{t('portfolio.short')}</option>
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
                <div className={`font-bold stat ${totalIncome >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                  {totalIncome >= 0 ? '+' : ''}{formatUsd(totalIncome)} USDT
                </div>
              </div>
            </div>

            {loading ? (
              <div className="text-center py-6 text-muted" role="status">{t('common.loading')}</div>
            ) : positions.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-muted mb-3">{t('portfolio.noPositions')}</p>
                <button
                  type="button"
                  className="btn btn-secondary mx-auto max-w-xs"
                  onClick={() => document.getElementById('portfolio-pair')?.focus()}
                >
                  {t('portfolio.addPosition')}
                </button>
              </div>
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
          showKeyForm={showKeyForm}
          setShowKeyForm={setShowKeyForm}
        />
      )}

      <PaywallModal open={paywall !== null} feature={paywall || 'portfolio'} onClose={() => setPaywall(null)} />

      {/* Trading via API keys is disabled — portfolio connections are read-only. */}
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
  showKeyForm,
  setShowKeyForm,
}: {
  keys: any[];
  live: any;
  loading: boolean;
  onRefresh: () => void;
  onDeleteKey: (id: string) => void;
  onAddKey: (data: any) => Promise<any>;
  showKeyForm: boolean;
  setShowKeyForm: (v: boolean) => void;
}) {
  const { showToast } = useToast();
  const t = useT();
  const { lang } = useI18n();
  const [updatedAt, setUpdatedAt] = useState<number>(Date.now());
  const [exporting, setExporting] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);

  const ordersLoadedAt = useRef(0);

  const loadOrders = useCallback(async () => {
    const now = Date.now();
    if (now - ordersLoadedAt.current < 5000) return;
    ordersLoadedAt.current = now;
    try {
      const res: any = await apiClient.getExecutedOrders();
      if (res?.ok) setOrders(res.orders || []);
    } catch { /* ignore */ }
  }, []);

  // Refresh order history when positions refresh (e.g. after an auto-execute).
  // The 5s dedupe in loadOrders prevents redundant calls from the 30s poll.
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

  // Keep real positions fresh: poll every 30s while the live tab is mounted and visible.
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) {
        onRefresh();
        setUpdatedAt(Date.now());
      }
    }, 30000);
    const onVisible = () => {
      if (!document.hidden) {
        onRefresh();
        setUpdatedAt(Date.now());
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
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
          <h2 className="text-base font-semibold flex items-center gap-1.5"><IconLink2 className="w-4 h-4" aria-hidden /> {t('portfolio.liveExchanges')}</h2>
          <button onClick={() => setShowKeyForm(!showKeyForm)} className="text-sm" style={{ color: 'var(--cobalt)' }}>
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
              <span className="chip text-xs flex-1 text-center">read-only</span>
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
                <button onClick={() => onDeleteKey(k.id)} className="text-xs text-[var(--red)] hover:underline">{t('common.delete')}</button>
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
              {loading ? t('portfolio.updating') : t('portfolio.updated', { time: new Date(updatedAt).toLocaleTimeString(lang) })}
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={handleExport} disabled={exporting} className="text-sm flex items-center gap-1" style={{ color: 'var(--cobalt)' }}>
                <IconDownload className="w-3.5 h-3.5" aria-hidden /> CSV
              </button>
              <button onClick={refresh} disabled={loading} className="btn btn-refresh text-sm py-1.5 px-3 w-auto">{t('portfolio.refresh')}</button>
            </div>
          </div>
        </div>

        {loading ? (
              <div className="text-center py-6 text-muted" role="status">{t('common.loading')}</div>
        ) : !live?.totals || live.totals.positions === 0 ? (
          <div className="text-center py-6 text-muted">
            {keys.length === 0 ? t('portfolio.noKeysHint') : t('portfolio.noOpenPositions')}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-4 text-center">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
                <div className="text-[11px] text-[var(--text3)] leading-tight">{t('portfolio.positionsCount')}</div>
                <div className="font-mono font-bold text-[19px] leading-snug text-[var(--text)]">{live.totals.positions}</div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
                <div className="text-[11px] text-[var(--text3)] leading-tight">PnL</div>
                <div className={`font-mono font-bold text-[19px] leading-snug ${(live.totals.unrealized ?? 0) >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                  {(live.totals.unrealized ?? 0) >= 0 ? '+' : ''}{formatUsd(live.totals.unrealized ?? 0)} USDT
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
                <div className="text-[11px] text-[var(--text3)] leading-tight">{t('portfolio.funding')}</div>
                <div className="font-mono font-bold text-[19px] leading-snug text-[var(--green)]">{(live.totals.funding ?? 0) >= 0 ? '+' : ''}{formatUsd(live.totals.funding ?? 0)} USDT</div>
              </div>
            </div>

            {live.exchanges.map((ex: any) => (
              <div key={ex.exchange} className="mb-3 rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
                <div className="flex justify-between items-center mb-2">
                  <strong>{exchangeLabel(ex.exchange)}{ex.label ? ` · ${ex.label}` : ''}</strong>
                  <div className="flex items-center gap-2">
                    {ex.supported === false && (
                      <span className="text-xs chip" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>{t('portfolio.unsupported')}</span>
                    )}
                    {ex.supportsTrading ? (
                      <span className="text-xs chip" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>{t('portfolio.tradeEnabled')}</span>
                    ) : (
                      <span className="text-xs chip" style={{ background: 'var(--bg1)', color: 'var(--text2)' }}>{t('portfolio.readOnly')}</span>
                    )}
                    <button onClick={() => openExchange(ex.exchange, '')} className="text-xs flex items-center gap-1" style={{ color: 'var(--cobalt)' }}>
                      <IconExternalLink className="w-3.5 h-3.5" aria-hidden /> {t('portfolio.exchangeBtn')}
                    </button>
                  </div>
                </div>
                {ex.error ? (
                  <div className="text-xs text-[var(--red)] flex items-center gap-1"><IconAlertTriangle className="w-3.5 h-3.5" aria-hidden /> {ex.error}</div>
                ) : ex.positions.length === 0 ? (
                  <div className="text-xs text-muted">{t('portfolio.noOpenPositionsEx')}</div>
                ) : (
                  <div className="space-y-1.5">
                    {ex.positions.map((p: any, i: number) => (
                      <div key={i} className="flex justify-between items-center text-sm">
                        <div>
                          <span className="font-medium">{p.symbol}</span>
                          <span className="text-xs text-muted ml-1">{p.side === 'long' ? t('portfolio.long') : t('portfolio.short')} · {formatUsd(p.notional)} USDT · x{p.leverage}</span>
                          <div className="text-xs text-muted">
                            <CountdownTimer intervalHours={p.fundingIntervalHours || 8} className="font-medium" /> {t('main.untilFunding')}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`font-bold ${p.unrealizedPnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                            {p.unrealizedPnl >= 0 ? '+' : ''}{formatUsd(p.unrealizedPnl)} USDT
                          </span>

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
                      <span className="text-xs text-muted ml-1">{o.side === 'long' ? t('portfolio.long') : t('portfolio.short')} · {formatUsd(o.notionalUsd)} USDT</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">{new Date(o.createdAt).toLocaleString(lang)}</span>
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
    <div className="border-b border-[var(--border)] pb-2">
      <div className="flex justify-between items-start">
        <div>
          <strong className="text-sm">{position.exchange.toUpperCase()}: {position.pair}</strong>
          <div className="text-xs text-[var(--text2)]">
            {position.side === 'long' ? t('portfolio.long') : t('portfolio.short')} · {formatUsd(position.sizeUsd)} USDT · x{position.leverage}
          </div>
          {pnl && (
            <div className="text-xs text-[var(--text2)]">
              ~{(pnl.hoursHeld ?? 0).toFixed(1)} {t('portfolio.holdHours')}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className={`font-bold ${(income >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}`}>
            {income >= 0 ? '+' : ''}{formatUsd(income)} USDT
          </div>
          {pnl && (
            <div className="text-xs text-muted">
              ≈ {(pnl.annualizedPct ?? 0).toFixed(2)}{t('unit.pctPerYear')}
            </div>
          )}
            <button onClick={onRemove} className="text-xs text-[var(--red)] hover:underline mt-1">{t('common.delete')}</button>
        </div>
      </div>
    </div>
  );
});
