import crypto from 'crypto';
import axios from 'axios';
import type { Credentials, ExchangeAdapter, NormalizedPosition, NormalizedFundingIncome } from './types.js';

const BASE = 'https://contract.mexc.com';

function mexcSign(params: Record<string, any>, secret: string): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHmac('sha256', secret).update(sorted).digest('hex');
}

async function mexcGet(path: string, creds: Credentials, extra: Record<string, any> = {}): Promise<any> {
  const reqTime = String(Date.now());
  const params: Record<string, any> = { api_key: creds.apiKey, req_time: reqTime, ...extra };
  const signature = mexcSign(params, creds.secret);
  const qs = new URLSearchParams({ ...params, signature }).toString();
  const res = await axios.get(`${BASE}${path}?${qs}`, {
    headers: { ApiKey: creds.apiKey, 'Request-Time': reqTime, Signature: signature },
    timeout: 10000,
  });
  return res.data;
}

export const mexcAdapter: ExchangeAdapter = {
  exchange: 'mexc',
  supportsTrading: false, // read-only for now

  async getPositions(creds) {
    const data = await mexcGet('/api/v1/private/position/open', creds);
    const list = data?.data?.positions || data?.data || [];
    const positions: NormalizedPosition[] = [];
    for (const p of list) {
      const amt = parseFloat(p.positionAmt ?? p.holdVol ?? p.vol);
      if (!amt || amt === 0) continue;
      const mark = parseFloat(p.markPrice ?? p.mark_price);
      positions.push({
        exchange: 'mexc',
        symbol: p.symbol,
        side: amt > 0 ? 'long' : 'short',
        size: Math.abs(amt),
        notional: Math.abs(amt) * (isFinite(mark) ? mark : 0),
        entryPrice: parseFloat(p.avgPrice ?? p.avg_price) || 0,
        markPrice: isFinite(mark) ? mark : parseFloat(p.avgPrice ?? p.avg_price) || 0,
        leverage: parseFloat(p.leverage) || 1,
        unrealizedPnl: parseFloat(p.unRealizedPnl ?? p.unrealisedPnl ?? p.unrealizedPnl) || 0,
      });
    }
    return positions;
  },

  async getFundingIncome(creds, opts = {}) {
    // MEXC bill history by type; best-effort. `type=FUNDING` if supported.
    try {
      const data = await mexcGet('/api/v1/private/funding/history', creds, {
        page_num: 1,
        page_size: opts.limit ?? 100,
      });
      const list = data?.data?.list || data?.data || [];
      return (list as any[]).map((r) => ({
        symbol: r.symbol,
        income: parseFloat(r.funding || r.amount || r.pnl) || 0,
        time: Number(r.createTime || r.time || r.ts) || Date.parse(r.createTime || r.time || 0),
        type: 'FUNDING',
      }));
    } catch {
      return [];
    }
  },
};
