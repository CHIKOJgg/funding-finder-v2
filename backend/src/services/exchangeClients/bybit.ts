import crypto from 'crypto';
import axios from 'axios';
import type { Credentials, ExchangeAdapter, NormalizedPosition } from './types.js';

const BASE = 'https://api.bybit.com';
const RECV_WINDOW = '5000';

interface BybitSign {
  headers: Record<string, string>;
  query: string; // for GET url
  body?: string; // for POST
}

function bybitSign(method: string, path: string, creds: Credentials, params: Record<string, any>): BybitSign {
  const timestamp = String(Date.now());
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const query = q.toString();
  const body = method === 'POST' ? JSON.stringify(params) : undefined;
  const preHash = timestamp + creds.apiKey + RECV_WINDOW + (method === 'POST' ? body! : query);
  const signature = crypto.createHmac('sha256', creds.secret).update(preHash).digest('hex');
  const headers: Record<string, string> = {
    'X-BAPI-API-KEY': creds.apiKey,
    'X-BAPI-TIMESTAMP': timestamp,
    'X-BAPI-RECV-WINDOW': RECV_WINDOW,
    'X-BAPI-SIGN': signature,
  };
  return { headers, query, body };
}

async function bybitGet(path: string, creds: Credentials, params: Record<string, any> = {}): Promise<any> {
  const { headers, query } = bybitSign('GET', path, creds, params);
  const res = await axios.get(`${BASE}${path}?${query}`, { headers, timeout: 10000 });
  return res.data;
}

async function bybitPost(path: string, creds: Credentials, params: Record<string, any>): Promise<any> {
  const { headers, body } = bybitSign('POST', path, creds, params);
  headers['Content-Type'] = 'application/json';
  const res = await axios.post(`${BASE}${path}`, body, { headers, timeout: 10000 });
  return res.data;
}

export const bybitAdapter: ExchangeAdapter = {
  exchange: 'bybit',
  supportsTrading: true,

  async getPositions(creds) {
    const data = await bybitGet('/v5/position/list', creds, { category: 'linear', settleCoin: 'USDT', limit: '200' });
    const list = data?.result?.list || [];
    const positions: NormalizedPosition[] = [];
    for (const p of list) {
      const size = parseFloat(p.size);
      if (!size || size === 0) continue;
      const mark = parseFloat(p.markPrice);
      positions.push({
        exchange: 'bybit',
        symbol: p.symbol,
        side: (p.side === 'Sell' ? 'short' : 'long'),
        size: Math.abs(size),
        notional: parseFloat(p.positionValue) || Math.abs(size) * (isFinite(mark) ? mark : 0),
        entryPrice: parseFloat(p.avgPrice) || 0,
        markPrice: isFinite(mark) ? mark : parseFloat(p.avgPrice) || 0,
        leverage: parseFloat(p.leverage) || 1,
        unrealizedPnl: parseFloat(p.unrealisedPnl) || 0,
      });
    }
    return positions;
  },

  async getFundingIncome(creds, opts = {}) {
    const params: Record<string, any> = {
      category: 'linear',
      type: 'FUNDING_FEE', // careful: Bybit uses type enum, verify with docs
      limit: String(opts.limit ?? 100),
    };
    if (opts.symbol) params.symbol = opts.symbol;
    const data = await bybitGet('/v5/account/transaction-log', creds, params);
    const list = data?.result?.list || [];
    return list.map((r: any) => ({
      symbol: r.symbol,
      income: parseFloat(r.cashFlow) || 0,
      time: Number(r.execTime) || Date.parse(r.execTime) || 0,
      type: 'FUNDING',
    }));
  },

  async placeMarketOrder(creds, { symbol, side, notionalUsd }) {
    // Resolve mark price to derive base quantity.
    const ticker = await bybitGet('/v5/market/tickers', creds, { category: 'linear', symbol });
    const last = parseFloat(ticker?.result?.list?.[0]?.lastPrice) || parseFloat(ticker?.result?.list?.[0]?.markPrice);
    if (!last) throw new Error('Не удалось получить цену для расчёта объёма');
    const qty = (notionalUsd / last).toFixed(6);
    return bybitPost('/v5/order/create', creds, {
      category: 'linear',
      symbol,
      side: side === 'long' ? 'Buy' : 'Sell',
      orderType: 'Market',
      qty,
      timeInForce: 'GTC',
    });
  },
};
