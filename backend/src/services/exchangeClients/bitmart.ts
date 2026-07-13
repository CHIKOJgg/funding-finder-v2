import type { Credentials, ExchangeAdapter, NormalizedPosition, NormalizedFundingIncome } from './types.js';
import { bitmartReq } from './signers.js';

const BASE = 'https://api.bitmart.com';

export const bitmartAdapter: ExchangeAdapter = {
  exchange: 'bitmart',
  supportsTrading: false,

  async getPositions(creds: Credentials): Promise<NormalizedPosition[]> {
    const data = await bitmartReq(BASE, '/v2/contract/private/positions', creds);
    const list: any[] = data?.data || [];
    const positions: NormalizedPosition[] = [];
    for (const p of list) {
      const size = parseFloat(p.current_amount);
      if (!size || size === 0) continue;
      const mark = parseFloat(p.mark_price);
      const entry = parseFloat(p.avg_cost);
      const side: 'long' | 'short' = (p.side === 2 || p.position_type === 'short') ? 'short' : 'long';
      positions.push({
        exchange: 'bitmart',
        symbol: p.symbol,
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
    // BitMart has no single simple funding-income endpoint; positions cover the
    // primary PnL view. Return empty (caller tolerates it).
    return [];
  },
};
