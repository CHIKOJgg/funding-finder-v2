import crypto from 'crypto';
import axios from 'axios';
import type { Credentials, ExchangeAdapter, NormalizedPosition, NormalizedFundingIncome } from './types.js';
import { getGateFundingInterval } from './fundingIntervals.js';

const BASE = 'https://api.gateio.ws';
const RECV_WINDOW = 1000; // Gate requires the timestamp to be within 1000s

function gateSign(method: string, pathWithQuery: string, payload: string, timestampSec: number, secret: string): string {
  const hashed = crypto.createHash('sha512').update(payload).digest('hex');
  const prehash = `${method}\n${pathWithQuery}\n${hashed}\n${timestampSec}`;
  return crypto.createHmac('sha512', secret).update(prehash).digest('hex');
}

function gateHeaders(method: string, pathWithQuery: string, payload: string, creds: Credentials) {
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = gateSign(method, pathWithQuery, payload, timestamp, creds.secret);
  return {
    KEY: creds.apiKey,
    Timestamp: String(timestamp),
    SIGN: sign,
    'Content-Type': 'application/json',
  };
}

function toAppSymbol(contract: string): string {
  return contract.replace(/_USDT$/i, 'USDT').replace(/_/g, '');
}

async function gateGet(path: string, creds: Credentials, query: Record<string, any> = {}): Promise<any> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const qs = q.toString();
  const pathWithQuery = qs ? `${path}?${qs}` : path;
  const headers = gateHeaders('GET', pathWithQuery, '', creds);
  const res = await axios.get(`${BASE}${pathWithQuery}`, { headers, timeout: 10000 });
  return res.data;
}

export const gateAdapter: ExchangeAdapter = {
  exchange: 'gate',
  supportsTrading: false, // trading not implemented yet; read-only for now

  async getPositions(creds) {
    const data = await gateGet('/api/v4/futures/usdt/positions', creds);
    const entries = (data || []).filter((e: any) => e?.position && parseFloat(e.position.size));
    const symbols = Array.from(new Set(entries.map((e: any) => toAppSymbol(e.contract)).filter(Boolean))) as string[];
    const intervalMap: Record<string, number> = {};
    await Promise.all(symbols.map(async (s: string) => {
      const h = await getGateFundingInterval(s);
      if (h) intervalMap[s] = h;
    }));
    const positions: NormalizedPosition[] = [];
    for (const entry of entries) {
      const pos = entry.position;
      const size = parseFloat(pos.size);
      const mark = parseFloat(pos.mark_price);
      const symbol = toAppSymbol(entry.contract);
      positions.push({
        exchange: 'gate',
        symbol,
        side: size > 0 ? 'long' : 'short',
        size: Math.abs(size),
        notional: Math.abs(size) * (isFinite(mark) ? mark : 0),
        entryPrice: parseFloat(pos.entry_price) || 0,
        markPrice: isFinite(mark) ? mark : parseFloat(pos.entry_price) || 0,
        leverage: parseFloat(pos.leverage) || parseFloat(entry.leverage) || 1,
        unrealizedPnl: parseFloat(pos.unrealised_pnl) || 0,
        fundingIntervalHours: intervalMap[symbol],
      });
    }
    return positions;
  },

  async getFundingIncome(creds, opts = {}) {
    const positions = await this.getPositions(creds);
    const contracts = [...new Set(positions.map((p) => `${p.symbol.replace(/USDT$/i, '')}_USDT`))];
    const limit = opts.limit ?? 50;
    const out: NormalizedFundingIncome[] = [];
    await Promise.all(
      contracts.map(async (contract) => {
        try {
          const data = await gateGet(`/api/v4/futures/usdt/contracts/${contract}/funding_history`, creds, { limit });
          for (const h of data?.history || []) {
            out.push({
              symbol: toAppSymbol(contract),
              income: parseFloat(h.p) || 0,
              time: (Number(h.t) || 0) * 1000,
              type: 'FUNDING',
            });
          }
        } catch {
          /* ignore per-contract funding errors */
        }
      })
    );
    return out;
  },
};
