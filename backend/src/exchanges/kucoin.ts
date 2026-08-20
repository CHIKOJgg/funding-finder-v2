import { ExchangeResult, KNOWN_INTERVALS } from '../types/index.js';
import { retry, getOrCreateClient, cachedRequest, safeParseFloat, toMs } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { upsertOpenInterest, upsertLongShortRatio } from '../services/marketDataService.js';
import { logger } from '../utils/logger.js';

const KUCOIN_BASE = 'https://api-futures.kucoin.com';
const KUCOIN_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR;

export async function scanKuCoin(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting KuCoin funding rate scan...');

    const client = getOrCreateClient(KUCOIN_BASE, 30000);

    const symbols = await cachedRequest(
      'kucoin:symbols',
      async () => {
        const res = await retry(() =>
          client.get('/api/v1/contracts/active', { timeout: 15000 }),
          2,
          500
        );
        const all = res.data?.data || [];
        return all.filter(
          (s: any) => s.status === 'Open' && (s.settleCurrency === 'USDT' || s.quoteCurrency === 'USDT' || s.quoteCurrency === 'USDC') && s.isInverse === false
        );
      },
      60_000
    );

    if (!symbols.length) {
      logger.warn('KuCoin: No USDT linear contracts found');
      return [];
    }

    logger.info(`KuCoin: Processing ${symbols.length} active contracts`);

    const results = symbols.map((ticker: any) => {
      const symbol = ticker.symbol;
      try {
        const fundingRateStr = ticker.fundingFeeRate
          ?? ticker.fundingRate
          ?? ticker.predictedFundingFeeRate
          ?? ticker.funding_rate
          ?? '';
        if (fundingRateStr === '') return null;

        const currentFunding = parseFloat(String(fundingRateStr));
        if (!Number.isFinite(currentFunding)) return null;

        const mark = safeParseFloat(ticker.markPrice ?? ticker.mark_price ?? ticker.lastTradePrice ?? 0);
        const vol24 = safeParseFloat(ticker.turnoverOf24h ?? ticker.turnover24h ?? ticker.volCcy24h ?? 0);
        const oiUsd = safeParseFloat(ticker.openInterest ?? ticker.open_interest ?? 0) * (mark > 0 ? mark : 1);
        const nextFunding = toMs(ticker.nextFundingRateDateTime) || 0;
        const granularityMs = safeParseFloat(ticker.fundingRateGranularity ?? ticker.currentFundingRateGranularity, 28800000);
        const intervalSeconds = granularityMs > 0 ? granularityMs / 1000 : KUCOIN_INTERVAL;

        if (oiUsd > 0) {
          upsertOpenInterest('kucoin', symbol, oiUsd).catch(() => {});
        }

        const lsrBase = ticker.longShortRatio ?? ticker.long_short_ratio;
        if (lsrBase) {
          const lsr = parseFloat(lsrBase);
          if (Number.isFinite(lsr) && lsr > 0) {
            upsertLongShortRatio('kucoin', symbol, lsr).catch(() => {});
          }
        }

        upsertContractMetadata({
          exchange: 'kucoin',
          contract: symbol,
          settleCurrency: ticker.settleCurrency || 'USDT',
          baseCurrency: ticker.baseCurrency ?? ticker.base_currency,
          quoteCurrency: ticker.quoteCurrency ?? ticker.quote_currency,
          maxLeverage: ticker.maxLeverage ?? ticker.max_leverage,
        }).catch(() => {});

        return toExchangeResult({
          exchange: 'kucoin',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: intervalSeconds,
          fundingIntervalSource: ticker.fundingRateGranularity ? 'api' : 'default',
          fundingNextApply: nextFunding,
          markPrice: mark,
          volume24hSettle: vol24,
          openInterestUsd: oiUsd > 0 ? oiUsd : undefined,
        });
      } catch (err) {
        logger.debug(`KuCoin: Error processing ${symbol} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r: any): r is ExchangeResult => r !== null);
    logger.info(`KuCoin scan completed: ${valid.length} results`);
    return valid;
  } catch (err: any) {
    logger.error(`KuCoin scan error: ${err.message}`);
    return [];
  }
}
