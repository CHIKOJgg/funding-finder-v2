import type { Credentials, ExchangeAdapter, NormalizedPosition, NormalizedFundingIncome } from './types.js';
import { accessReq } from './signers.js';

const BASE = 'https://api.bitget.com';

export const bitgetAdapter: ExchangeAdapter = {
  exchange: 'bitget',
  supportsTrading: false,

  async getPositions(creds: Credentials): Promise<NormalizedPosition[]> {
    const data = await accessReq(BASE, '/api/v2/mix/position/all-position', creds, { productType: 'usdt-futures' });
    const list: any[] = data?.data?.list || data?.data || [];
    const positions: NormalizedPosition[] = [];
    for (const p of list) {
      const size = parseFloat(p.total);
      if (!size || size === 0) continue;
      const mark = parseFloat(p.markPrice);
      const entry = parseFloat(p.averageOpenPrice);
      const side: 'long' | 'short' = p.holdSide === 'short' ? 'short' : 'long';
      positions.push({
        exchange: 'bitget',
        symbol: p.symbol,
        side,
        size: Math.abs(size),
        notional: Math.abs(size) * (isFinite(mark) ? mark : 0),
        entryPrice: entry,
        markPrice: isFinite(mark) ? mark : entry,
        leverage: parseFloat(p.leverage) || 1,
        unrealizedPnl: parseFloat(p.unrealizedPL) || 0,
      });
    }
    return positions;
  },

  async getFundingIncome(creds: Credentials, opts: { symbol?: string; limit?: number } = {}): Promise<NormalizedFundingIncome[]> {
    const params: Record<string, any> = { productType: 'usdt-futures', incomeType: 'fundingFee', limit: opts.limit ?? 100 };
    if (opts.symbol) params.symbol = opts.symbol;
    const data = await accessReq(BASE, '/api/v2/mix/account/flows', creds, params);
    const list: any[] = data?.data?.list || data?.data || [];
    return (list || []).map((r: any) => ({
      symbol: r.symbol,
      income: parseFloat(r.amount) || 0,
      time: Number(r.time) || 0,
      type: 'FUNDING',
    }));
  },
};
