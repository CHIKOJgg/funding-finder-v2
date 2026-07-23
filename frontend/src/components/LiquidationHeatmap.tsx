import { clsx } from 'clsx';
import { useT } from '../i18n';

// Estimates liquidation price zones for common leverage levels based on the
// current mark price. Useful for understanding where cascading liquidations
// could trigger moves. The maintenance margin rate is assumed at 0.4% (Binance
// default for most tiers) — conservative enough for a general estimate.

const LEVERAGE_LEVELS = [3, 5, 10, 20, 25, 50, 75, 100];
const MAINTENANCE_MARGIN = 0.004; // 0.4%

interface Props {
  price: number;
  className?: string;
}

function liquidationPriceLong(entry: number, leverage: number): number {
  return entry * (1 - (1 / leverage) + MAINTENANCE_MARGIN);
}

function liquidationPriceShort(entry: number, leverage: number): number {
  return entry * (1 + (1 / leverage) - MAINTENANCE_MARGIN);
}

export function LiquidationHeatmap({ price, className }: Props) {
  const t = useT();
  if (!price || !isFinite(price) || price <= 0) return null;

  const zones = LEVERAGE_LEVELS.map((lev) => ({
    leverage: lev,
    longLiq: liquidationPriceLong(price, lev),
    shortLiq: liquidationPriceShort(price, lev),
    longDist: ((price - liquidationPriceLong(price, lev)) / price) * 100,
    shortDist: ((liquidationPriceShort(price, lev) - price) / price) * 100,
  }));

  const maxDist = Math.max(...zones.map((z) => Math.max(z.longDist, z.shortDist)), 1);

  return (
    <div className={clsx('p-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]', className)}>
      <div className="text-xs font-semibold mb-2 text-[var(--text)]">{t('arb.liqHeatmap')}</div>

      {/* Long side (support zones) */}
      <div className="mb-1">
        <div className="text-[10px] text-[var(--text-muted)] mb-0.5">{t('arb.liqLongSide')}</div>
        <div className="space-y-0.5">
          {[...zones].reverse().map((z) => (
            <div key={z.leverage} className="flex items-center gap-1.5 text-[10px]">
              <span className="w-6 text-right text-[var(--text-muted)]">{z.leverage}x</span>
              <div className="flex-1 h-2.5 bg-[var(--border)] rounded-full overflow-hidden relative">
                <div
                  className="absolute right-0 top-0 h-full rounded-full bg-green-500/70"
                  style={{ width: `${(z.longDist / maxDist) * 100}%` }}
                />
              </div>
              <span className="w-16 text-right tabular-nums text-green-600">
                ${z.longLiq < 1 ? z.longLiq.toFixed(4) : z.longLiq.toFixed(z.longLiq > 100 ? 0 : 2)}
              </span>
              <span className="w-8 text-right text-[var(--text-muted)]">-{z.longDist.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Current price marker */}
      <div className="flex items-center justify-center gap-1 text-[10px] font-bold py-0.5 text-[var(--text)]">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500" />
        {t('arb.liqCurrentPrice')}: ${price > 100 ? price.toFixed(0) : price.toFixed(4)}
      </div>

      {/* Short side (resistance zones) */}
      <div>
        <div className="text-[10px] text-[var(--text-muted)] mb-0.5">{t('arb.liqShortSide')}</div>
        <div className="space-y-0.5">
          {zones.map((z) => (
            <div key={z.leverage} className="flex items-center gap-1.5 text-[10px]">
              <span className="w-6 text-right text-[var(--text-muted)]">{z.leverage}x</span>
              <div className="flex-1 h-2.5 bg-[var(--border)] rounded-full overflow-hidden relative">
                <div
                  className="absolute left-0 top-0 h-full rounded-full bg-red-500/70"
                  style={{ width: `${(z.shortDist / maxDist) * 100}%` }}
                />
              </div>
              <span className="w-16 text-right tabular-nums text-red-500">
                ${z.shortLiq > 1000 ? z.shortLiq.toFixed(0) : z.shortLiq.toFixed(2)}
              </span>
              <span className="w-8 text-right text-[var(--text-muted)]">+{z.shortDist.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="text-[9px] text-[var(--text-muted)] mt-1.5 text-center">
        {t('arb.liqNote')}
      </div>
    </div>
  );
}
