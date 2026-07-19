import type { Credentials, ExchangeAdapter, NormalizedPosition, NormalizedFundingIncome } from './types.js';
import { wexStyleReq } from './signers.js';

const BASE = 'https://fapi.coinw.com';

export const coinwAdapter: ExchangeAdapter = {
  exchange: 'coinw',
  supportsTrading: false,

  async getPositions(creds: Credentials): Promise<NormalizedPosition[]> {
    const data = await wexStyleReq(BASE, '/api/v1/position/list', creds, {});
    const list: any[] = data?.data?.positions ?? data?.data ?? [];
    const positions: NormalizedPosition[] = [];
    for (const p of list) {
      const amt = parseFloat(p.positionAmt ?? p.vol);
      if (!amt || amt === 0) continue;
      const mark = parseFloat(p.markPrice);
      const entry = parseFloat(p.entryPrice);
      positions.push({
        exchange: 'coinw',
        symbol: p.symbol,
        side: amt > 0 ? 'long' : 'short',
        size: Math.abs(amt),
        notional: Math.abs(amt) * (isFinite(mark) ? mark : 0),
        entryPrice: entry,
        markPrice: isFinite(mark) ? mark : entry,
        leverage: parseFloat(p.leverage) || 1,
        unrealizedPnl: parseFloat(p.unRealizedPnl ?? p.unrealizedPnl) || 0,
      });
    }
    return positions;
  },

  async getFundingIncome(creds: Credentials, opts: { symbol?: string; limit?: number } = {}): Promise<NormalizedFundingIncome[]> {
    try {
      const params: Record<string, any> = { page: 1, pageSize: opts.limit ?? 100 };
      if (opts.symbol) params.symbol = opts.symbol;
      const data = await wexStyleReq(BASE, '/api/v1/funding/record', creds, params);
      const list: any[] = data?.data?.rows ?? data?.data ?? [];
      return (list || []).map((r: any) => ({
        symbol: r.symbol,
        income: parseFloat(r.funding ?? r.amount) || 0,
        time: Number(r.time) || 0,
        type: 'FUNDING',
      }));
    } catch {
      return [];
    }
  },
};
