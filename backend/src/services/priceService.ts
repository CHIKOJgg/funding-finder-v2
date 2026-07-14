import axios from 'axios';
import { logger } from '../utils/logger.js';
import { cachedRequest } from '../utils/exchangeClient.js';

// Live last-price for perpetual contracts, keyed by (exchange, symbol) and
// cached briefly. The UI only ever fetches prices for the symbols the user is
// actually looking at (the visible rows), and reuses this cache across
// requests — so we never hammer the exchanges for the whole market at once.
//
// Symbols arrive in human-readable form (e.g. "BTC/USDT" from the arbitrage
// service, or the native per-exchange contract like "BTC-USDT" from the scan
// list). `toNative()` converts them to each exchange's own perp symbol so the
// public ticker endpoint is hit with the right format.
const PRICE_CACHE_TTL_MS = 10_000;

// Returns a finite, positive number or null.
function num(v: any): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return isFinite(n) && n > 0 ? n : null;
}

// Convert a human/arbitrary pair into the exchange's native perp symbol.
export function toNative(exchange: string, pair: string): string {
  const clean = (pair || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const m = clean.match(/^(.*?)(USDT|USD)$/);
  const base = m ? m[1] : clean || 'BTC';
  const quoteRaw = m ? m[2] : 'USDT';
  const usdt = quoteRaw === 'USD' ? 'USD' : 'USDT';
  switch (exchange.toLowerCase()) {
    case 'okx':
      return `${base}-${usdt}-SWAP`;
    case 'bingx':
    case 'blofin':
    case 'htx':
      return `${base}-${usdt}`;
    case 'bluefin':
    case 'drift':
      return `${base}-PERP`;
    case 'paradex':
      return `${base}-USD-PERP`;
    case 'helix':
      return `${base}${usdt}-perp`.toLowerCase();
    case 'woo':
      return `PERP_${base}_${usdt}`;
    case 'dydx':
      return `${base}-USD`;
    case 'hyperliquid':
      return base; // coin symbol, e.g. BTC
    case 'gate':
      return `${base}_${usdt}`; // Gate uses BTC_USDT
    default:
      return `${base}${usdt}`; // binance, bybit, mexc, bitget, bitmart, apex, aster, coinw, coinex, phemex, weex
  }
}

async function getList(url: string, key: string): Promise<any[]> {
  return cachedRequest(
    `priceList:${key}`,
    async () => {
      const res = await axios.get(url, { timeout: 10000 });
      const d = res.data;
      if (Array.isArray(d)) return d;
      if (Array.isArray(d?.data)) return d.data;
      if (Array.isArray(d?.data?.data)) return d.data.data;
      if (Array.isArray(d?.result)) return d.result;
      if (Array.isArray(d?.rows)) return d.rows;
      if (Array.isArray(d?.markets)) return d.markets;
      return [];
    },
    PRICE_CACHE_TTL_MS
  );
}

async function fetchPrice(exchange: string, symbol: string): Promise<number | null> {
  try {
    switch (exchange.toLowerCase()) {
      case 'binance': {
        const r = await axios.get('https://fapi.binance.com/fapi/v1/ticker/price', { params: { symbol }, timeout: 10000 });
        return num(r.data?.price);
      }
      case 'bybit': {
        const r = await axios.get('https://api.bybit.com/v5/market/tickers', { params: { category: 'linear', symbol }, timeout: 10000 });
        return num(r.data?.result?.list?.[0]?.lastPrice);
      }
      case 'okx': {
        const r = await axios.get('https://www.okx.com/api/v5/market/ticker', { params: { instId: symbol }, timeout: 10000 });
        return num(r.data?.data?.[0]?.last) || num(r.data?.data?.[0]?.markPx);
      }
      case 'gate': {
        const r = await axios.get(`https://fx-api.gateio.ws/api/v4/futures/usdt/contracts/${symbol.toUpperCase()}`, { timeout: 10000 });
        return num(r.data?.mark_price) || num(r.data?.last);
      }
      case 'mexc': {
        const r = await axios.get('https://contract.mexc.com/api/v1/contract/ticker', { params: { symbol }, timeout: 10000 });
        const d = r.data?.data;
        return num(d?.lastPrice) || num(d?.fairPrice);
      }
      case 'bitget': {
        const list = await getList('https://api.bitget.com/api/v2/mix/market/tickers?productType=usdt-futures', 'bitget');
        return num(list.find((x: any) => x.symbol === symbol)?.markPrice);
      }
      case 'bingx': {
        const list = await getList('https://open-api.bingx.com/openApi/swap/v2/quote/ticker', 'bingx');
        return num(list.find((x: any) => x.symbol === symbol)?.lastPrice);
      }
      case 'bitmart': {
        const list = await getList('https://api.bitmart.com/v2/contract/public/tickers', 'bitmart');
        return num(list.find((x: any) => x.symbol === symbol)?.last_price);
      }
      case 'blofin': {
        const r = await axios.get('https://openapi.blofin.com/api/v1/market/tickers', { params: { instId: symbol }, timeout: 10000 });
        const d = r.data?.data?.[0];
        return num(d?.last) || num(d?.lastPrice) || num(d?.markPrice);
      }
      case 'bluefin': {
        const list = await getList('https://api.sui-prod.bluefin.io/v1/exchange/tickers', 'bluefin');
        const t = list.find((x: any) => x.symbol === symbol);
        return num(t?.markPriceE9 ? Number(t.markPriceE9) / 1e9 : t?.markPrice);
      }
      case 'drift': {
        const raw: any = await getList('https://data.api.drift.trade/markets', 'drift');
        const arr: any[] = Array.isArray(raw) ? raw : raw?.markets || raw?.data?.markets || [];
        const mk = arr.find((x: any) => x.symbol === symbol);
        return num(mk?.markPrice) || num(mk?.oraclePrice);
      }
      case 'dydx': {
        const r = await axios.get('https://indexer.dydx.trade/v4/perpetualMarkets', { timeout: 10000 });
        const m = r.data?.markets?.[symbol];
        return num(m?.oraclePrice) || num(m?.markPrice);
      }
      case 'helix': {
        const r = await axios.get('https://k8s.mainnet.exchange.gm.injective.network/api/exchange/v1/perpetual-markets', { timeout: 10000 });
        const list = r.data?.data || r.data || [];
        const m = (list as any[]).find((x: any) => x.marketId === symbol);
        return num(m?.markPrice) || num(m?.oraclePrice);
      }
      case 'htx': {
        const r = await axios.get('https://api.hbdm.com/linear-swap-api/v1/swap_ticker', { timeout: 10000 });
        const list = r.data?.data || [];
        return num(list.find((x: any) => x.contract_code === symbol)?.last_price);
      }
      case 'hyperliquid': {
        const r = await axios.post(
          'https://api.hyperliquid.xyz/info',
          { type: 'metaAndAssetCtxs' },
          { timeout: 10000, headers: { 'Content-Type': 'application/json' } }
        );
        const universe: any[] = r.data?.[0]?.universe || [];
        const ctxs: any[] = r.data?.[1] || [];
        const i = universe.findIndex((u: any) => u.name === symbol);
        if (i < 0) return null;
        return num(ctxs[i]?.markPx);
      }
      case 'paradex': {
        const r = await axios.get('https://api.paradex.io/v1/markets', { timeout: 10000 });
        const list = r.data || [];
        return num((list as any[]).find((x: any) => x.symbol === symbol)?.mark_price);
      }
      case 'phemex': {
        const r = await axios.get('https://api.phemex.com/md/v3/ticker/24hr/all', { timeout: 10000 });
        const list = r.data?.result || [];
        return num(list.find((x: any) => x.symbol === symbol)?.markRp);
      }
      case 'weex': {
        const r = await axios.get('https://api.weex.com/api/v1/futures/public/ticker', { params: { symbol }, timeout: 10000 });
        const d = r.data?.data;
        return num(d?.last_price) || num(d?.mark_price);
      }
      case 'woo': {
        const r = await axios.get('https://api.woox.io/v1/public/futures', { timeout: 10000 });
        const f = (r.data?.rows || []).find((x: any) => x.symbol === symbol);
        return num(f?.mark_price);
      }
      case 'apex': {
        const r = await axios.get('https://omni.apex.exchange/api/v3/ticker', { params: { symbol }, timeout: 10000 });
        const d = Array.isArray(r.data?.data) ? r.data.data[0] : r.data?.data;
        return num(d?.markPrice) || num(d?.lastPrice);
      }
      case 'aster': {
        const r = await axios.get('https://fapi.asterdex.com/fapi/v1/ticker/24hr', { params: { symbol }, timeout: 10000 });
        const arr = Array.isArray(r.data) ? r.data : r.data?.data || [];
        const t = (arr as any[]).find((x: any) => x.symbol === symbol);
        return num(t?.lastPrice) || num(t?.markPrice);
      }
      case 'coinw': {
        const r = await axios.get('https://api.coinw.com/api/v2/futures/public/ticker', { params: { symbol }, timeout: 10000 });
        const d = r.data?.data;
        return num(d?.last_price) || num(d?.mark_price);
      }
      case 'coinex': {
        const r = await axios.get('https://api.coinex.com/v2/futures/ticker', { timeout: 10000 });
        const t = (r.data?.data || []).find((x: any) => x.market === symbol);
        return num(t?.last) || num(t?.mark_price);
      }
      default:
        return null;
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message, exchange, symbol }, 'Live price fetch failed');
    return null;
  }
}

