import type { Credentials, ExchangeAdapter, NormalizedPosition, NormalizedFundingIncome } from './types.js';
import { wooReq } from './signers.js';

const BASE = 'https://api.woo.org';

export const wooAdapter: ExchangeAdapter = {
  exchange: 'woo',
  supportsTrading: false,

  async getPositions(creds: Credentials): Promise<NormalizedPosition[]> {
    const data = await wooReq(BASE, '/v3/positions', creds, {});
    const list: any[] = data?.rows ?? data?.data ?? [];
    const positions: NormalizedPosition[] = [];
    for (const p of list) {
      const amt = parseFloat(p.size ?? p.position);
      if (!amt || amt === 0) continue;
      const mark = parseFloat(p.markPrice);
      const entry = parseFloat(p.averageOpenPrice ?? p.entryPrice);
      positions.push({
        exchange: 'woo',
        symbol: p.symbol,
        side: (p.side ?? (amt > 0 ? 'LONG' : 'SHORT')).toLowerCase() === 'short' ? 'short' : 'long',
        size: Math.abs(amt),
        notional: Math.abs(amt) * (isFinite(mark) ? mark : 0),
        entryPrice: entry,
        markPrice: isFinite(mark) ? mark : entry,
        leverage: parseFloat(p.leverage) || 1,
        unrealizedPnl: parseFloat(p.unrealizedPnl ?? p.pnl) || 0,
      });
    }
    return positions;
  },

  async getFundingIncome(creds: Credentials, opts: { symbol?: string; limit?: number } = {}): Promise<NormalizedFundingIncome[]> {
    try {
      const params: Record<string, any> = { pageSize: opts.limit ?? 100 };
      if (opts.symbol) params.symbol = opts.symbol;
      const data = await wooReq(BASE, '/v3/funding_fee/history', creds, params);
      const list: any[] = data?.rows ?? data?.data ?? [];
      return (list || []).map((r: any) => ({
        symbol: r.symbol,
        income: parseFloat(r.fundingFee ?? r.amount) || 0,
        time: Number(r.timestamp) || 0,
        type: 'FUNDING',
      }));
    } catch {
      return [];
    }
  },
};
