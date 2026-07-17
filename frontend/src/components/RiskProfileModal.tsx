import { useState, useMemo } from 'react';
import { exchangeLabel, openExchange } from '../utils/exchanges';
import { useT } from '../i18n';

interface RiskProfileModalProps {
  open: boolean;
  onClose: () => void;
  scanResults: any;
  defaultCapital: number;
}

type RiskLevel = 'low' | 'medium' | 'high';

const RISK_PRESETS: Record<RiskLevel, { label: string; perPositionPct: number; leverage: number; count: number; color: string }> = {
  low: { label: 'risk.low', perPositionPct: 0.05, leverage: 2, count: 3, color: 'var(--success)' },
  medium: { label: 'risk.medium', perPositionPct: 0.1, leverage: 3, count: 5, color: 'var(--warning)' },
  high: { label: 'risk.high', perPositionPct: 0.2, leverage: 5, count: 8, color: 'var(--danger)' },
};

// Builds a ready-to-open basket of funding positions from the current scan,
// sized to the user's capital and risk tolerance.
export function RiskProfileModal({ open, onClose, scanResults, defaultCapital }: RiskProfileModalProps) {
  const [capital, setCapital] = useState(defaultCapital);
  const [risk, setRisk] = useState<RiskLevel>('medium');
  const t = useT();

  const basket = useMemo(() => {
    if (!scanResults) return [];
    const items = [...(scanResults.highYield || []), ...(scanResults.mediumYield || [])];
    const preset = RISK_PRESETS[risk];
    const top = [...items]
      .sort((a, b) => (b.annualized_rate || 0) - (a.annualized_rate || 0))
      .slice(0, preset.count);
    return top.map((it) => {
      const size = capital * preset.perPositionPct;
      const daily = size * (it.funding_rate_per_day || 0);
      return {
        exchange: it.exchange,
        contract: it.contract,
        size,
        daily,
        ratePerDay: it.funding_rate_per_day || 0,
      };
    });
  }, [scanResults, capital, risk]);

  const totalDaily = basket.reduce((s, b) => s + b.daily, 0);
  const preset = RISK_PRESETS[risk];

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4" role="dialog" aria-modal="true">
      <div className="rounded-xl max-w-md w-full max-h-[90vh] overflow-auto" style={{ background: 'var(--bg)' }}>
        <div className="card">
          <h2 className="text-lg font-semibold mb-1">{t('risk.title')}</h2>
          <p className="text-sm text-muted mb-4">
            {t('risk.desc')}
          </p>

          <label className="block text-sm font-medium text-muted mb-1">{t('risk.capital')}</label>
          <input
            type="number" min={100} value={capital}
            onChange={(e) => setCapital(Math.max(100, Number(e.target.value) || 100))}
            className="input-field mb-4"
          />

          <div className="text-sm font-medium text-muted mb-2">{t('risk.acceptableRisk')}</div>
          <div className="flex gap-2 mb-4">
            {(Object.keys(RISK_PRESETS) as RiskLevel[]).map((lvl) => (
              <button
                key={lvl}
                onClick={() => setRisk(lvl)}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border ${risk === lvl ? 'border-2' : 'border'}`}
                style={risk === lvl ? { borderColor: RISK_PRESETS[lvl].color, color: RISK_PRESETS[lvl].color } : { color: 'var(--text-muted)' }}
              >
                {t('risk.' + lvl)}
              </button>
            ))}
          </div>

          <div className="text-xs text-muted mb-3">
            {t('risk.basketInfo', { count: preset.count, pct: Math.round(preset.perPositionPct * 100), lev: preset.leverage })}
          </div>

          <div className="space-y-2 mb-4 max-h-64 overflow-auto">
            {basket.length === 0 ? (
              <div className="text-center py-4 text-muted text-sm">{t('risk.noData')}</div>
            ) : (
              basket.map((b, i) => (
                <div key={i} className="flex justify-between items-center text-sm rounded-lg p-2" style={{ background: 'var(--surface-2)' }}>
                  <div>
                    <span className="font-medium">{exchangeLabel(b.exchange)}: {b.contract}</span>
                    <div className="text-xs text-muted">
                      {formatUsd(b.size)} USDT · {(b.ratePerDay * 100).toFixed(4)}{t('unit.pctPerDay')}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-green-700">+{formatUsd(b.daily)} {t('unit.usdtPerDay')}</span>
                    <button
                      onClick={() => openExchange(b.exchange, b.contract)}
                      className="text-xs text-[var(--brand)] hover:underline"
                      title={t('main.openOnExchange', { contract: b.contract, exchange: exchangeLabel(b.exchange) })}
                    >↗</button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="rounded-xl p-3 mb-4" style={{ background: 'var(--brand-soft)' }}>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--brand)' }}>{t('risk.expectedIncome')}</span>
              <strong className="text-green-700">+{formatUsd(totalDaily)} {t('unit.usdtPerDay')}</strong>
            </div>
            <div className="flex justify-between text-xs text-muted mt-1">
              <span>≈ {formatUsd(totalDaily * 30)} {t('unit.usdtPerMonth')}</span>
              <span>≈ {formatUsd(totalDaily * 365)} {t('unit.usdtPerYear')}</span>
            </div>
          </div>

          <button onClick={onClose} className="btn btn-secondary w-full">{t('risk.done')}</button>
        </div>
      </div>
    </div>
  );
}

function formatUsd(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}