/**
 * Batch live prices for a set of symbols on one exchange. Used by the Funding
 * list and the Arbitrage cards, which only ever pass the symbols the user can
 * currently see. Symbols may arrive as "BTC/USDT" (arbitrage) or as the native
 * per-exchange contract (Funding list); both are normalized via `toNative`.
 *
 * For exchanges with bulk ticker endpoints (Binance, Bybit, OKX, etc.), we
 * fetch all tickers once and look up individual symbols from the map, avoiding
 * N separate HTTP requests.
 */
export async function getLivePriceBatch(exchange: string, symbols: string[]): Promise<Record<string, number>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))].slice(0, 50);
  const lower = exchange.toLowerCase();

  // Use bulk ticker endpoints for exchanges that support them
  if (lower === 'binance' || lower === 'bybit' || lower === 'okx' || lower === 'bitget' || lower === 'mexc') {
    try {
      const bulkMap = await fetchBulkTickers(lower);
      if (bulkMap) {
        const map: Record<string, number> = {};
        for (const s of unique) {
          const native = toNative(lower, s);
          const price = bulkMap.get(native);
          if (price != null) map[s] = price;
        }
        return map;
      }
    } catch {
      // Fall through to individual fetching
    }
  }

  const entries = await Promise.all(
    unique.map(async (s) => {
      const native = toNative(lower, s);
      const price = await cachedRequest(`price:${lower}:${native}`, () => fetchPrice(lower, native), PRICE_CACHE_TTL_MS);
      return [s, price] as const;
    })
  );
  const map: Record<string, number> = {};
  for (const [s, p] of entries) {
    if (p != null) map[s] = p;
  }
  return map;
}

