import type { Credentials, ExchangeAdapter, NormalizedPosition, NormalizedFundingIncome } from './types.js';
import { wexStyleReq } from './signers.js';

const BASE = 'https://api.weex.com';

export const weexAdapter: ExchangeAdapter = {
  exchange: 'weex',
  supportsTrading: false,

  async getPositions(creds: Credentials): Promise<NormalizedPosition[]> {
    const data = await wexStyleReq(BASE, '/api/v1/futures/private/position', creds);
    const list: any[] = data?.data || [];
    const positions: NormalizedPosition[] = [];
    for (const p of list) {
      const size = parseFloat(p.positionAmount) || parseFloat(p.amount) || parseFloat(p.volume);
      if (!size || size === 0) continue;
      const mark = parseFloat(p.markPrice);
      const entry = parseFloat(p.avgPrice);
      const side: 'long' | 'short' = (p.side === 'short' || size < 0) ? 'short' : 'long';
      positions.push({
        exchange: 'weex',
        symbol: p.symbol,
        side,
        size: Math.abs(size),
        notional: Math.abs(size) * (isFinite(mark) ? mark : 0),
        entryPrice: entry,
        markPrice: isFinite(mark) ? mark : entry,
        leverage: parseFloat(p.leverage) || 1,
        unrealizedPnl: parseFloat(p.unrealizedProfit) || parseFloat(p.unrealisedPnl) || 0,
      });
    }
    return positions;
  },

  async getFundingIncome(_creds: Credentials, _opts: { symbol?: string; limit?: number } = {}): Promise<NormalizedFundingIncome[]> {
    return [];
  },
};
