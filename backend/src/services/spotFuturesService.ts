import axios from 'axios';
import { logger } from '../utils/logger.js';
import { cachedRequest } from '../utils/exchangeClient.js';
import { EXCHANGE_FEES } from './arbitrageService.js';

// Cache raw exchange responses briefly so the Spot-Futures panel polling reuses
// data instead of re-hitting exchange APIs every tick.
const CACHE_TTL_MS = 15_000;

// Known funding intervals per exchange (hours). Most USDT perps settle every
// 8h; this is used to annualize the collected funding.
const INTERVAL_HOURS: Record<string, number> = {
  binance: 8,
  bybit: 8,
  okx: 8,
  gate: 8,
  mexc: 8,
};

const SUPPORTED = new Set(['binance', 'bybit', 'okx', 'gate', 'mexc']);

interface RawSF {
  symbol: string;
  spotPrice: number;
  perpMark: number;
  fundingRate: number; // per-interval fraction, e.g. 0.0001
}

async function binanceSF(pair: string): Promise<RawSF> {
  const symbol = pair.toUpperCase();
  const [funding, spot] = await Promise.all([
    axios.get('https://fapi.binance.com/fapi/v1/premiumIndex', { params: { symbol }, timeout: 10000 }),
    axios.get('https://api.binance.com/api/v3/ticker/price', { params: { symbol }, timeout: 10000 }),
  ]);
  return {
    symbol,
    spotPrice: parseFloat(spot.data.price),
    perpMark: parseFloat(funding.data.markPrice),
    fundingRate: parseFloat(funding.data.lastFundingRate),
  };
}

async function bybitSF(pair: string): Promise<RawSF> {
  const symbol = pair.toUpperCase();
  const [perp, spot] = await Promise.all([
    axios.get('https://api.bybit.com/v5/market/tickers', { params: { category: 'linear', symbol }, timeout: 10000 }),
    axios.get('https://api.bybit.com/v5/market/tickers', { params: { category: 'spot', symbol }, timeout: 10000 }),
  ]);
  const p = perp.data?.result?.list?.[0];
  const s = spot.data?.result?.list?.[0];
  return {
    symbol,
    spotPrice: parseFloat(s?.lastPrice) || 0,
    perpMark: parseFloat(p?.markPrice) || 0,
    fundingRate: parseFloat(p?.fundingRate) || 0,
  };
}

async function okxSF(pair: string): Promise<RawSF> {
  const instId = pair.toUpperCase().includes('-')
    ? pair.toUpperCase()
    : (() => {
        const m = pair.toUpperCase().match(/^(.*?)(USDT|USDC|USD)$/);
        return m ? `${m[1]}-${m[2]}` : pair.toUpperCase();
      })();
  const [funding, spot, mark] = await Promise.all([
    axios.get('https://www.okx.com/api/v5/public/funding-rate', { params: { instId }, timeout: 10000 }),
    axios.get('https://www.okx.com/api/v5/market/ticker', { params: { instId }, timeout: 10000 }),
    axios.get('https://www.okx.com/api/v5/public/mark-price', { params: { instType: 'SWAP', instId }, timeout: 10000 }),
  ]);
  const f = funding.data?.data?.[0];
  const s = spot.data?.data?.[0];
  const mp = mark.data?.data?.[0];
  return {
    symbol: instId,
    spotPrice: parseFloat(s?.last) || 0,
    perpMark: parseFloat(mp?.markPx) || parseFloat(s?.last) || 0,
    fundingRate: parseFloat(f?.fundingRate) || 0,
  };
}

async function gateSF(pair: string): Promise<RawSF> {
  const cp = pair.toUpperCase().includes('_') ? pair.toUpperCase() : (() => {
    const m = pair.toUpperCase().match(/^(.*?)(USDT|USDC|USD)$/);
    return m ? `${m[1]}_${m[2]}` : pair.toUpperCase();
  })();
  const [perp, spot] = await Promise.all([
    axios.get(`https://fx-api.gateio.ws/api/v4/futures/usdt/contracts/${cp}`, { timeout: 10000 }),
    axios.get('https://api.gateio.ws/api/v4/spot/tickers', { params: { currency_pair: cp }, timeout: 10000 }),
  ]);
  const s = spot.data?.[0];
  return {
    symbol: cp,
    spotPrice: parseFloat(s?.last) || 0,
    perpMark: parseFloat(perp.data?.mark_price) || 0,
    fundingRate: parseFloat(perp.data?.funding_rate) || 0,
  };
}

