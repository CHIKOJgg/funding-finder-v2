import type { Credentials, ExchangeAdapter, NormalizedPosition, NormalizedFundingIncome } from './types.js';
import { accessReq } from './signers.js';

const BASE = 'https://api.blofin.com';

export const blofinAdapter: ExchangeAdapter = {
  exchange: 'blofin',
  supportsTrading: false,

  async getPositions(creds: Credentials): Promise<NormalizedPosition[]> {
    const data = await accessReq(BASE, '/api/v1/asset/positions', creds, { productType: 'swap' });
    const list: any[] = data?.data || [];
    const positions: NormalizedPosition[] = [];
    for (const p of list) {
      const size = parseFloat(p.holdVol ?? p.total);
      if (!size || size === 0) continue;
      const mark = parseFloat(p.markPx ?? p.markPrice);
      const entry = parseFloat(p.openPx ?? p.avgPrice);
      positions.push({
        exchange: 'blofin',
        symbol: p.instId ?? p.symbol,
        side: (p.holdSide ?? p.side) === 'short' ? 'short' : 'long',
        size: Math.abs(size),
        notional: Math.abs(size) * (isFinite(mark) ? mark : 0),
        entryPrice: entry,
        markPrice: isFinite(mark) ? mark : entry,
        leverage: parseFloat(p.lever) || 1,
        unrealizedPnl: parseFloat(p.upl ?? p.unrealizedPnl) || 0,
      });
    }
    return positions;
  },

  async getFundingIncome(creds: Credentials, opts: { symbol?: string; limit?: number } = {}): Promise<NormalizedFundingIncome[]> {
    try {
      const params: Record<string, any> = { productType: 'swap', limit: opts.limit ?? 100 };
      if (opts.symbol) params.instId = opts.symbol;
      const data = await accessReq(BASE, '/api/v1/asset/bills', creds, params);
      const list: any[] = data?.data || [];
      return (list || []).map((r: any) => ({
        symbol: r.instId ?? r.symbol,
        income: parseFloat(r.amount) || 0,
        time: Number(r.ts) || 0,
        type: 'FUNDING',
      }));
    } catch {
      return [];
    }
  },
};
