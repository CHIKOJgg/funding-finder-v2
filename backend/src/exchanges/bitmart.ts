import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { mapWithConcurrency, retry, getOrCreateClient, cachedRequest, safeParseFloat } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const BITMART_BASE = 'https://api.bitmart.com';
const CONCURRENCY = 6;
const BITMART_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR; // typical 8h

export async function scanBitMart(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting BitMart scan...');
    const client = getOrCreateClient(BITMART_BASE, 30000);

    const [symbols, tickers] = await Promise.all([
      cachedRequest('bitmart:symbols', async () => {
        const res = await retry(() => client.get('/v2/contract/public/symbols-list'));
        return res.data?.data || [];
      }, 6 * 60 * 60 * 1000),
      cachedRequest('bitmart:tickers', async () => {
        const res = await retry(() => client.get('/v2/contract/public/tickers'));
        return res.data?.data || [];
      }, 60_000),
    ]);

    const tickerMap = new Map<string, any>();
    for (const t of tickers as any[]) tickerMap.set(t.symbol, t);

    const candidates = (symbols as any[])
      .filter((s) => s && s.symbol && s.symbol.endsWith('USDT'))
      .sort((a, b) => Number(tickerMap.get(b.symbol)?.volume_24h || 0) - Number(tickerMap.get(a.symbol)?.volume_24h || 0))
      .slice(0, 250);
    logger.info(`BitMart: Processing ${candidates.length} perp symbols`);

    const results = await mapWithConcurrency(candidates, { concurrency: CONCURRENCY }, async (s: any) => {
      const symbol = s.symbol; // BTCUSDT
      try {
        const tk = tickerMap.get(symbol);
        const fr = await retry(() =>
          client.get('/v2/contract/public/funding-rate', { params: { symbol }, timeout: 10000 })
        );
        const fd = fr.data?.data;
        if (!fd) return null;

        const currentFunding = safeParseFloat(fd.funding_rate);
        const nextFunding = Number(fd.funding_time) || 0;
        const mark = safeParseFloat(tk?.last_price);
        const vol24 = safeParseFloat(tk?.volume_24h);

        upsertContractMetadata({ exchange: 'bitmart', contract: symbol }).catch(() => {});

        return toExchangeResult({
          exchange: 'bitmart',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: BITMART_INTERVAL,
          fundingIntervalSource: 'default',
          fundingNextApply: nextFunding,
          markPrice: mark,
          volume24hSettle: vol24,
        });
      } catch (err) {
        logger.debug(`BitMart: Error ${symbol} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`BitMart scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err) {
    logger.error(`Error scanning BitMart: ${(err as Error).message}`);
    return [];
  }
}
