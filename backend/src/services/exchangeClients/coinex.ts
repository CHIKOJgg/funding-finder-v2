import type { Credentials, ExchangeAdapter, NormalizedPosition, NormalizedFundingIncome } from './types.js';
import { coinexReq } from './signers.js';

const BASE = 'https://api.coinex.com';

export const coinexAdapter: ExchangeAdapter = {
  exchange: 'coinex',
  supportsTrading: false,

  async getPositions(creds: Credentials): Promise<NormalizedPosition[]> {
    const data = await coinexReq(BASE, '/v2/futures/position', creds, {});
    const list: any[] = data?.data?.list ?? data?.data ?? [];
    const positions: NormalizedPosition[] = [];
    for (const p of list) {
      const amt = parseFloat(p.amount ?? p.volume);
      if (!amt || amt === 0) continue;
      const mark = parseFloat(p.last_price ?? p.markPrice);
      const entry = parseFloat(p.avg_price ?? p.entryPrice);
      positions.push({
        exchange: 'coinex',
        symbol: p.market ?? p.symbol,
        side: amt > 0 ? 'long' : 'short',
        size: Math.abs(amt),
        notional: Math.abs(amt) * (isFinite(mark) ? mark : 0),
        entryPrice: entry,
        markPrice: isFinite(mark) ? mark : entry,
        leverage: parseFloat(p.leverage) || 1,
        unrealizedPnl: parseFloat(p.unrealized_pnl ?? p.unrealizedPnl) || 0,
      });
    }
    return positions;
  },

  async getFundingIncome(creds: Credentials, opts: { symbol?: string; limit?: number } = {}): Promise<NormalizedFundingIncome[]> {
    try {
      const params: Record<string, any> = { page: 1, limit: opts.limit ?? 100 };
      if (opts.symbol) params.market = opts.symbol;
      const data = await coinexReq(BASE, '/v2/futures/funding-history', creds, params);
      const list: any[] = data?.data?.list ?? data?.data ?? [];
      return (list || []).map((r: any) => ({
        symbol: r.market ?? r.symbol,
        income: parseFloat(r.funding ?? r.amount) || 0,
        time: Number(r.created_at ?? r.time) || 0,
        type: 'FUNDING',
      }));
    } catch {
      return [];
    }
  },
};
