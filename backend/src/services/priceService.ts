import axios from 'axios';
import { logger } from '../utils/logger.js';
import { cachedRequest } from '../utils/exchangeClient.js';

// Live last-price for perpetual contracts, keyed by (exchange, symbol) and
// cached briefly. The Funding list only fetches prices for the coins the user
// is actually looking at (the visible rows), and reuses this cache across
// requests — so we never hammer the exchanges for the whole market at once.
const PRICE_CACHE_TTL_MS = 10_000;

function okxInstId(contract: string): string {
  const u = contract.toUpperCase();
  if (u.endsWith('-SWAP')) return u;
  const m = u.match(/^(.*?)(USDT|USDC|USD)$/);
  return m ? `${m[1]}-${m[2]}-SWAP` : u;
}

function okxSpotId(contract: string): string {
  const u = contract.toUpperCase();
  if (u.includes('-')) return u.replace('-SWAP', '');
  const m = u.match(/^(.*?)(USDT|USDC|USD)$/);
  return m ? `${m[1]}-${m[2]}` : u;
}

async function fetchPrice(exchange: string, symbol: string): Promise<number | null> {
  try {
    if (exchange === 'binance') {
      const r = await axios.get('https://fapi.binance.com/fapi/v1/ticker/price', { params: { symbol }, timeout: 10000 });
      return parseFloat(r.data?.price);
    }
    if (exchange === 'bybit') {
      const r = await axios.get('https://api.bybit.com/v5/market/tickers', { params: { category: 'linear', symbol }, timeout: 10000 });
      return parseFloat(r.data?.result?.list?.[0]?.lastPrice) || null;
    }
    if (exchange === 'okx') {
      const r = await axios.get('https://www.okx.com/api/v5/market/ticker', { params: { instId: okxSpotId(symbol) }, timeout: 10000 });
      return parseFloat(r.data?.data?.[0]?.last) || null;
    }
    if (exchange === 'gate') {
      const r = await axios.get(`https://api.gateio.ws/api/v4/futures/usdt/contracts/${symbol.toUpperCase()}`, { timeout: 10000 });
      return parseFloat(r.data?.mark_price) || null;
    }
    if (exchange === 'mexc') {
      const r = await axios.get('https://api.mexc.com/api/v3/contract/ticker/price', { params: { symbol }, timeout: 10000 });
      return parseFloat(r.data?.price) || null;
    }
    return null;
  } catch (err) {
    logger.warn({ err: (err as Error).message, exchange, symbol }, 'Live price fetch failed');
    return null;
  }
}

/**
 * Batch live prices for a set of symbols on one exchange. Used by the Funding
 * list, which only ever passes the symbols the user can currently see.
 */
export async function getLivePriceBatch(exchange: string, symbols: string[]): Promise<Record<string, number>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))].slice(0, 50);
  const entries = await Promise.all(
    unique.map(async (s) => {
      const price = await cachedRequest(`price:${exchange}:${s}`, () => fetchPrice(exchange, s), PRICE_CACHE_TTL_MS);
      return [s, price] as const;
    })
  );
  const map: Record<string, number> = {};
  for (const [s, p] of entries) {
    if (p != null && !isNaN(p)) map[s] = p;
  }
  return map;
}
