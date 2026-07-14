import axios from 'axios';
import { logger } from '../utils/logger.js';
import { cachedRequest } from '../utils/exchangeClient.js';
import { normalizeFundingRate } from '../utils/helpers.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { toNative } from './priceService.js';

// Live funding rates for perpetual contracts, keyed by (exchange, symbol) and
// cached briefly. Mirrors the live price service: only the symbols the user is
// actually looking at are ever requested, reused across requests/users via the
// short cache, so we never hammer the exchanges for the whole market.
//
// Funding rates only change at each settlement, but the UI polls this every 10s
// to reflect the freshest available rate without ever blocking on a full scan.
const FUNDING_CACHE_TTL_MS = 10_000;

// Returns a finite number or null.
function num(v: any): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return isFinite(n) ? n : null;
}

// A single symbol's raw funding rate + settlement interval (seconds).
interface RawFunding {
  rawRate: number;
  intervalSeconds: number;
  nextApply?: number;
}

// Batch lists (cached so multiple symbols in one poll reuse a single fetch).
async function getCachedList(key: string, url: string): Promise<any> {
  return cachedRequest(
    key,
    async () => {
      const res = await axios.get(url, { timeout: 10000 });
      return res.data;
    },
    FUNDING_CACHE_TTL_MS
  );
}

