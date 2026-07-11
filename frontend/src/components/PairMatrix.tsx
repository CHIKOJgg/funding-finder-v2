import { useMemo } from 'react';
import { clsx } from 'clsx';
import { getFundingColor } from '../utils/formatters';
import { openExchange, exchangeLabel } from '../utils/exchanges';

interface PairMatrixProps {
  scanResults: any;
  exchanges: readonly string[];
  limit?: number;
}

function maxAbs(ex: Record<string, any>): number {
  return Object.values(ex).reduce((m, it) => Math.max(m, Math.abs(it.funding_rate_per_hour ?? 0)), 0);
}

// Shows the same pair side-by-side across all selected exchanges so the user
// instantly spots the widest funding spread (best arbitrage pair).
export function PairMatrix({ scanResults, exchanges, limit = 12 }: PairMatrixProps) {
  const rows = useMemo(() => {
    if (!scanResults) return [];
    const items = [
      ...(scanResults.highYield || []),
      ...(scanResults.mediumYield || []),
      ...(scanResults.lowYield || []),
    ];
    const byPair = new Map<string, Record<string, any>>();
    for (const it of items) {
      if (!byPair.has(it.contract)) byPair.set(it.contract, {});
      byPair.get(it.contract)![it.exchange] = it;
    }
    return [...byPair.entries()]
      .map(([pair, ex]) => ({ pair, ex }))
      .filter((e) => Object.keys(e.ex).length >= 2)
      .sort((a, b) => maxAbs(b.ex) - maxAbs(a.ex))
      .slice(0, limit);
  }, [scanResults, limit]);

  if (rows.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted" style={{ color: 'var(--text-muted)' }}>
            <th className="text-left font-medium py-1 pr-2">Пара</th>
            {exchanges.map((ex) => (
              <th key={ex} className="text-right font-medium py-1 px-1 whitespace-nowrap">
                {exchangeLabel(ex)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ pair, ex }) => {
            const rates = exchanges.map((name) => ex[name]?.funding_rate_per_hour ?? null);
            const max = Math.max(...rates.map((r) => r ?? -Infinity));
            const min = Math.min(...rates.map((r) => r ?? Infinity));
            return (
              <tr key={pair} className="border-t" style={{ borderColor: 'var(--border)' }}>
                <td className="py-1 pr-2 font-medium whitespace-nowrap">{pair}</td>
                {exchanges.map((name, i) => {
                  const rate = rates[i];
                  if (rate === null) {
                    return <td key={name} className="text-right px-1 text-muted" style={{ color: 'var(--text-muted)' }}>—</td>;
                  }
                  const isBest = rate === max && max !== min;
                  const isWorst = rate === min && max !== min;
                  return (
                    <td
                      key={name}
                      className={clsx('text-right px-1 tabular-nums cursor-pointer hover:underline', getFundingColor(rate))}
                      onClick={() => ex[name] && openExchange(name, pair)}
                      title={`Открыть ${pair} на ${exchangeLabel(name)}`}
                    >
                      {(rate * 100).toFixed(4)}%
                      {isBest && <span className="ml-0.5" aria-hidden="true">▲</span>}
                      {isWorst && <span className="ml-0.5" aria-hidden="true">▼</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
        ▲ выше ставка (короткая позиция получает) · ▼ ниже (длинная получает) · нажми на ячейку, чтобы открыть
      </p>
    </div>
  );
}