async function fetchBulkTickers(exchange: string): Promise<Map<string, number> | null> {
  const cacheKey = `bulkTickers:${exchange}`;
  const cached = (await import('../utils/exchangeClient.js')).cache.get<Map<string, number>>(cacheKey);
  if (cached) return cached;

  let data: any[] | null = null;
  try {
    switch (exchange) {
      case 'binance': {
        const r = await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr', { timeout: 15000 });
        data = r.data;
        break;
      }
      case 'bybit': {
        const r = await axios.get('https://api.bybit.com/v5/market/tickers', { params: { category: 'linear' }, timeout: 15000 });
        data = r.data?.result?.list;
        break;
      }
      case 'okx': {
        const r = await axios.get('https://www.okx.com/api/v5/market/tickers', { params: { instType: 'SWAP' }, timeout: 15000 });
        data = r.data?.data;
        break;
      }
      case 'bitget': {
        const r = await axios.get('https://api.bitget.com/api/v2/mix/market/tickers', { params: { productType: 'usdt-futures' }, timeout: 15000 });
        data = r.data?.data;
        break;
      }
      case 'mexc': {
        const r = await axios.get('https://contract.mexc.com/api/v1/contract/ticker', { timeout: 15000 });
        data = r.data?.data;
        break;
      }
    }
  } catch {
    return null;
  }

  if (!data || !Array.isArray(data)) return null;

  const map = new Map<string, number>();
  for (const t of data) {
    let symbol: string | undefined;
    let price: number | null = null;

    switch (exchange) {
      case 'binance':
        symbol = t.symbol;
        price = parseFloat(t.lastPrice);
        break;
      case 'bybit':
        symbol = t.symbol;
        price = parseFloat(t.lastPrice);
        break;
      case 'okx':
        symbol = t.instId;
        price = parseFloat(t.last) || parseFloat(t.markPx);
        break;
      case 'bitget':
        symbol = t.symbol;
        price = parseFloat(t.markPrice) || parseFloat(t.lastPr);
        break;
      case 'mexc':
        symbol = t.symbol;
        price = parseFloat(t.lastPrice) || parseFloat(t.fairPrice);
        break;
    }

    if (symbol && price != null && isFinite(price) && price > 0) {
      map.set(symbol, price);
    }
  }

  // Cache for 10 seconds — matches the live funding-rate cadence so prices and
  // funding stay in sync on the 10s UI poll instead of prices lagging 15s.
  const { cache } = await import('../utils/exchangeClient.js');
  cache.set(cacheKey, map, 10_000);
  return map;
}
