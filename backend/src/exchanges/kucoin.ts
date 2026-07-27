import { ExchangeResult, KNOWN_INTERVALS } from '../types/index.js';
import { mapWithConcurrency, retry, getOrCreateClient, cachedRequest } from '../utils/exchangeClient.js';
import { normalizeFundingRate } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { upsertOpenInterest, upsertLongShortRatio } from '../services/marketDataService.js';
import { logger } from '../utils/logger.js';

const KUCOIN_BASE = 'https://api.kucoin.com';
const CONCURRENCY = 3;
const KUCOIN_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR;

export async function scanKuCoin(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting KuCoin funding rate scan...');

    const client = getOrCreateClient(KUCOIN_BASE, 30000);

    const symbols = await cachedRequest(
      'kucoin:symbols',
      async () => {
        const res = await retry(() =>
          client.get('/api/v1/contracts', { timeout: 15000 }),
          2,
          500
        );
        const all = res.data?.data || [];
        return all.filter(
          (s: any) => s.trading === true && s.settleCurrency === 'USDT' && s.type === 'linear'
        );
      },
      300_000
    );

    if (!symbols.length) {
      logger.warn('KuCoin: No USDT linear contracts found');
      return [];
    }

    const tickerSymbols = symbols.slice(0, 200).map((s: any) => s.symbol);

    const tickers = await cachedRequest(
      'kucoin:tickers',
      async () => {
        const res = await retry(() =>
          client.get('/api/v1/contract/status', {
            params: { symbol: tickerSymbols.join(',') },
            timeout: 15000,
          }),
          2,
          500
        );
        return res.data?.data || [];
      },
      60_000
    );

    const tickerMap = new Map<string, any>();
    for (const t of tickers) {
      tickerMap.set(t.symbol, t);
    }

    const results = await mapWithConcurrency(
      tickerSymbols,
      { concurrency: CONCURRENCY },
      async (symbol: string) => {
        try {
          const ticker = tickerMap.get(symbol);
          if (!ticker) return null;

          const fundingRateStr = ticker.fundingRate ?? ticker.funding_rate ?? '';
          if (!fundingRateStr) return null;

          const currentFunding = parseFloat(fundingRateStr);
          if (!Number.isFinite(currentFunding)) return null;

          const mark = parseFloat(ticker.markPrice ?? ticker.mark_price ?? 0);
          const vol24 = parseFloat(ticker.turnoverOf24h ?? ticker.turnover24h ?? ticker.volCcy24h ?? 0);

          const oiUsd = parseFloat(ticker.openInterest ?? ticker.open_interest ?? 0) || 0;
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
            settleCurrency: 'USDT',
            baseCurrency: ticker.baseCurrency ?? ticker.base_currency,
            quoteCurrency: ticker.quoteCurrency ?? ticker.quote_currency,
            maxLeverage: ticker.maxLeverage ?? ticker.max_leverage,
          }).catch(() => {});

          const normalized = normalizeFundingRate(currentFunding, KUCOIN_INTERVAL);

          return {
            exchange: 'kucoin',
            contract: symbol,
            currentFunding,
            funding_interval_seconds: KUCOIN_INTERVAL,
            funding_interval_hours: KUCOIN_INTERVAL / 3600,
            funding_interval_source: 'default' as const,
            funding_rate_per_hour: normalized.perHour,
            funding_rate_per_day: normalized.perDay,
            annualized_rate: normalized.annualized,
            funding_next_apply: 0,
            time_until_next_funding_seconds: 0,
            mark_price: mark,
            volume_24h_settle: vol24,
            openInterest: oiUsd,
            openInterestUsd: oiUsd,
            med_seconds: KUCOIN_INTERVAL,
            med_hours: KUCOIN_INTERVAL / 3600,
          };
        } catch (err) {
          logger.debug(`KuCoin: Error processing ${symbol} — ${(err as Error).message}`);
          return null;
        }
      }
    );

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`KuCoin scan completed: ${valid.length} results`);
    return valid;
  } catch (err: any) {
    logger.error(`KuCoin scan error: ${err.message}`);
    return [];
  }
}