import { ExchangeResult, KNOWN_INTERVALS } from '../types/index.js';
import { mapWithConcurrency, retry, getOrCreateClient, cachedRequest } from '../utils/exchangeClient.js';
import { normalizeFundingRate } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';

const MEXC_BASE = 'https://contract.mexc.com';
const MAX_CONCURRENCY = 6;
const MEXC_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR; // MEXC is always 8h

export async function scanMEXC(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting MEXC scan (optimized with normalization)...');

    const client = getOrCreateClient(MEXC_BASE, 20000);

    // Use cached contracts
    const contracts = await cachedRequest(
      'mexc:contracts',
      async () => {
        const r = await retry(() => client.get('/api/v1/contract/detail'));
        return r.data.data || [];
      },
      120_000  // Cache for 2 minutes
    );

    logger.info(`MEXC: Found ${contracts.length} total contracts`);

    const usdtContracts = contracts.filter(
      (c: any) =>
        c.symbol &&
        c.symbol.includes('USDT') &&
        !c.symbol.includes('1_USDT') &&
        !c.symbol.includes('1000')
    );

    logger.info(`MEXC: Processing ${usdtContracts.length} USDT contracts`);

    const processed = await mapWithConcurrency(
      usdtContracts,
      { concurrency: MAX_CONCURRENCY },
      async (contract: any) => {
        const symbol = contract.symbol;

        try {
          const [fundingR, tickerR] = await Promise.allSettled([
            retry(() =>
              client.get(`/api/v1/contract/funding_rate/${symbol}`, {
                timeout: 10000,
              })
            ),
            retry(() =>
              client.get('/api/v1/contract/ticker', {
                params: { symbol },
                timeout: 10000,
              })
            ),
          ]);

          const fundingInfo =
            fundingR.status === 'fulfilled' ? fundingR.value.data.data : null;
          const ticker =
            tickerR.status === 'fulfilled' ? tickerR.value.data.data : null;

          if (!ticker) return null;

          const currentFunding =
            fundingInfo && fundingInfo.fundingRate !== undefined
              ? parseFloat(fundingInfo.fundingRate)
              : 0;

          const mark =
            parseFloat(ticker.fairPrice) || parseFloat(ticker.lastPrice) || 0;
          const vol24 = parseFloat(ticker.volume24) || 0;
          const nextFunding = fundingInfo?.nextSettleTime
            ? Number(fundingInfo.nextSettleTime)
            : 0;

          if (!isFinite(currentFunding)) return null;

          // MEXC is always 8h
          const normalized = normalizeFundingRate(currentFunding, MEXC_INTERVAL);

          // Calculate time until next funding
          const now = Date.now();
          const timeUntilNext = nextFunding > now ? Math.floor((nextFunding - now) / 1000) : null;

          return {
            exchange: 'mexc',
            contract: symbol,
            currentFunding,
            funding_interval_seconds: MEXC_INTERVAL,
            funding_interval_hours: MEXC_INTERVAL / 3600,
            funding_interval_source: 'default' as const,
            funding_rate_per_hour: normalized.perHour,
            funding_rate_per_day: normalized.perDay,
            annualized_rate: normalized.annualized,
            funding_next_apply: nextFunding,
            time_until_next_funding_seconds: timeUntilNext,
            mark_price: mark,
            volume_24h_settle: vol24,
            // Legacy fields
            med_seconds: MEXC_INTERVAL,
            med_hours: MEXC_INTERVAL / 3600,
          };
        } catch (err) {
          logger.debug(`MEXC: Error ${symbol} — ${(err as Error).message}`);
          return null;
        }
      }
    );

    const valid = processed.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`MEXC scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err: any) {
    logger.error(`Error scanning MEXC: ${err.message}`);
    return [];
  }
}
