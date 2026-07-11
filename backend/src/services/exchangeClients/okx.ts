import crypto from 'crypto';
import axios from 'axios';
import type { Credentials, ExchangeAdapter, NormalizedPosition, NormalizedFundingIncome } from './types.js';

const BASE = 'https://www.okx.com';

function toOkxInstId(symbol: string): string {
  const base = symbol.replace(/USDT$/i, '');
  return `${base}-USDT-SWAP`;
}
function toAppSymbol(instId: string): string {
  return instId.replace(/-USDT-SWAP$/i, '') + 'USDT';
}

function okxSign(method: string, requestPath: string, creds: Credentials, body = ''): Record<string, string> {
  const timestamp = new Date().toISOString();
  const preHash = timestamp + method.toUpperCase() + requestPath + body;
  const signature = crypto.createHmac('sha256', creds.secret).update(preHash).digest('base64');
  return {
    'OK-ACCESS-KEY': creds.apiKey,
    'OK-ACCESS-SIGN': signature,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': (creds as any).passphrase || '',
    'Content-Type': 'application/json',
  };
}

async function okxGet(path: string, creds: Credentials, params: Record<string, any> = {}): Promise<any> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const qs = q.toString();
  const requestPath = `/api/v5${path}${qs ? '?' + qs : ''}`;
  const res = await axios.get(`${BASE}${requestPath}`, { headers: okxSign('GET', requestPath, creds), timeout: 10000 });
  return res.data;
}

async function okxPost(path: string, creds: Credentials, params: Record<string, any>): Promise<any> {
  const body = JSON.stringify(params);
  const requestPath = `/api/v5${path}`;
  const res = await axios.post(`${BASE}${requestPath}`, body, { headers: okxSign('POST', requestPath, creds, body), timeout: 10000 });
  return res.data;
}

export const okxAdapter: ExchangeAdapter = {
  exchange: 'okx',
  supportsTrading: true,

  async getPositions(creds) {
    const data = await okxGet('/account/positions', creds, { instType: 'SWAP' });
    const list = data?.data || [];
    const positions: NormalizedPosition[] = [];
    for (const p of list) {
      const pos = parseFloat(p.pos);
      if (!pos || pos === 0) continue;
      const mark = parseFloat(p.markPx);
      positions.push({
        exchange: 'okx',
        symbol: toAppSymbol(p.instId),
        side: pos > 0 ? 'long' : 'short',
        size: Math.abs(pos),
        notional: parseFloat(p.notionalUsd) || Math.abs(pos) * (isFinite(mark) ? mark : 0),
        entryPrice: parseFloat(p.avgPx) || 0,
        markPrice: isFinite(mark) ? mark : parseFloat(p.avgPx) || 0,
        leverage: parseFloat(p.lever) || 1,
        unrealizedPnl: parseFloat(p.upl) || 0,
      });
    }
    return positions;
  },

  async getFundingIncome(creds, opts = {}) {
    const params: Record<string, any> = { instType: 'SWAP', type: 'funding-fee', limit: String(opts.limit ?? 100) };
    if (opts.symbol) params.instId = toOkxInstId(opts.symbol);
    const data = await okxGet('/account/bills', creds, params);
    const list = data?.data || [];
    return list.map((r: any) => ({
      symbol: r.instId ? toAppSymbol(r.instId) : '',
      income: parseFloat(r.balChg) || 0,
      time: Number(r.ts) || Date.parse(r.ts) || 0,
      type: 'FUNDING',
    }));
  },

  async placeMarketOrder(creds, { symbol, side, notionalUsd }) {
    const instId = toOkxInstId(symbol);
    const ticker = await okxGet('/market/ticker', creds, { instId });
    const last = parseFloat(ticker?.data?.[0]?.last) || parseFloat(ticker?.data?.[0]?.markPx);
    if (!last) throw new Error('Не удалось получить цену для расчёта объёма');
    const sz = (notionalUsd / last).toFixed(6);
    return okxPost('/trade/order', creds, {
      instId,
      tdMode: 'cross',
      side: side === 'long' ? 'buy' : 'sell',
      ordType: 'market',
      sz,
    });
  },
};
