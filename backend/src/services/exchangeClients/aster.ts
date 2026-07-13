import type { Credentials, ExchangeAdapter, NormalizedPosition, NormalizedFundingIncome } from './types.js';
import { binanceReq } from './signers.js';

const BASE = 'https://fapi.asterdex.com';

export const asterAdapter: ExchangeAdapter = {
  exchange: 'aster',
  supportsTrading: false,

  async getPositions(creds: Credentials): Promise<NormalizedPosition[]> {
    const data = await binanceReq(BASE, '/fapi/v1/positionRisk', creds);
    const positions: NormalizedPosition[] = [];
    for (const p of data || []) {
      const amt = parseFloat(p.positionAmt);
      if (!amt || amt === 0) continue;
      const mark = parseFloat(p.markPrice);
      const entry = parseFloat(p.entryPrice);
      positions.push({
        exchange: 'aster',
        symbol: p.symbol,
        side: amt > 0 ? 'long' : 'short',
        size: Math.abs(amt),
        notional: Math.abs(amt) * (isFinite(mark) ? mark : 0),
        entryPrice: entry,
        markPrice: isFinite(mark) ? mark : entry,
        leverage: parseFloat(p.leverage) || 1,
        unrealizedPnl: parseFloat(p.unrealizedProfit) || 0,
      });
    }
    return positions;
  },

  async getFundingIncome(creds: Credentials, opts: { symbol?: string; limit?: number } = {}): Promise<NormalizedFundingIncome[]> {
    const params: Record<string, any> = { incomeType: 'FUNDING', limit: opts.limit ?? 100 };
    if (opts.symbol) params.symbol = opts.symbol;
    const data = await binanceReq(BASE, '/fapi/v1/income', creds, params);
    return (data || []).map((r: any) => ({
      symbol: r.symbol,
      income: parseFloat(r.income) || 0,
      time: r.time,
      type: r.incomeType || 'FUNDING',
    }));
  },
};
