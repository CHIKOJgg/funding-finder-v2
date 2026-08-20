import { ExchangeResult } from '../types/index.js';
import { retry, getOrCreateClient, cachedRequest, safeParseFloat } from '../utils/exchangeClient.js';
import { normalizeFundingRate, detectFundingInterval } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

const GATE_BASE = 'https://fx-api.gateio.ws/api/v4';

export async function scanGate(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting Gate.io scan (optimized with normalization)...');

    const client = getOrCreateClient(GATE_BASE, 30000);

    const [contracts, tickers] = await Promise.all([
      cachedRequest(
        'gate:contracts',
        async () => {
          const res = await retry(() =>
            client.get(`/futures/${config.exchange.settle}/contracts`)
          );
          return res.data || [];
        },
        5 * 60 * 1000
      ),
      cachedRequest(
        'gate:tickers',
        async () => {
          const res = await retry(() =>
            client.get(`/futures/${config.exchange.settle}/tickers`)
          );
          return res.data || [];
        },
        60_000
      ),
    ]);

    logger.info(`Gate: Found ${contracts.length} contracts, ${tickers.length} tickers`);

    const contractMap = new Map<string, any>();
    for (const c of contracts) {
      if (c && c.name) contractMap.set(c.name, c);
    }

    const tickerMap = new Map<string, any>();
    for (const t of tickers) {
      if (t && t.contract) tickerMap.set(t.contract, t);
    }

    const candidateNames = Array.from(new Set([...contractMap.keys(), ...tickerMap.keys()]));

    const results = candidateNames.map((rawContract) => {
      const c = contractMap.get(rawContract) || {};
      const t = tickerMap.get(rawContract) || {};
      const contract = rawContract.replace('_', '');

      try {
        const vol24 = safeParseFloat(t.volume_24h_settle ?? t.volume_24h ?? c.volume_24h_settle ?? 0);
        const mark = safeParseFloat(t.mark_price ?? t.last ?? c.mark_price ?? c.last_price ?? 0);
        const fundingRate = safeParseFloat(t.funding_rate ?? c.funding_rate ?? 0);
        const nextFunding = (Number(t.funding_next_apply || c.funding_next_apply || 0)) * 1000;

        const intervalSeconds = safeParseFloat(c.funding_interval, 28800);
        const intervalHours = intervalSeconds / 3600;

        // Upsert contract metadata
        upsertContractMetadata({
          exchange: 'gate',
          contract,
          settleCurrency: config.exchange.settle,
        }).catch(() => {});

        // Normalize funding rate to hourly basis
        const normalized = normalizeFundingRate(fundingRate, intervalSeconds);

        // Calculate time until next funding
        const now = Date.now();
        const timeUntilNext = nextFunding > now ? Math.floor((nextFunding - now) / 1000) : null;

        return {
          exchange: 'gate',
          contract,
          currentFunding: fundingRate,
          funding_interval_seconds: intervalSeconds,
          funding_interval_hours: intervalHours,
          funding_interval_source: c.funding_interval ? 'api' as const : 'default' as const,
          funding_rate_per_hour: normalized.perHour,
          funding_rate_per_day: normalized.perDay,
          annualized_rate: normalized.annualized,
          funding_next_apply: nextFunding,
          time_until_next_funding_seconds: timeUntilNext,
          mark_price: mark,
          volume_24h_settle: vol24,
          med_seconds: intervalSeconds,
          med_hours: intervalHours,
        };
      } catch (err) {
        logger.debug(`Gate: Error for ${contract} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];

    const intervalCounts: Record<string, number> = {};
    for (const r of valid) {
      const label = `${r.funding_interval_hours}h`;
      intervalCounts[label] = (intervalCounts[label] || 0) + 1;
    }
    logger.info(`Gate scan complete: ${valid.length} results`);
    logger.info(`Gate interval distribution:`, intervalCounts);

    return valid;
  } catch (err) {
    logger.error(`Error scanning Gate.io: ${(err as Error).message}`);
    return [];
  }
}
