import type { Credentials, ExchangeAdapter, NormalizedPosition, NormalizedFundingIncome } from './types.js';
import { huobiReq } from './signers.js';

const BASE = 'https://api.hbdm.com';
const HOST = 'api.hbdm.com';

export const htxAdapter: ExchangeAdapter = {
  exchange: 'htx',
  supportsTrading: false,

  async getPositions(creds: Credentials): Promise<NormalizedPosition[]> {
    const data = await huobiReq(BASE, HOST, '/linear-swap-api/v1/swap_position_info', creds);
    const list: any[] = data?.data || [];
    const positions: NormalizedPosition[] = [];
    for (const p of list) {
      const size = parseFloat(p.volume);
      if (!size || size === 0) continue;
      const mark = parseFloat(p.last_price);
      const entry = parseFloat(p.avg_open_price);
      const side: 'long' | 'short' = p.direction === 'sell' ? 'short' : 'long';
      positions.push({
        exchange: 'htx',
        symbol: p.contract_code,
        side,
        size: Math.abs(size),
        notional: Math.abs(size) * (isFinite(mark) ? mark : 0),
        entryPrice: entry,
        markPrice: isFinite(mark) ? mark : entry,
        leverage: parseFloat(p.leverage) || 1,
        unrealizedPnl: parseFloat(p.profit_unreal) || 0,
      });
    }
    return positions;
  },

  async getFundingIncome(_creds: Credentials, _opts: { symbol?: string; limit?: number } = {}): Promise<NormalizedFundingIncome[]> {
    return [];
  },
};