async function mexcSF(pair: string): Promise<RawSF> {
  const symbol = pair.toUpperCase();
  const [perp, spot, funding] = await Promise.all([
    axios.get('https://contract.mexc.com/api/v1/contract/ticker', { params: { symbol }, timeout: 10000 }),
    axios.get('https://api.mexc.com/api/v3/ticker/price', { params: { symbol }, timeout: 10000 }),
    axios.get('https://contract.mexc.com/api/v1/contract/funding_rate', { params: { symbol }, timeout: 10000 }),
  ]);
  return {
    symbol,
    spotPrice: parseFloat(spot.data?.price) || 0,
    perpMark: parseFloat(perp.data?.data?.fairPrice) || parseFloat(perp.data?.data?.lastPrice) || 0,
    fundingRate: parseFloat(funding.data?.data?.fundingRate) || 0,
  };
}

async function fetchRaw(exchange: string, pair: string): Promise<RawSF> {
  if (exchange === 'binance') return binanceSF(pair);
  if (exchange === 'bybit') return bybitSF(pair);
  if (exchange === 'okx') return okxSF(pair);
  if (exchange === 'gate') return gateSF(pair);
  return mexcSF(pair);
}

// Short in-memory basis time-series for the sparkline.
const basisStore = new Map<string, { t: number; basis: number }[]>();
const MAX_SAMPLES = 60;

export interface SpotFuturesResult {
  exchange: string;
  pair: string;
  symbol: string;
  supported: boolean;
  spotPrice: number | null;
  perpMark: number | null;
  basisPct: number | null;
  fundingRate: number | null;
  intervalHours: number;
  annualIntervals: number;
  fundingApy: number | null;
  netApy: number | null;
  strategy: string | null;
  timestamp: number;
  series: { t: number; basis: number }[];
}

export async function getSpotFutures(exchange: string, pair: string): Promise<SpotFuturesResult> {
  const key = `${exchange}:${pair}`;
  const timestamp = Date.now();
  const intervalHours = INTERVAL_HOURS[exchange] || 8;
  const annualIntervals = Math.round((365 * 24) / intervalHours);

  if (!SUPPORTED.has(exchange)) {
    return {
      exchange, pair, symbol: pair, supported: false,
      spotPrice: null, perpMark: null, basisPct: null, fundingRate: null,
      intervalHours, annualIntervals, fundingApy: null, netApy: null, strategy: null,
      timestamp, series: basisStore.get(key) || [],
    };
  }

  try {
    const r = await cachedRequest(`sf:${exchange}:${pair}`, () => fetchRaw(exchange, pair), CACHE_TTL_MS);

    const basisPct = r.spotPrice > 0 ? ((r.perpMark - r.spotPrice) / r.spotPrice) * 100 : 0;
    const taker = EXCHANGE_FEES[exchange]?.taker ?? 0.0005;
    // One full round-trip (long spot + short perp) costs ~4 taker fees. If you
    // collect funding and re-enter each interval, that fee repeats per interval.
    const perIntervalFee = 4 * taker;
    const netPerInterval = r.fundingRate - perIntervalFee;
    const fundingApy = r.fundingRate * annualIntervals * 100;
    const netApy = netPerInterval * annualIntervals * 100;

    // Positive funding + positive basis: short perp / long spot collects funding.
    const strategy = `Long spot + Short perp — collect funding (~${fundingApy.toFixed(1)}%/yr)`;

    const arr = basisStore.get(key) || [];
    arr.push({ t: timestamp, basis: basisPct });
    if (arr.length > MAX_SAMPLES) arr.shift();
    basisStore.set(key, arr);

    return {
      exchange, pair, symbol: r.symbol, supported: true,
      spotPrice: r.spotPrice, perpMark: r.perpMark, basisPct,
      fundingRate: r.fundingRate, intervalHours, annualIntervals,
      fundingApy, netApy, strategy,
      timestamp, series: arr,
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message, exchange, pair }, 'Spot-futures fetch failed');
    return {
      exchange, pair, symbol: pair, supported: true,
      spotPrice: null, perpMark: null, basisPct: null, fundingRate: null,
      intervalHours, annualIntervals, fundingApy: null, netApy: null, strategy: null,
      timestamp, series: basisStore.get(key) || [],
    };
  }
}

export const SF_SUPPORTED_EXCHANGES = Array.from(SUPPORTED);
