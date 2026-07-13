import { ExchangeResult } from '../types/index.js';
import { mapWithConcurrency, retry, getOrCreateClient, cachedRequest, safeParseFloat } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const PHEMEX_BASE = 'https://api.phemex.com';
const CONCURRENCY = 8;

export async function scanPhemex(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting Phemex scan...');

    const client = getOrCreateClient(PHEMEX_BASE, 30000);

    // 24h ticker (volume + mark price)
    const tickers = await cachedRequest(
      'phemex:tickers',
      async () => {
        const res = await retry(() => client.get('/md/v3/ticker/24hr/all'));
        return res.data?.result || [];
      },
      60_000
    );

    logger.info(`Phemex: Found ${tickers.length} tickers`);

    const tickerMap = new Map<string, any>();
    for (const t of tickers as any[]) tickerMap.set(t.symbol, t);

    const candidates = (tickers as any[])
      .filter((t) => t && t.symbol && t.symbol.endsWith('USDT'))
      .sort((a, b) => Number(b.turnoverRv || 0) - Number(a.turnoverRv || 0))
      .slice(0, 250);

    logger.info(`Phemex: Processing ${candidates.length} contracts`);

    const results = await mapWithConcurrency(candidates, { concurrency: CONCURRENCY }, async (t: any) => {
      const symbol = t.symbol;
      try {
        const vol24 = safeParseFloat(t.turnoverRv);
        const mark = safeParseFloat(t.markRp);

        const frRes = await retry(() =>
          client.get('/contract-biz/public/real-funding-rates', {
            params: { symbol },
            timeout: 15000,
          })
        );
        const row = frRes.data?.data?.rows?.[0];
        if (!row) return null;

        const currentFunding = safeParseFloat(row.fundingRate);
        const nextFunding = Number(row.nextfundingTime) || 0;
        const intervalSeconds = Number(row.fundingInterval) || 28800;

        upsertContractMetadata({
          exchange: 'phemex',
          contract: symbol,
          fundingCap: safeParseFloat(row.fundingRateCap),
          fundingFloor: safeParseFloat(row.fundingRateFloor),
        }).catch(() => {});

        return toExchangeResult({
          exchange: 'phemex',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: intervalSeconds,
          fundingIntervalSource: row.fundingInterval ? 'api' : 'default',
          fundingNextApply: nextFunding,
          markPrice: mark,
          volume24hSettle: vol24,
        });
      } catch (err) {
        logger.debug(`Phemex: Error ${symbol} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`Phemex scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err) {
    logger.error(`Error scanning Phemex: ${(err as Error).message}`);
    return [];
  }
}
