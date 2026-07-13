import type { Credentials, ExchangeAdapter, NormalizedPosition, NormalizedFundingIncome } from './types.js';
import { accessReq } from './signers.js';

const BASE = 'https://openapi.blofin.com';

export const blofinAdapter: ExchangeAdapter = {
  exchange: 'blofin',
  supportsTrading: false,

  async getPositions(creds: Credentials): Promise<NormalizedPosition[]> {
    const data = await accessReq(BASE, '/api/v1/trade/positions', creds, { instType: 'SWAP' });
    const list: any[] = data?.data || [];
    const positions: NormalizedPosition[] = [];
    for (const p of list) {
      const size = parseFloat(p.pos);
      if (!size || size === 0) continue;
      const mark = parseFloat(p.markPx);
      const entry = parseFloat(p.avgPx);
      const side: 'long' | 'short' = (p.side === 'short' || size < 0) ? 'short' : 'long';
      positions.push({
        exchange: 'blofin',
        symbol: p.instId,
        side: size < 0 ? 'short' : 'long',
        size: Math.abs(size),
        notional: Math.abs(size) * (isFinite(mark) ? mark : 0),
        entryPrice: entry,
        markPrice: isFinite(mark) ? mark : entry,
        leverage: parseFloat(p.lever) || 1,
        unrealizedPnl: parseFloat(p.upl) || 0,
      });
    }
    return positions;
  },

  async getFundingIncome(creds: Credentials, opts: { symbol?: string; limit?: number } = {}): Promise<NormalizedFundingIncome[]> {
    const params: Record<string, any> = { type: 'funding' };
    if (opts.symbol) params.instId = opts.symbol;
    const data = await accessReq(BASE, '/api/v1/asset/bills', creds, params);
    const list: any[] = data?.data || [];
    return (list || []).map((r: any) => ({
      symbol: r.instId,
      income: parseFloat(r.amount) || 0,
      time: Number(r.ts) || 0,
      type: 'FUNDING',
    }));
  },
};
