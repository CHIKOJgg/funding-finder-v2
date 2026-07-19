import type { Credentials, ExchangeAdapter, NormalizedPosition, NormalizedFundingIncome } from './types.js';
import { accessReq } from './signers.js';

const BASE = 'https://openapi.apex.exchange';

export const apexAdapter: ExchangeAdapter = {
  exchange: 'apex',
  supportsTrading: false,

  async getPositions(creds: Credentials): Promise<NormalizedPosition[]> {
    const data = await accessReq(BASE, '/api/v3/position', creds, {});
    const list: any[] = data?.data ?? [];
    const positions: NormalizedPosition[] = [];
    for (const p of list) {
      const size = parseFloat(p.size);
      if (!size || size === 0) continue;
      const mark = parseFloat(p.markPrice);
      const entry = parseFloat(p.entryPrice ?? p.avgPrice);
      positions.push({
        exchange: 'apex',
        symbol: p.symbol,
        side: size > 0 ? 'long' : 'short',
        size: Math.abs(size),
        notional: Math.abs(size) * (isFinite(mark) ? mark : 0),
        entryPrice: entry,
        markPrice: isFinite(mark) ? mark : entry,
        leverage: parseFloat(p.leverage) || 1,
        unrealizedPnl: parseFloat(p.unrealizedPnl) || 0,
      });
    }
    return positions;
  },

  async getFundingIncome(creds: Credentials, opts: { symbol?: string; limit?: number } = {}): Promise<NormalizedFundingIncome[]> {
    try {
      const params: Record<string, any> = { limit: opts.limit ?? 100 };
      if (opts.symbol) params.symbol = opts.symbol;
      const data = await accessReq(BASE, '/api/v3/funding-history', creds, params);
      const list: any[] = data?.data ?? [];
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
