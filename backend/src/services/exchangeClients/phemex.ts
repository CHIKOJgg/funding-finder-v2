import type { Credentials, ExchangeAdapter, NormalizedPosition, NormalizedFundingIncome } from './types.js';
import { phemexReq } from './signers.js';

const BASE = 'https://api.phemex.com';

export const phemexAdapter: ExchangeAdapter = {
  exchange: 'phemex',
  supportsTrading: false,

  async getPositions(creds: Credentials): Promise<NormalizedPosition[]> {
    const data = await phemexReq(BASE, '/gateway-api/v1/position/list', creds);
    const list: any[] = data?.data || [];
    const positions: NormalizedPosition[] = [];
    for (const p of list) {
      const size = parseFloat(p.size);
      if (!size || size === 0) continue;
      const mark = parseFloat(p.markPrice);
      const entry = parseFloat(p.avgEntryPrice);
      const side: 'long' | 'short' = (p.side === 'Sell' || p.side === 'short' || size < 0) ? 'short' : 'long';
      positions.push({
        exchange: 'phemex',
        symbol: p.symbol,
        side,
        size: Math.abs(size),
        notional: Math.abs(size) * (isFinite(mark) ? mark : 0),
        entryPrice: entry,
        markPrice: isFinite(mark) ? mark : entry,
        leverage: parseFloat(p.leverage) || 1,
        unrealizedPnl: parseFloat(p.unrealisedPnl) || 0,
      });
    }
    return positions;
  },

  async getFundingIncome(_creds: Credentials, _opts: { symbol?: string; limit?: number } = {}): Promise<NormalizedFundingIncome[]> {
    return [];
  },
};
