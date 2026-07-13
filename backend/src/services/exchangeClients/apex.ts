import type { Credentials, ExchangeAdapter, NormalizedPosition, NormalizedFundingIncome } from './types.js';
import { accessReq } from './signers.js';

const BASE = 'https://omni.apex.exchange/api/v3';
const APEX_HEADERS = { key: 'APEX-API-KEY', sign: 'APEX-SIGNATURE', ts: 'APEX-TIMESTAMP', pass: 'APEX-PASSPHRASE' };

export const apexAdapter: ExchangeAdapter = {
  exchange: 'apex',
  supportsTrading: false,

  async getPositions(creds: Credentials): Promise<NormalizedPosition[]> {
    const data = await accessReq(BASE, '/v3/positions', creds, {}, 'GET', APEX_HEADERS);
    const list: any[] = data?.data || [];
    const positions: NormalizedPosition[] = [];
    for (const p of list) {
      const size = parseFloat(p.size);
      if (!size || size === 0) continue;
      const mark = parseFloat(p.markPrice);
      const entry = parseFloat(p.entryPrice);
      const side: 'long' | 'short' = (p.side === 'short' || size < 0) ? 'short' : 'long';
      positions.push({
        exchange: 'apex',
        symbol: p.symbol,
        side,
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

  async getFundingIncome(_creds: Credentials, _opts: { symbol?: string; limit?: number } = {}): Promise<NormalizedFundingIncome[]> {
    return [];
  },
};
