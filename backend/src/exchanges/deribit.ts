import { ExchangeResult, KNOWN_INTERVALS } from '../types/index.js';
import { retry, getOrCreateClient, cachedRequest, safeParseFloat } from '../utils/exchangeClient.js';
import { normalizeFundingRate, toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { upsertOpenInterest } from '../services/marketDataService.js';
import { logger } from '../utils/logger.js';

const DERIBIT_BASE = 'https://www.deribit.com';
const DERIBIT_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR;

export async function scanDeribit(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting Deribit funding rate scan...');
    const client = getOrCreateClient(DERIBIT_BASE, 30000);

    const summaries = await cachedRequest(
      'deribit:book_summaries',
      async () => {
        const currencies = ['BTC', 'ETH', 'USDC', 'USDT'];
        const responses = await Promise.allSettled(
          currencies.map((currency) =>
            retry(() =>
              client.get('/api/v2/public/get_book_summary_by_currency', {
                params: { currency, kind: 'future' },
                timeout: 15000,
              }),
              2,
              500
            )
          )
        );

        const items: any[] = [];
        for (const res of responses) {
          if (res.status === 'fulfilled') {
            const list = res.value.data?.result || [];
            if (Array.isArray(list)) items.push(...list);
          }
        }
        return items.filter((i: any) => i && i.instrument_name && /PERPETUAL$/.test(i.instrument_name));
      },
      60_000
    );

    if (!summaries.length) {
      logger.warn('Deribit: No instruments found');
      return [];
    }

    const results = summaries.map((instr: any) => {
      try {
        const symbol = instr.instrument_name;
        const currentFunding = safeParseFloat(instr.funding_8h ?? instr.current_funding ?? 0);
        const markPrice = safeParseFloat(instr.mark_price ?? instr.estimated_delivery_price ?? instr.last ?? 0);
        const oiUsd = safeParseFloat(instr.open_interest ?? 0);
        const vol24 = safeParseFloat(instr.volume_usd ?? instr.volume_notional ?? instr.volume ?? 0);

        if (oiUsd > 0) {
          upsertOpenInterest('deribit', symbol, oiUsd).catch(() => {});
        }

        upsertContractMetadata({
          exchange: 'deribit',
          contract: symbol,
          settleCurrency: instr.quote_currency || 'USDC',
          baseCurrency: instr.base_currency,
          quoteCurrency: instr.quote_currency,
        }).catch(() => {});

        return toExchangeResult({
          exchange: 'deribit',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: DERIBIT_INTERVAL,
          fundingIntervalSource: 'default',
          fundingNextApply: 0,
          markPrice: markPrice,
          volume24hSettle: vol24,
          openInterestUsd: oiUsd > 0 ? oiUsd : undefined,
        });
      } catch (err) {
        logger.debug(`Deribit: Error processing ${instr.instrument_name} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`Deribit scan completed: ${valid.length} results`);
    return valid;
  } catch (err: any) {
    logger.error(`Deribit scan error: ${err.message}`);
    return [];
  }
}
