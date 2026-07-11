import axios from 'axios';
import { cachedRequest } from '../../utils/exchangeClient.js';

// Public (unauthenticated) market-data lookups for the real funding interval
// of each perpetual contract. Attaching the true interval (not the assumed 8h)
// makes the live "time until next funding" countdown accurate per position.
//
// These calls never use the user's API key and failures are tolerated: when an
// interval can't be resolved the field is simply left undefined and the UI
// falls back to the 8h default. Values are normalized to hours and sanity-
// checked to a plausible 0.5h..24h range before being trusted.

const BINANCE = 'https://fapi.binance.com';
const BYBIT = 'https://api.bybit.com';
const OKX = 'https://www.okx.com';
const GATE = 'https://api.gateio.ws';
const MEXC = 'https://contract.mexc.com';

function plausible(hours: number): number | undefined {
  return hours > 0 && hours <= 24 ? hours : undefined;
}

// Binance exposes the interval for every symbol in a single public call.
export async function getBinanceFundingIntervals(): Promise<Record<string, number>> {
  return cachedRequest('funding:binance:all', async () => {
    const map: Record<string, number> = {};
    try {
      const res = await axios.get(`${BINANCE}/fapi/v1/fundingInfo`, { timeout: 10000 });
      for (const it of res.data || []) {
        if (!it?.symbol) continue;
        const h = plausible(Number(it.fundingIntervalHours));
        if (h) map[it.symbol] = h;
      }
    } catch {
      /* tolerate: UI falls back to 8h */
    }
    return map;
  }, 5 * 60_000);
}

// Bybit reports fundingInterval in minutes; resolve per symbol.
export async function getBybitFundingInterval(symbol: string): Promise<number | undefined> {
  return cachedRequest(`funding:bybit:${symbol}`, async () => {
    try {
      const res = await axios.get(
        `${BYBIT}/v5/market/instruments-info?category=linear&symbol=${encodeURIComponent(symbol)}`,
        { timeout: 10000 }
      );
      const item = res.data?.result?.list?.[0];
      if (item?.fundingInterval) return plausible(Number(item.fundingInterval) / 60);
    } catch {
      /* tolerate */
    }
    return undefined;
  }, 5 * 60_000);
}

// OKX reports fundingInterval in hours via the public instruments endpoint.
export async function getOkxFundingInterval(symbol: string): Promise<number | undefined> {
  const instId = `${symbol.replace(/USDT$/i, '')}-USDT-SWAP`;
  return cachedRequest(`funding:okx:${instId}`, async () => {
    try {
      const res = await axios.get(
        `${OKX}/api/v5/public/instruments?instType=SWAP&instId=${encodeURIComponent(instId)}`,
        { timeout: 10000 }
      );
      const item = res.data?.data?.[0];
      if (item?.fundingInterval) return plausible(Number(item.fundingInterval));
    } catch {
      /* tolerate */
    }
    return undefined;
  }, 5 * 60_000);
}

// Gate reports funding_interval in seconds for each contract.
export async function getGateFundingInterval(symbol: string): Promise<number | undefined> {
  const contract = `${symbol.replace(/USDT$/i, '')}_USDT`;
  return cachedRequest(`funding:gate:${contract}`, async () => {
    try {
      const res = await axios.get(`${GATE}/api/v4/futures/usdt/contracts/${contract}`, { timeout: 10000 });
      const item = res.data;
      if (item?.funding_interval) return plausible(Number(item.funding_interval) / 3600);
    } catch {
      /* tolerate */
    }
    return undefined;
  }, 5 * 60_000);
}

// MEXC exposes fundingInterval on the contract detail endpoint. The unit is
// ambiguous across versions (seconds vs hours); be tolerant and normalize.
export async function getMexcFundingInterval(symbol: string): Promise<number | undefined> {
  return cachedRequest(`funding:mexc:${symbol}`, async () => {
    try {
      const res = await axios.get(
        `${MEXC}/api/v1/contract/detail?symbol=${encodeURIComponent(symbol)}`,
        { timeout: 10000 }
      );
      const item = res.data?.data;
      const raw = Number(item?.fundingInterval);
      if (!raw) return undefined;
      const hours = raw > 100 ? raw / 3600 : raw; // seconds if large, else hours
      return plausible(hours);
    } catch {
      /* tolerate */
    }
    return undefined;
  }, 5 * 60_000);
}
