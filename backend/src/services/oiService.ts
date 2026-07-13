import axios from 'axios';
import { logger } from '../utils/logger.js';
import { cachedRequest } from '../utils/exchangeClient.js';

// Cache raw exchange responses briefly so live polling (the OI Tracker page
// refreshes every ~30s) reuses the same exchange data instead of re-hitting
// Binance/Bybit/OKX on every tick. This is the main guard against exchange-side
// "Too many requests" (429/418) storms.
const OI_CACHE_TTL_MS = 15_000;

// Open-interest tracking for perpetual swaps. We fetch the current open
// interest (in base contracts) from the major derivatives exchanges and keep a
// short in-memory time-series so the OI Tracker page can render a live spark
// line without a database. The ring buffer is per (exchange, pair) and capped.

const MAX_SAMPLES = 60;

interface OISample {
  t: number;
  oi: number;
  notional: number;
}

const seriesStore = new Map<string, OISample[]>();

function store(key: string, sample: OISample): OISample[] {
  const arr = seriesStore.get(key) || [];
  arr.push(sample);
  if (arr.length > MAX_SAMPLES) arr.shift();
  seriesStore.set(key, arr);
  return arr;
}

function okxInstId(pair: string): string {
  // BTCUSDT -> BTC-USDT
  const upper = pair.toUpperCase();
  if (upper.includes('-')) return upper;
  const m = upper.match(/^(.*?)(USDT|USDC|USD|BTC|ETH)$/);
  if (m) return `${m[1]}-${m[2]}`;
  return upper;
}

async function fetchRaw(exchange: string, pair: string): Promise<{ symbol: string; openInterest: number; markPrice: number; notionalUsd: number }> {
  if (exchange === 'binance') return binanceOI(pair);
  if (exchange === 'bybit') return bybitOI(pair);
  return okxOI(pair);
}

async function binanceOI(pair: string): Promise<{ symbol: string; openInterest: number; markPrice: number; notionalUsd: number }> {
  const symbol = pair.toUpperCase();
  const base = 'https://fapi.binance.com';
  const [oiRes, pxRes] = await Promise.all([
    axios.get(`${base}/fapi/v1/openInterest`, { params: { symbol }, timeout: 10000 }),
    axios.get(`${base}/fapi/v1/premiumIndex`, { params: { symbol }, timeout: 10000 }),
  ]);
  const oi = parseFloat(oiRes.data?.openInterest);
  const mark = parseFloat(pxRes.data?.markPrice);
  return { symbol, openInterest: oi, markPrice: mark, notionalUsd: oi * mark };
}

async function bybitOI(pair: string): Promise<{ symbol: string; openInterest: number; markPrice: number; notionalUsd: number }> {
  const symbol = pair.toUpperCase();
  const oiRes = await axios.get('https://api.bybit.com/v5/market/open-interest', {
    params: { category: 'linear', symbol },
    timeout: 10000,
  });
  const oi = parseFloat(oiRes.data?.result?.openInterest);
  let mark = 0;
  try {
    const tRes = await axios.get('https://api.bybit.com/v5/market/tickers', {
      params: { category: 'linear', symbol },
      timeout: 10000,
    });
    mark = parseFloat(tRes.data?.result?.list?.[0]?.markPrice) || 0;
  } catch {
    /* mark price optional */
  }
  return { symbol, openInterest: oi, markPrice: mark, notionalUsd: oi * mark };
}

async function okxOI(pair: string): Promise<{ symbol: string; openInterest: number; markPrice: number; notionalUsd: number }> {
  const instId = okxInstId(pair);
  const oiRes = await axios.get('https://www.okx.com/api/v5/public/open-interest', {
    params: { instType: 'SWAP', instId },
    timeout: 10000,
  });
  const d = oiRes.data?.data?.[0];
  const oi = parseFloat(d?.oi) || 0;
  const notional = parseFloat(d?.oiCcy) || 0; // notional in quote currency (USDT)
  let mark = 0;
  if (!notional) {
    try {
      const tRes = await axios.get('https://www.okx.com/api/v5/public/mark-price', {
        params: { instType: 'SWAP', instId },
        timeout: 10000,
      });
      mark = parseFloat(tRes.data?.data?.[0]?.markPx) || 0;
    } catch {
      /* mark price optional */
    }
  }
  return { symbol: instId, openInterest: oi, markPrice: mark, notionalUsd: notional || oi * mark };
}

export interface OIResult {
  exchange: string;
  pair: string;
  symbol: string;
  supported: boolean;
  openInterest: number | null;
  markPrice: number | null;
  notionalUsd: number | null;
  timestamp: number;
  series: OISample[];
}

const SUPPORTED = new Set(['binance', 'bybit', 'okx']);

export async function getOpenInterest(exchange: string, pair: string): Promise<OIResult> {
  const key = `${exchange}:${pair}`;
  const timestamp = Date.now();

  if (!SUPPORTED.has(exchange)) {
    return {
      exchange,
      pair,
      symbol: pair,
      supported: false,
      openInterest: null,
      markPrice: null,
      notionalUsd: null,
      timestamp,
      series: seriesStore.get(key) || [],
    };
  }

  try {
    const r = await cachedRequest(
      `oi:${exchange}:${pair}`,
      () => fetchRaw(exchange, pair),
      OI_CACHE_TTL_MS
    );

    const series = store(key, { t: timestamp, oi: r.openInterest, notional: r.notionalUsd });

    return {
      exchange,
      pair,
      symbol: r.symbol,
      supported: true,
      openInterest: r.openInterest,
      markPrice: r.markPrice,
      notionalUsd: r.notionalUsd,
      timestamp,
      series,
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message, exchange, pair }, 'Open interest fetch failed');
    return {
      exchange,
      pair,
      symbol: pair,
      supported: true,
      openInterest: null,
      markPrice: null,
      notionalUsd: null,
      timestamp,
      series: seriesStore.get(key) || [],
    };
  }
}

export const OI_SUPPORTED_EXCHANGES = Array.from(SUPPORTED);
