import type { Credentials, ExchangeAdapter, NormalizedPosition, NormalizedFundingIncome } from './types.js';
import { bitmartReq } from './signers.js';

const BASE = 'https://api.bitmart.com';

export const bitmartAdapter: ExchangeAdapter = {
  exchange: 'bitmart',
  supportsTrading: false,

  async getPositions(creds: Credentials): Promise<NormalizedPosition[]> {
    const data = await bitmartReq(BASE, '/contract/v1/ifContract/openPositions', creds, {});
    const list: any[] = data?.data?.positions ?? data?.data ?? [];
    const positions: NormalizedPosition[] = [];
    for (const p of list) {
      const amt = parseFloat(p.position_qty ?? p.size);
      if (!amt || amt === 0) continue;
      const mark = parseFloat(p.mark_price);
      const entry = parseFloat(p.avg_entrance_price ?? p.entryPrice);
      positions.push({
        exchange: 'bitmart',
        symbol: p.symbol,
        side: amt > 0 ? 'long' : 'short',
        size: Math.abs(amt),
        notional: Math.abs(amt) * (isFinite(mark) ? mark : 0),
        entryPrice: entry,
        markPrice: isFinite(mark) ? mark : entry,
        leverage: parseFloat(p.leverage) || 1,
        unrealizedPnl: parseFloat(p.unrealized_profit ?? p.unrealizedPnl) || 0,
      });
    }
    return positions;
  },

  async getFundingIncome(creds: Credentials, opts: { symbol?: string; limit?: number } = {}): Promise<NormalizedFundingIncome[]> {
    try {
      const params: Record<string, any> = { limit: opts.limit ?? 100 };
      if (opts.symbol) params.symbol = opts.symbol;
      const data = await bitmartReq(BASE, '/contract/v1/ifContract/fundingHistory', creds, params);
      const list: any[] = data?.data?.records ?? data?.data ?? [];
      return (list || []).map((r: any) => ({
        symbol: r.symbol,
        income: parseFloat(r.funding ?? r.amount) || 0,
        time: Number(r.timestamp ?? r.time) || 0,
        type: 'FUNDING',
      }));
    } catch {
      return [];
    }
  },
};
