import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { retry, getOrCreateClient, cachedRequest, safeParseFloat } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const ASTER_BASE = 'https://fapi.asterdex.com';
const ASTER_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR; // default 8h (per-market, not in payload)

export async function scanAster(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting Aster scan...');
    const client = getOrCreateClient(ASTER_BASE, 30000);

    const [premium, tickers, info] = await Promise.all([
      cachedRequest('aster:premiumIndex', async () => {
        const res = await retry(() => client.get('/fapi/v1/premiumIndex'));
        return res.data || [];
      }, 60_000),
      cachedRequest('aster:tickers24hr', async () => {
        const res = await retry(() => client.get('/fapi/v1/ticker/24hr'));
        return res.data || [];
      }, 60_000),
      cachedRequest('aster:exchangeInfo', async () => {
        const res = await retry(() => client.get('/fapi/v1/exchangeInfo'));
        return res.data?.symbols || [];
      }, 6 * 60 * 60 * 1000),
    ]);

    const premiumMap = new Map<string, any>();
    for (const p of premium as any[]) premiumMap.set(p.symbol, p);
    const tickerMap = new Map<string, any>();
    for (const t of tickers as any[]) tickerMap.set(t.symbol, t);

    const candidates = (info as any[])
      .filter((s) => s && s.symbol && s.contractType === 'PERPETUAL' && s.status === 'TRADING')
      .sort((a, b) => Number(tickerMap.get(b.symbol)?.quoteVolume || 0) - Number(tickerMap.get(a.symbol)?.quoteVolume || 0))
      .slice(0, 250);
    logger.info(`Aster: Processing ${candidates.length} perp symbols`);

    const results = (candidates as any[]).map((s: any) => {
      const symbol = s.symbol; // BTCUSDT
      try {
        const p = premiumMap.get(symbol);
        const t = tickerMap.get(symbol);
        if (!p) return null;

        const currentFunding = safeParseFloat(p.lastFundingRate);
        const nextFunding = Number(p.nextFundingTime) || 0;
        const mark = safeParseFloat(p.markPrice) || safeParseFloat(t?.lastPrice);
        const vol24 = safeParseFloat(t?.quoteVolume);

        upsertContractMetadata({
          exchange: 'aster',
          contract: symbol,
          baseCurrency: s.baseAsset,
          quoteCurrency: s.quoteAsset,
        }).catch(() => {});

        return toExchangeResult({
          exchange: 'aster',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: ASTER_INTERVAL,
          fundingIntervalSource: 'default',
          fundingNextApply: nextFunding,
          markPrice: mark,
          volume24hSettle: vol24,
        });
      } catch (err) {
        logger.debug(`Aster: Error ${symbol} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`Aster scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err) {
    logger.error(`Error scanning Aster: ${(err as Error).message}`);
    return [];
  }
}
