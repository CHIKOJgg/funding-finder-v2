import { ExchangeResult, KNOWN_INTERVALS } from '../types/index.js';
import { mapWithConcurrency, retry, getOrCreateClient, cachedRequest, safeParseFloat } from '../utils/exchangeClient.js';
import { normalizeFundingRate } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { upsertOpenInterest } from '../services/marketDataService.js';
import { logger } from '../utils/logger.js';

const CRYPTOCOM_BASE = 'https://api.crypto.com';
const CONCURRENCY = 8;
const CRYPTOCOM_INTERVAL = KNOWN_INTERVALS.FOUR_HOUR; // 4h standard

export async function scanCryptoCom(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting Crypto.com funding rate scan...');
    const client = getOrCreateClient(CRYPTOCOM_BASE, 30000);

    const [instrumentsRes, tickersRes] = await Promise.all([
      cachedRequest(
        'cryptocom:instruments',
        async () => {
          const res = await retry(() => client.get('/exchange/v1/public/get-instruments'), 2, 500);
          const rows = res.data?.result?.data || res.data?.result?.instruments || [];
          return rows.filter((i: any) => i.inst_type === 'PERPETUAL_SWAP' || String(i.symbol || '').includes('_PERP') || String(i.symbol || '').endsWith('-PERP'));
        },
        5 * 60 * 1000
      ),
      cachedRequest(
        'cryptocom:tickers',
        async () => {
          const res = await retry(() => client.get('/exchange/v1/public/get-tickers'), 2, 500);
          return res.data?.result?.data || [];
        },
        60_000
      ),
    ]);

    if (!instrumentsRes.length) {
      logger.warn('Crypto.com: No perpetual instruments found');
      return [];
    }

    const tickerMap = new Map<string, any>();
    for (const t of tickersRes) {
      tickerMap.set(t.i, t);
    }

    const candidates = instrumentsRes
      .sort((a: any, b: any) => Number(tickerMap.get(b.symbol)?.vv || tickerMap.get(b.symbol)?.v || 0) - Number(tickerMap.get(a.symbol)?.vv || tickerMap.get(a.symbol)?.v || 0))
      .slice(0, 100);

    const results = await mapWithConcurrency(
      candidates,
      { concurrency: CONCURRENCY, delayMs: 15 },
      async (instr: any) => {
        const symbol = instr.symbol;
        try {
          const ticker = tickerMap.get(symbol);
          if (!ticker) return null;

          const mark = safeParseFloat(ticker.k ?? ticker.a ?? ticker.c);
          const vol24 = safeParseFloat(ticker.vv ?? ticker.v);
          const oiUsd = safeParseFloat(ticker.oi) * (mark > 0 ? mark : 1);

          if (oiUsd > 0) {
            upsertOpenInterest('cryptocom', symbol, oiUsd).catch(() => {});
          }

          upsertContractMetadata({
            exchange: 'cryptocom',
            contract: symbol,
            settleCurrency: instr.quote_ccy || 'USD',
            baseCurrency: instr.base_ccy,
            quoteCurrency: instr.quote_ccy,
          }).catch(() => {});

          // Fetch latest funding valuation rate
          let currentFunding = 0;
          try {
            const valRes = await cachedRequest(
              `cryptocom:val:${symbol}`,
              async () => {
                const res = await retry(() =>
                  client.get('/exchange/v1/public/get-valuations', {
                    params: { instrument_name: symbol, valuation_type: 'funding_rate' },
                    timeout: 8000,
                  }),
                  2,
                  300
                );
                return res.data?.result?.data?.[0] || null;
              },
              120_000
            );
            if (valRes) {
              currentFunding = safeParseFloat(valRes.v);
            }
          } catch {
            currentFunding = 0;
          }

          const normalized = normalizeFundingRate(currentFunding, CRYPTOCOM_INTERVAL);

          return {
            exchange: 'cryptocom',
            contract: symbol,
            currentFunding,
            funding_interval_seconds: CRYPTOCOM_INTERVAL,
            funding_interval_hours: CRYPTOCOM_INTERVAL / 3600,
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
            med_seconds: CRYPTOCOM_INTERVAL,
            med_hours: CRYPTOCOM_INTERVAL / 3600,
          };
        } catch (err) {
          logger.debug(`Crypto.com: Error processing ${symbol} — ${(err as Error).message}`);
          return null;
        }
      }
    );

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`Crypto.com scan completed: ${valid.length} results`);
    return valid;
  } catch (err: any) {
    logger.error(`Crypto.com scan error: ${err.message}`);
    return [];
  }
}
