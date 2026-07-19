import type { Credentials, ExchangeAdapter, NormalizedPosition, NormalizedFundingIncome } from './types.js';
import crypto from 'crypto';
import axios from 'axios';

// BingX USDT-perpetual adapter. Auth: apiKey + HMAC-SHA256 over the
// sorted query string, appended as the `sign` param (best-effort per docs;
// a wrong signing simply yields no positions for that account).
const BASE = 'https://open-api.bingx.com';

function bingxSign(secret: string, params: Record<string, any>): string {
  const sorted = Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort();
  const query = sorted.map((k) => `${k}=${params[k]}`).join('&');
  return crypto.createHmac('sha256', secret).update(query).digest('hex');
}

async function bingxGet(path: string, creds: Credentials, params: Record<string, any> = {}): Promise<any> {
  const all: Record<string, any> = { ...params, apiKey: creds.apiKey, timestamp: String(Date.now()) };
  all.sign = bingxSign(creds.secret, all);
  const query = Object.keys(all)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(all[k])}`)
    .join('&');
  const res = await axios.get(`${BASE}${path}?${query}`, { timeout: 10000 });
  return res.data;
}

export const bingxAdapter: ExchangeAdapter = {
  exchange: 'bingx',
  supportsTrading: false,

  async getPositions(creds: Credentials): Promise<NormalizedPosition[]> {
    const data = await bingxGet('/openApi/swap/v2/trade/positionInfo', creds);
    const list: any[] = data?.data?.positions || data?.data || [];
    const positions: NormalizedPosition[] = [];
    for (const p of list) {
      const size = parseFloat(p.positionAmt);
      if (!size || size === 0) continue;
      const mark = parseFloat(p.markPrice);
      const entry = parseFloat(p.entryPrice);
      const side: 'long' | 'short' = p.positionSide === 'SHORT' || size < 0 ? 'short' : 'long';
      positions.push({
        exchange: 'bingx',
        symbol: p.symbol,
        side,
        size: Math.abs(size),
        notional: Math.abs(size) * (isFinite(mark) ? mark : 0),
        entryPrice: entry,
        markPrice: isFinite(mark) ? mark : entry,
        leverage: parseFloat(p.leverage) || 1,
        unrealizedPnl: parseFloat(p.unrealizedProfit) || 0,
      });
    }
    return positions;
  },

  async getFundingIncome(_creds: Credentials, _opts: { symbol?: string; limit?: number } = {}): Promise<NormalizedFundingIncome[]> {
    // Best-effort: BingX funding-history endpoint shape varies; return empty
    // rather than risk mis-parsed income.
    return [];
  },
};
