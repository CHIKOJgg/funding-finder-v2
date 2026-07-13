import type { Credentials, ExchangeAdapter, NormalizedPosition, NormalizedFundingIncome } from './types.js';
import { coinexReq } from './signers.js';

const BASE = 'https://api.coinex.com/v2';

export const coinexAdapter: ExchangeAdapter = {
  exchange: 'coinex',
  supportsTrading: false,

  async getPositions(creds: Credentials): Promise<NormalizedPosition[]> {
    const data = await coinexReq(BASE, '/futures/position', creds);
    const list: any[] = data?.data || [];
    const positions: NormalizedPosition[] = [];
    for (const p of list) {
      const size = parseFloat(p.amount);
      if (!size || size === 0) continue;
      const mark = parseFloat(p.last_price) || parseFloat(p.mark_price);
      const entry = parseFloat(p.avg_price);
      const side: 'long' | 'short' = (p.side === 'short' || size < 0) ? 'short' : 'long';
      positions.push({
        exchange: 'coinex',
        symbol: p.market,
        side,
        size: Math.abs(size),
        notional: Math.abs(size) * (isFinite(mark) ? mark : 0),
        entryPrice: entry,
        markPrice: isFinite(mark) ? mark : entry,
        leverage: parseFloat(p.leverage) || 1,
        unrealizedPnl: parseFloat(p.unrealized_pnl) || 0,
      });
    }
    return positions;
  },

  async getFundingIncome(_creds: Credentials, _opts: { symbol?: string; limit?: number } = {}): Promise<NormalizedFundingIncome[]> {
    return [];
  },
};
