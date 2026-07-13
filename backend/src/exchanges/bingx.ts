import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { mapWithConcurrency, retry, getOrCreateClient, cachedRequest, safeParseFloat } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const BINGX_BASE = 'https://open-api.bingx.com';
const CONCURRENCY = 8;
const BINGX_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR; // 8h fixed

export async function scanBingX(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting BingX scan...');

    const client = getOrCreateClient(BINGX_BASE, 30000);

    // All USDT perp tickers in one call (no symbol param).
    const tickers = await cachedRequest(
      'bingx:tickers',
      async () => {
        const res = await retry(() => client.get('/openApi/swap/v2/quote/ticker'));
        return res.data?.data || [];
      },
      60_000
    );

    logger.info(`BingX: Found ${tickers.length} tickers`);

    const candidates = (tickers as any[])
      .filter((t) => t && t.symbol && t.symbol.endsWith('USDT'))
      .sort((a, b) => Number(b.quoteVolume || 0) - Number(a.quoteVolume || 0))
      .slice(0, 250);

    logger.info(`BingX: Processing ${candidates.length} contracts`);

    const results = await mapWithConcurrency(candidates, { concurrency: CONCURRENCY }, async (t: any) => {
      const symbol = t.symbol; // e.g. BTC-USDT
      try {
        const vol24 = safeParseFloat(t.quoteVolume);
        const mark = safeParseFloat(t.lastPrice);

        // Funding history array — latest first.
        const frRes = await retry(() =>
          client.get('/openApi/swap/v2/quote/fundingRate', {
            params: { symbol },
            timeout: 15000,
          })
        );
        const history = frRes.data?.data || [];
        const latest = Array.isArray(history) ? history[0] : null;
        const currentFunding = safeParseFloat(latest?.fundingRate);
        const lastFundingTime = Number(latest?.fundingTime) || 0;
        const markFromFr = safeParseFloat(latest?.markPrice) || mark;
        const nextFunding = lastFundingTime > 0 ? lastFundingTime + BINGX_INTERVAL : 0;

        upsertContractMetadata({ exchange: 'bingx', contract: symbol }).catch(() => {});

        return toExchangeResult({
          exchange: 'bingx',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: BINGX_INTERVAL,
          fundingIntervalSource: 'default',
          fundingNextApply: nextFunding,
          markPrice: markFromFr,
          volume24hSettle: vol24,
        });
      } catch (err) {
        logger.debug(`BingX: Error ${symbol} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`BingX scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err) {
    logger.error(`Error scanning BingX: ${(err as Error).message}`);
    return [];
  }
}
