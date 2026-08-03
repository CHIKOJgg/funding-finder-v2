import { ExchangeResult, KNOWN_INTERVALS } from '../types/index.js';
import { mapWithConcurrency, retry, getOrCreateClient, cachedRequest } from '../utils/exchangeClient.js';
import { normalizeFundingRate } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { upsertOpenInterest, upsertLongShortRatio } from '../services/marketDataService.js';
import { logger } from '../utils/logger.js';

const DERIBIT_BASE = 'https://www.deribit.com';
const CONCURRENCY = 3;
const DERIBIT_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR;

export async function scanDeribit(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting Deribit funding rate scan...');

    const client = getOrCreateClient(DERIBIT_BASE, 30000);

    const instruments = await cachedRequest(
      'deribit:instruments',
      async () => {
        const res = await retry(() =>
          client.get('/api/v2/public/get_instruments', {
             params: { currency: 'BTC', kind: 'future' },
            timeout: 15000,
          }),
          2,
          500
        );
        const btcResult = res.data?.result || [];

        const ethRes = await retry(() =>
          client.get('/api/v2/public/get_instruments', {
             params: { currency: 'ETH', kind: 'future' },
            timeout: 15000,
          }),
          2,
          500
        );
        const ethResult = ethRes.data?.result || [];

        return [...btcResult, ...ethResult].filter(
          (i: any) => i.trading === true && i.is_active === true && /PERPETUAL$/.test(i.instrument_name || '')
        );
      },
      300_000
    );

    if (!instruments.length) {
      logger.warn('Deribit: No instruments found');
      return [];
    }

    const results = await mapWithConcurrency(
      instruments,
      { concurrency: CONCURRENCY },
      async (instr: any) => {
        try {
          const symbol = instr.instrument_name;

          const fundingRes = await retry(() =>
            client.get('/api/v2/public/get_funding_rate', {
            params: {
              instrument_name: symbol,
              start_timestamp: Date.now() - 60 * 60 * 1000,
              end_timestamp: Date.now(),
            },
              timeout: 10000,
            }),
            2,
            300
          );
          const fundingData = fundingRes.data?.result;
          if (!fundingData) return null;

          const currentFunding = parseFloat(fundingData.current_funding_rate ?? 0);
          if (!Number.isFinite(currentFunding)) return null;

          const estimatedSettlePrice = parseFloat(fundingData.estimated_settle_price ?? 0);
          const markPrice = estimatedSettlePrice || parseFloat(instr.mark_price ?? 0);

          const oiUsd = parseFloat(instr.open_interest ?? 0);
          if (oiUsd > 0) {
            upsertOpenInterest('deribit', symbol, oiUsd).catch(() => {});
          }

          upsertContractMetadata({
            exchange: 'deribit',
            contract: symbol,
            settleCurrency: 'BTC',
            baseCurrency: 'BTC',
            quoteCurrency: 'USD',
          }).catch(() => {});

          const normalized = normalizeFundingRate(currentFunding, DERIBIT_INTERVAL);

          return {
            exchange: 'deribit',
            contract: symbol,
            currentFunding,
            funding_interval_seconds: DERIBIT_INTERVAL,
            funding_interval_hours: DERIBIT_INTERVAL / 3600,
            funding_interval_source: 'default' as const,
            funding_rate_per_hour: normalized.perHour,
            funding_rate_per_day: normalized.perDay,
            annualized_rate: normalized.annualized,
            funding_next_apply: 0,
            time_until_next_funding_seconds: 0,
            mark_price: markPrice,
            volume_24h_settle: oiUsd,
            openInterest: oiUsd,
            openInterestUsd: oiUsd,
            med_seconds: DERIBIT_INTERVAL,
            med_hours: DERIBIT_INTERVAL / 3600,
          };
        } catch (err) {
          logger.debug(`Deribit: Error processing ${instr.instrument_name} — ${(err as Error).message}`);
          return null;
        }
      }
    );

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`Deribit scan completed: ${valid.length} results`);
    return valid;
  } catch (err: any) {
    logger.error(`Deribit scan error: ${err.message}`);
    return [];
  }
}
