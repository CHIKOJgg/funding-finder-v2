import { ExchangeResult, KNOWN_INTERVALS } from '../types/index.js';
import { mapWithConcurrency, retry, getOrCreateClient, cachedRequest } from '../utils/exchangeClient.js';
import { normalizeFundingRate } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { upsertOpenInterest, upsertLongShortRatio } from '../services/marketDataService.js';
import { logger } from '../utils/logger.js';

const CRYPTOCOM_BASE = 'https://api.crypto.com';
const CONCURRENCY = 3;
const CRYPTOCOM_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR;

export async function scanCryptoCom(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting Crypto.com funding rate scan...');

    const client = getOrCreateClient(CRYPTOCOM_BASE, 30000);

    const instruments = await cachedRequest(
      'cryptocom:instruments',
      async () => {
        const res = await retry(() =>
          client.get('/api/v1/public/get-instruments', {
            params: { instrument_kind: 'PERPETUAL', settlement_asset: 'USDT' },
            timeout: 15000,
          }),
          2,
          500
        );
        return res.data?.result || [];
      },
      300_000
    );

    if (!instruments.length) {
      logger.warn('Crypto.com: No USDT perpetual instruments found');
      return [];
    }

    const usdtInstruments = instruments.slice(0, 200);

    const tickers = await cachedRequest(
      'cryptocom:tickers',
      async () => {
        const instIds = usdtInstruments.map((i: any) => i.inst_id).join(',');
        const res = await retry(() =>
          client.get('/api/v1/public/get-tickers', {
            params: { inst_id: instIds },
            timeout: 15000,
          }),
          2,
          500
        );
        return res.data?.result || [];
      },
      60_000
    );

    const tickerMap = new Map<string, any>();
    for (const t of tickers) {
      tickerMap.set(t.inst_id, t);
    }

    const results = await mapWithConcurrency(
      usdtInstruments,
      { concurrency: CONCURRENCY },
      async (instr: any) => {
        try {
          const symbol = instr.inst_id;
          const ticker = tickerMap.get(symbol);
          if (!ticker) return null;

          const currentFunding = parseFloat(ticker.funding_rate ?? ticker.fundingRate ?? 0);
          if (!Number.isFinite(currentFunding)) return null;

          const mark = parseFloat(ticker.mark_price ?? ticker.markPrice ?? 0);
          const vol24 = parseFloat(ticker.vol_24h ?? ticker.vol24h ?? 0);
          const oiUsd = parseFloat(ticker.open_interest ?? ticker.openInterest ?? 0);

          if (oiUsd > 0) {
            upsertOpenInterest('cryptocom', symbol, oiUsd).catch(() => {});
          }

          upsertContractMetadata({
            exchange: 'cryptocom',
            contract: symbol,
            settleCurrency: 'USDT',
            baseCurrency: instr.base_ccy,
            quoteCurrency: instr.quote_ccy,
          }).catch(() => {});

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
          logger.debug(`Crypto.com: Error processing ${instr.inst_id} — ${(err as Error).message}`);
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