async function fetchFunding(exchange: string, symbol: string): Promise<RawFunding | null> {
  try {
    switch (exchange.toLowerCase()) {
      case 'binance': {
        const r = await cachedRequest(`funding:binance:${symbol}`, () =>
          axios.get('https://fapi.binance.com/fapi/v1/premiumIndex', { params: { symbol }, timeout: 10000 }), FUNDING_CACHE_TTL_MS);
        const d = r.data;
        if (!d) return null;
        const rate = num(d.lastFundingRate);
        if (rate == null) return null;
        return { rawRate: rate, intervalSeconds: KNOWN_INTERVALS.EIGHT_HOUR, nextApply: Number(d.nextFundingTime) || 0 };
      }
      case 'bybit': {
        const d = await getCachedList('fundinglist:bybit:linear', 'https://api.bybit.com/v5/market/tickers?category=linear');
        const list: any[] = d?.result?.list || [];
        const t = list.find((x: any) => x.symbol === symbol);
        if (!t) return null;
        const rate = num(t.fundingRate ?? t.predictedFundingRate);
        if (rate == null) return null;
        const intervalMinutes = num(t.fundingInterval) ?? 480;
        return { rawRate: rate, intervalSeconds: intervalMinutes * 60, nextApply: Number(t.nextFundingTime) || 0 };
      }
      case 'okx': {
        const r = await cachedRequest(`funding:okx:${symbol}`, () =>
          axios.get('https://www.okx.com/api/v5/public/funding-rate', { params: { instId: symbol }, timeout: 10000 }), FUNDING_CACHE_TTL_MS);
        const fr = r.data?.data?.[0];
        const rate = num(fr?.fundingRate);
        if (rate == null) return null;
        const next = fr?.fundingTime ? new Date(fr.fundingTime).getTime() : 0;
        return { rawRate: rate, intervalSeconds: KNOWN_INTERVALS.EIGHT_HOUR, nextApply: next };
      }
      case 'gate': {
        const r = await cachedRequest(`funding:gate:${symbol}`, () =>
          axios.get(`https://fx-api.gateio.ws/api/v4/futures/usdt/contracts/${symbol.toUpperCase()}`, { timeout: 10000 }), FUNDING_CACHE_TTL_MS);
        const d = r.data;
        const rate = num(d?.funding_rate);
        if (rate == null) return null;
        return { rawRate: rate, intervalSeconds: KNOWN_INTERVALS.EIGHT_HOUR, nextApply: Number(d?.funding_next_apply) || 0 };
      }
      case 'mexc': {
        const r = await cachedRequest(`funding:mexc:${symbol}`, () =>
          axios.get(`https://contract.mexc.com/api/v1/contract/funding_rate/${symbol}`, { timeout: 10000 }), FUNDING_CACHE_TTL_MS);
        const d = r.data?.data;
        const rate = num(d?.fundingRate);
        if (rate == null) return null;
        return { rawRate: rate, intervalSeconds: KNOWN_INTERVALS.EIGHT_HOUR, nextApply: Number(d?.nextSettleTime) || 0 };
      }
      case 'bitget': {
        const [tk, ct] = await Promise.all([
          getCachedList('fundinglist:bitget:tickers', 'https://api.bitget.com/api/v2/mix/market/tickers?productType=usdt-futures'),
          getCachedList('fundinglist:bitget:contracts', 'https://api.bitget.com/api/v2/mix/market/contracts?productType=usdt-futures'),
        ]);
        const t = (tk?.data || []).find((x: any) => x.symbol === symbol);
        const rate = num(t?.fundingRate);
        if (rate == null) return null;
        const c = (ct?.data || []).find((x: any) => x.symbol === symbol);
        const intervalHours = num(c?.fundInterval) ?? 8;
        return { rawRate: rate, intervalSeconds: intervalHours * 3600 };
      }
      case 'bingx': {
        const r = await cachedRequest(`funding:bingx:${symbol}`, () =>
          axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/fundingRate', { params: { symbol }, timeout: 10000 }), FUNDING_CACHE_TTL_MS);
        const latest = Array.isArray(r.data?.data) ? r.data.data[0] : null;
        const rate = num(latest?.fundingRate);
        if (rate == null) return null;
        const last = Number(latest?.fundingTime) || 0;
        return { rawRate: rate, intervalSeconds: KNOWN_INTERVALS.EIGHT_HOUR, nextApply: last > 0 ? last + KNOWN_INTERVALS.EIGHT_HOUR : 0 };
      }
      case 'phemex': {
        const r = await cachedRequest(`funding:phemex:${symbol}`, () =>
          axios.get('https://api.phemex.com/contract-biz/public/real-funding-rates', { params: { symbol }, timeout: 10000 }), FUNDING_CACHE_TTL_MS);
        const row = r.data?.data?.rows?.[0];
        const rate = num(row?.fundingRate);
        if (rate == null) return null;
        return { rawRate: rate, intervalSeconds: Number(row?.fundingInterval) || KNOWN_INTERVALS.EIGHT_HOUR, nextApply: Number(row?.nextfundingTime) || 0 };
      }
      case 'woo': {
        const d = await getCachedList('fundinglist:woo', 'https://api.woox.io/v1/public/funding_rates');
        const f = (d?.rows || []).find((x: any) => x.symbol === symbol);
        const rate = num(f?.last_funding_rate);
        if (rate == null) return null;
        const intervalHours = num(f?.last_funding_rate_interval) ?? 8;
        return { rawRate: rate, intervalSeconds: intervalHours * 3600, nextApply: Number(f?.next_funding_time) || 0 };
      }
      case 'hyperliquid': {
        const HL_INFO = 'https://api.hyperliquid.xyz/info';
        const postInfo = (type: string) =>
          cachedRequest(`fundinglist:hl:${type}`, () =>
            axios.post(HL_INFO, { type }, { timeout: 10000, headers: { 'Content-Type': 'application/json' } }).then((r) => r.data), FUNDING_CACHE_TTL_MS);
        const [mc, predicted] = await Promise.all([postInfo('metaAndAssetCtxs'), postInfo('predictedFundings')]);
        // metaAndAssetCtxs
        const universe: any[] = mc?.[0]?.universe || [];
        const ctxs: any[] = mc?.[1] || [];
        const i = universe.findIndex((u: any) => u.name === symbol);
        if (i < 0) return null;
        const rate = num(ctxs[i]?.funding);
        if (rate == null) return null;
        const nextFundingMap = new Map<string, number>();
        for (const entry of predicted || []) {
          const first = entry?.[1]?.[0]?.[1];
          if (entry?.[0] && first?.nextFundingTime) nextFundingMap.set(entry[0], Number(first.nextFundingTime));
        }
        return { rawRate: rate, intervalSeconds: KNOWN_INTERVALS.HOURLY, nextApply: nextFundingMap.get(symbol) || 0 };
      }
      case 'dydx': {
        const r = await cachedRequest(`funding:dydx:${symbol}`, () =>
          axios.get('https://indexer.dydx.trade/v4/perpetualMarkets', { timeout: 10000 }), FUNDING_CACHE_TTL_MS);
        const m = r.data?.markets?.[symbol];
        const rate = num(m?.nextFundingRate);
        if (rate == null) return null;
        return { rawRate: rate, intervalSeconds: KNOWN_INTERVALS.HOURLY };
      }
      case 'paradex': {
        const d = await getCachedList('fundinglist:paradex', 'https://api.paradex.io/v1/markets');
        const m = (d || []).find((x: any) => x.symbol === symbol);
        const rate = num(m?.funding_rate);
        if (rate == null) return null;
        return {
          rawRate: rate,
          intervalSeconds: Number(m?.funding_interval) || KNOWN_INTERVALS.HOURLY,
          nextApply: m?.next_funding_time ? new Date(m.next_funding_time).getTime() : 0,
        };
      }
      case 'htx': {
        const r = await cachedRequest(`funding:htx:${symbol}`, () =>
          axios.get('https://api.hbdm.com/linear-swap-api/v1/swap_funding_rate', { params: { contract_code: symbol }, timeout: 10000 }), FUNDING_CACHE_TTL_MS);
        const fd = r.data?.data;
        const rate = num(fd?.funding_rate);
        if (rate == null) return null;
        return { rawRate: rate, intervalSeconds: KNOWN_INTERVALS.EIGHT_HOUR, nextApply: Number(fd?.funding_time) || 0 };
      }
      case 'coinex': {
        const d = await getCachedList('fundinglist:coinex', 'https://api.coinex.com/v2/futures/funding-rate');
        const f = (d?.data || []).find((x: any) => x.market === symbol);
        const rate = num(f?.latest_funding_rate);
        if (rate == null) return null;
        return { rawRate: rate, intervalSeconds: KNOWN_INTERVALS.EIGHT_HOUR, nextApply: Number(f?.next_funding_time) || 0 };
      }
      case 'blofin': {
        const r = await cachedRequest(`funding:blofin:${symbol}`, () =>
          axios.get('https://openapi.blofin.com/api/v1/market/funding-rate', { params: { instId: symbol }, timeout: 10000 }), FUNDING_CACHE_TTL_MS);
        const fd = r.data?.data?.[0];
        const rate = num(fd?.fundingRate);
        if (rate == null) return null;
        return { rawRate: rate, intervalSeconds: KNOWN_INTERVALS.EIGHT_HOUR, nextApply: Number(fd?.fundingTime) || 0 };
      }
      case 'bitmart': {
        const r = await cachedRequest(`funding:bitmart:${symbol}`, () =>
          axios.get('https://api.bitmart.com/v2/contract/public/funding-rate', { params: { symbol }, timeout: 10000 }), FUNDING_CACHE_TTL_MS);
        const fd = r.data?.data;
        const rate = num(fd?.funding_rate);
        if (rate == null) return null;
        return { rawRate: rate, intervalSeconds: KNOWN_INTERVALS.EIGHT_HOUR, nextApply: Number(fd?.funding_time) || 0 };
      }
      case 'weex': {
        const r = await cachedRequest(`funding:weex:${symbol}`, () =>
          axios.get('https://api.weex.com/api/v1/futures/public/funding-rate', { params: { symbol }, timeout: 10000 }), FUNDING_CACHE_TTL_MS);
        const fd = r.data?.data;
        const rate = num(fd?.funding_rate);
        if (rate == null) return null;
        return { rawRate: rate, intervalSeconds: KNOWN_INTERVALS.EIGHT_HOUR, nextApply: Number(fd?.funding_time) || 0 };
      }
      case 'coinw': {
        const r = await cachedRequest(`funding:coinw:${symbol}`, () =>
          axios.get('https://api.coinw.com/api/v2/futures/public/funding-rate', { params: { symbol }, timeout: 10000 }), FUNDING_CACHE_TTL_MS);
        const fd = r.data?.data;
        const rate = num(fd?.funding_rate);
        if (rate == null) return null;
        return { rawRate: rate, intervalSeconds: KNOWN_INTERVALS.EIGHT_HOUR, nextApply: Number(fd?.funding_time) || Number(fd?.next_funding_time) || 0 };
      }
      case 'drift': {
        const r = await cachedRequest(`funding:drift:${symbol}`, () =>
          axios.get(`https://data.api.drift.trade/perp-market/${symbol}`, { timeout: 10000 }), FUNDING_CACHE_TTL_MS);
        const d = r.data?.data ?? r.data;
        const rate = num(d?.fundingRate);
        if (rate == null) return null;
        return { rawRate: rate, intervalSeconds: KNOWN_INTERVALS.HOURLY, nextApply: Number(d?.nextFundingTimestamp) || 0 };
      }
      case 'helix': {
        const d = await getCachedList('fundinglist:helix', 'https://k8s.mainnet.exchange.gm.injective.network/api/exchange/v1/perpetual-markets');
        const m = (d?.data || d || []).find((x: any) => x.marketId === symbol);
        const rate = num(m?.fundingRate);
        if (rate == null) return null;
        return { rawRate: rate, intervalSeconds: KNOWN_INTERVALS.HOURLY, nextApply: Number(m?.nextFundingTimestamp) || 0 };
      }
      case 'apex': {
        const r = await cachedRequest(`funding:apex:${symbol}`, () =>
          axios.get('https://omni.apex.exchange/api/v3/ticker', { params: { symbol }, timeout: 10000 }), FUNDING_CACHE_TTL_MS);
        const t = Array.isArray(r.data?.data) ? r.data.data[0] : r.data?.data;
        const rate = num(t?.fundingRate);
        if (rate == null) return null;
        return { rawRate: rate, intervalSeconds: KNOWN_INTERVALS.HOURLY };
      }
      case 'aster': {
        const r = await cachedRequest(`funding:aster:${symbol}`, () =>
          axios.get('https://fapi.asterdex.com/fapi/v1/premiumIndex', { params: { symbol }, timeout: 10000 }), FUNDING_CACHE_TTL_MS);
        const d = Array.isArray(r.data) ? r.data.find((x: any) => x.symbol === symbol) : r.data?.data;
        const rate = num(d?.lastFundingRate);
        if (rate == null) return null;
        return { rawRate: rate, intervalSeconds: KNOWN_INTERVALS.EIGHT_HOUR, nextApply: Number(d?.nextFundingTime) || 0 };
      }
      case 'bluefin': {
        const d = await getCachedList('fundinglist:bluefin', 'https://api.sui-prod.bluefin.io/v1/exchange/tickers');
        const t = (d?.data || d || []).find((x: any) => x.symbol === symbol);
        const rate = num(t?.lastFundingRateE9);
        if (rate == null) return null;
        return {
          rawRate: rate / 1e9,
          intervalSeconds: KNOWN_INTERVALS.EIGHT_HOUR,
          nextApply: Number(t?.nextFundingTimeAtMillis) || 0,
        };
      }
      default:
        return null;
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message, exchange, symbol }, 'Live funding fetch failed');
    return null;
  }
}

export interface LiveFunding {
  ratePerHour: number;
  intervalHours: number;
  rawRate: number;
  nextApply: number;
}

/**
 * Batch live funding rates for a set of symbols on one exchange. Symbols arrive
 * as "BTC/USDT" (arbitrage) or the native per-exchange contract (Funding list)
 * and are normalized via `toNative`. Returns only symbols that resolved.
 */
export async function getLiveFundingBatch(exchange: string, symbols: string[]): Promise<Record<string, LiveFunding>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))].slice(0, 50);
  const entries = await Promise.all(
    unique.map(async (s) => {
      const native = toNative(exchange, s);
      const fr = await fetchFunding(exchange, native);
      if (!fr) return null;
      const normalized = normalizeFundingRate(fr.rawRate, fr.intervalSeconds);
      const result: LiveFunding = {
        ratePerHour: normalized.perHour,
        intervalHours: fr.intervalSeconds / 3600,
        rawRate: fr.rawRate,
        nextApply: fr.nextApply || 0,
      };
      return [s, result] as const;
    })
  );
  const map: Record<string, LiveFunding> = {};
  for (const e of entries) {
    if (e) map[e[0]] = e[1];
  }
  return map;
}
