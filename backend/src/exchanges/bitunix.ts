import { ExchangeResult, KNOWN_INTERVALS } from '../types/index.js';
import { cachedRequest, getOrCreateClient, mapWithConcurrency, retry, safeParseFloat } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const BASE = 'https://fapi.bitunix.com';
export async function scanBitunix(): Promise<ExchangeResult[]> {
  try {
    const client = getOrCreateClient(BASE, 30000);
    const [pairs, tickers] = await Promise.all([
      cachedRequest('bitunix:pairs', async () => (await retry(() => client.get('/api/v1/futures/market/trading_pairs'))).data?.data || [], 5 * 60 * 1000),
      cachedRequest('bitunix:tickers', async () => (await retry(() => client.get('/api/v1/futures/market/tickers'))).data?.data || [], 60 * 1000),
    ]);
    const tickerMap = new Map((tickers as any[]).map((t) => [t.symbol, t]));
    const candidates = (pairs as any[]).map((p) => typeof p === 'string' ? p : p?.symbol).filter(Boolean).slice(0, 100);
    const results = await mapWithConcurrency(candidates, { concurrency: 3 }, async (symbol: string) => {
      try {
        const data = (await cachedRequest(`bitunix:funding:${symbol}`, async () => (await retry(() => client.get('/api/v1/futures/market/funding_rate', { params: { symbol } }))).data?.data, 60 * 1000)) as any;
        const rate = safeParseFloat(data?.fundingRate, NaN);
        if (!Number.isFinite(rate)) return null;
        const intervalHours = safeParseFloat(data?.fundingInterval, 8);
        const ticker = tickerMap.get(symbol) || {};
        upsertContractMetadata({ exchange: 'bitunix', contract: symbol }).catch(() => {});
        return toExchangeResult({ exchange: 'bitunix', contract: symbol, currentFunding: rate, fundingIntervalSeconds: intervalHours * 3600 || KNOWN_INTERVALS.EIGHT_HOUR, fundingIntervalSource: data?.fundingInterval ? 'api' : 'default', fundingNextApply: safeParseFloat(data?.nextFundingTime), markPrice: safeParseFloat(ticker.markPrice), volume24hSettle: safeParseFloat(ticker.volume), });
      } catch { return null; }
    });
    return results.filter((r): r is ExchangeResult => r !== null);
  } catch (err) { logger.error(`Error scanning Bitunix: ${(err as Error).message}`); return []; }
}
