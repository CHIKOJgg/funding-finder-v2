import { useState, useMemo } from 'react';
import { useT } from '../i18n';

interface PositionCalculatorProps {
  initialCapital?: number;
  initialSpread?: number;
  initialInterval?: number;
}

export function PositionCalculator({
  initialCapital = 1000,
  initialSpread = 0.01,
  initialInterval = 8,
}: PositionCalculatorProps) {
  const t = useT();
  const [capital, setCapital] = useState(initialCapital);
  const [spread, setSpread] = useState(initialSpread);
  const [interval, setInterval] = useState(initialInterval);
  const [leverage, setLeverage] = useState(1);
  const [takerFee, setTakerFee] = useState(0.04);

  const result = useMemo(() => {
    const feeDecimal = takerFee / 100;
    const spreadDecimal = spread / 100;

    const entryFee = capital * feeDecimal;
    const exitFee = capital * feeDecimal;
    const totalFees = entryFee + exitFee;

    const settlementsPerDay = 24 / interval;
    const dailyYield = capital * spreadDecimal * settlementsPerDay;
    const dailyYieldNet = dailyYield - totalFees;
    const monthlyYield = dailyYieldNet * 30;
    const annualYield = dailyYieldNet * 365;

    const positionSize = capital * leverage;
    const marginRequired = capital;
    const breakEvenDays = totalFees > 0 ? totalFees / Math.max(dailyYield, 0.0001) : 0;
    const liquidationDistance = leverage > 1 ? (1 / leverage) * 100 : 0;

    return {
      positionSize,
      marginRequired,
      dailyYield: dailyYieldNet,
      monthlyYield,
      annualYield,
      breakEvenDays,
      liquidationDistance,
      totalFees,
      settlementCycles: settlementsPerDay,
    };
  }, [capital, spread, interval, leverage, takerFee]);

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--surface-2)' }}>
      <h3 className="text-sm font-bold mb-3">{t('positionCalc.title') || 'Position Calculator'}</h3>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>
            {t('positionCalc.capital') || 'Capital (USDT)'}
          </label>
          <input
            type="number"
            value={capital}
            onChange={(e) => setCapital(Math.max(10, Number(e.target.value) || 10))}
            className="input-field text-sm"
            min={10}
          />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>
            {t('positionCalc.spread') || 'Spread (%/h)'}
          </label>
          <input
            type="number"
            value={spread}
            onChange={(e) => setSpread(Number(e.target.value) || 0)}
            className="input-field text-sm"
            step={0.001}
          />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>
            {t('positionCalc.interval') || 'Interval (h)'}
          </label>
          <input
            type="number"
            value={interval}
            onChange={(e) => setInterval(Math.max(1, Number(e.target.value) || 1))}
            className="input-field text-sm"
            min={1}
          />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>
            {t('positionCalc.leverage') || 'Leverage'}
          </label>
          <input
            type="number"
            value={leverage}
            onChange={(e) => setLeverage(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
            className="input-field text-sm"
            min={1}
            max={10}
          />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>
            {t('positionCalc.takerFee') || 'Taker fee (%)'}
          </label>
          <input
            type="number"
            value={takerFee}
            onChange={(e) => setTakerFee(Number(e.target.value) || 0)}
            className="input-field text-sm"
            step={0.01}
          />
        </div>
      </div>

      <div className="rounded-xl p-3" style={{ background: 'var(--surface)' }}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-muted)' }}>{t('positionCalc.positionSize') || 'Position size'}</span>
            <span className="font-semibold">${result.positionSize.toFixed(0)}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-muted)' }}>{t('positionCalc.margin') || 'Margin required'}</span>
            <span className="font-semibold">${result.marginRequired.toFixed(0)}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-muted)' }}>{t('positionCalc.dailyYield') || 'Daily yield (net)'}</span>
            <span className="font-semibold" style={{ color: result.dailyYield >= 0 ? 'var(--green)' : 'var(--red)' }}>
              ${result.dailyYield.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-muted)' }}>{t('positionCalc.monthlyYield') || 'Monthly yield'}</span>
            <span className="font-semibold" style={{ color: result.monthlyYield >= 0 ? 'var(--green)' : 'var(--red)' }}>
              ${result.monthlyYield.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-muted)' }}>{t('positionCalc.annualYield') || 'Annual yield'}</span>
            <span className="font-semibold" style={{ color: result.annualYield >= 0 ? 'var(--green)' : 'var(--red)' }}>
              ${result.annualYield.toFixed(0)}
            </span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-muted)' }}>{t('positionCalc.breakEven') || 'Break-even'}</span>
            <span className="font-semibold">{result.breakEvenDays.toFixed(1)}d</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-muted)' }}>{t('positionCalc.fees') || 'Total fees'}</span>
            <span className="font-semibold">${result.totalFees.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-muted)' }}>{t('positionCalc.liquidation') || 'Liq. distance'}</span>
            <span className="font-semibold">{result.liquidationDistance.toFixed(1)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}