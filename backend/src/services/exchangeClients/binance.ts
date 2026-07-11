import crypto from 'crypto';
import axios from 'axios';
import type { Credentials, ExchangeAdapter, NormalizedPosition, NormalizedFundingIncome } from './types.js';

const BASE = 'https://fapi.binance.com';
const RECV_WINDOW = 5000;

function sign(query: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(query).digest('hex');
}

async function signedGet(path: string, creds: Credentials, params: Record<string, any> = {}): Promise<any> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  q.set('timestamp', String(Date.now()));
  q.set('recvWindow', String(RECV_WINDOW));
  const query = q.toString();
  const sig = sign(query, creds.secret);
  const url = `${BASE}${path}?${query}&signature=${sig}`;
  const res = await axios.get(url, { headers: { 'X-MBX-APIKEY': creds.apiKey }, timeout: 10000 });
  return res.data;
}

async function signedPost(path: string, creds: Credentials, params: Record<string, any>): Promise<any> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  q.set('timestamp', String(Date.now()));
  q.set('recvWindow', String(RECV_WINDOW));
  const query = q.toString();
  const sig = sign(query, creds.secret);
  const body = `${query}&signature=${sig}`;
  const res = await axios.post(`${BASE}${path}`, body, {
    headers: {
      'X-MBX-APIKEY': creds.apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: 10000,
  });
  return res.data;
}

export const binanceAdapter: ExchangeAdapter = {
  exchange: 'binance',
  supportsTrading: true,

  async getPositions(creds) {
    const data = await signedGet('/fapi/v2/positionRisk', creds);
    const positions: NormalizedPosition[] = [];
    for (const p of data) {
      const amt = parseFloat(p.positionAmt);
      if (!amt || amt === 0) continue;
      const mark = parseFloat(p.markPrice);
      const entry = parseFloat(p.entryPrice);
      const notional = Math.abs(amt) * (isFinite(mark) ? mark : 0);
      positions.push({
        exchange: 'binance',
        symbol: p.symbol,
        side: amt > 0 ? 'long' : 'short',
        size: Math.abs(amt),
        notional,
        entryPrice: entry,
        markPrice: isFinite(mark) ? mark : entry,
        leverage: parseFloat(p.leverage) || 1,
        unrealizedPnl: parseFloat(p.unrealizedProfit) || 0,
      });
    }
    return positions;
  },

  async getFundingIncome(creds, opts = {}) {
    const params: Record<string, any> = { incomeType: 'FUNDING', limit: opts.limit ?? 100 };
    if (opts.symbol) params.symbol = opts.symbol;
    const data = await signedGet('/fapi/v1/income', creds, params);
    return (data as any[]).map((r) => ({
      symbol: r.symbol,
      income: parseFloat(r.income) || 0,
      time: r.time,
      type: r.incomeType || 'FUNDING',
    }));
  },

  async placeMarketOrder(creds, { symbol, side, notionalUsd }) {
    // Buy to open long, sell to open short. quoteOrderQty sizes by USDT.
    const binanceSide = side === 'long' ? 'BUY' : 'SELL';
    return signedPost('/fapi/v1/order', creds, {
      symbol,
      side: binanceSide,
      type: 'MARKET',
      quoteOrderQty: Math.round(notionalUsd),
    });
  },
};
