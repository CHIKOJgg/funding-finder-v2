import type { Credentials, ExchangeAdapter, NormalizedPosition, NormalizedFundingIncome } from './types.js';
import { binanceReq } from './signers.js';

const BASE = 'https://fapi.asterdex.com';

export const asterAdapter: ExchangeAdapter = {
  exchange: 'aster',
  supportsTrading: false,

  async getPositions(creds: Credentials): Promise<NormalizedPosition[]> {
    const data = await binanceReq(BASE, '/fapi/v2/positionRisk', creds, {});
    const list: any[] = Array.isArray(data) ? data : [];
    const positions: NormalizedPosition[] = [];
    for (const p of list) {
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
        unrealizedPnl: parseFloat(p.unRealizedProfit) || 0,
      });
    }
    return positions;
  },

  async getFundingIncome(creds: Credentials, opts: { symbol?: string; limit?: number } = {}): Promise<NormalizedFundingIncome[]> {
    try {
      const params: Record<string, any> = { limit: opts.limit ?? 100 };
      if (opts.symbol) params.symbol = opts.symbol;
      const data = await binanceReq(BASE, '/fapi/v1/income', creds, params);
      const list: any[] = Array.isArray(data) ? data : [];
      return (list || [])
        .filter((r: any) => r.incomeType === 'FUNDING_FEE' || !r.incomeType)
        .map((r: any) => ({
          symbol: r.symbol,
          income: parseFloat(r.income) || 0,
          time: Number(r.time) || 0,
          type: 'FUNDING',
        }));
    } catch {
      return [];
    }
  },
};
