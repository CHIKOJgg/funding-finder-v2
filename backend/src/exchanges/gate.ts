import { ExchangeResult } from '../types/index.js';
import { mapWithConcurrency, retry, getOrCreateClient, cachedRequest } from '../utils/exchangeClient.js';
import { normalizeFundingRate, detectFundingInterval } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

const GATE_BASE = 'https://fx-api.gateio.ws/api/v4';
const CONCURRENCY = 8;

export async function scanGate(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting Gate.io scan (optimized with normalization)...');

    const client = getOrCreateClient(GATE_BASE, 30000);

    // Use cached tickers (refresh every 60 seconds)
    const tickers = await cachedRequest(
      'gate:tickers',
      async () => {
        const res = await retry(() =>
          client.get(`/futures/${config.exchange.settle}/tickers`)
        );
        return res.data || [];
      },
      60_000
    );

    logger.info(`Gate: Found ${tickers.length} tickers`);

    const candidates = tickers
      .filter((t: any) => t && t.contract)
      .sort((a: any, b: any) => Number(b.volume_24h_settle) - Number(a.volume_24h_settle));

    // Only the most liquid contracts matter for funding arbitrage; scanning
    // hundreds of illiquid pairs just adds latency. Cap to the top by volume.
    const CANDIDATE_CAP = 250;
    const capped = candidates.slice(0, CANDIDATE_CAP);

    logger.info(`Gate: Processing ${capped.length} of ${candidates.length} contracts`);

    const results = await mapWithConcurrency(capped, { concurrency: CONCURRENCY }, async (t: any) => {
      const contract = t.contract;

      try {
        const vol24 = parseFloat(t.volume_24h_settle || t.volume_24h || 0) || 0;
        const mark = parseFloat(t.mark_price || t.last || 0) || 0;

        // Get funding rate from ticker (fast path)
        let fundingRate = parseFloat(t.funding_rate) || 0;
        let nextFunding = (Number(t.funding_next_apply) || 0) * 1000;

        // If values are missing, try contract info
        if (!fundingRate || !nextFunding) {
          try {
            const info = await retry(() =>
              client.get(`/futures/${config.exchange.settle}/contracts/${contract}`, {
                timeout: 10000,
              })
            );
            const d = info.data || {};
            fundingRate = parseFloat(fundingRate || d.funding_rate || 0);
            nextFunding = nextFunding || ((Number(d.funding_next_apply) || 0) * 1000);
          } catch (err) {
            logger.debug(`Gate: Info fallback failed for ${contract}: ${(err as Error).message}`);
          }
        }

        // Detect funding interval. This requires an extra per-contract history
        // request, which is expensive across ~800 contracts. The interval is
        // stable, so cache the detected value per contract for 6 hours to keep
        // subsequent scans fast (avoids N+1 latency / frontend timeouts).
        const interval = await cachedRequest(
          `gate:interval:${contract}`,
          async () => {
            let fundingTimestamps: number[] = [];
            const apiIntervalMinutes: number | undefined = undefined;

            try {
              const histRes = await retry(() =>
                client.get(`/futures/${config.exchange.settle}/funding_rate`, {
                  params: { contract, limit: 30 }, // Get more history for better detection
                  timeout: 12000,
                })
              );
              const hist = histRes.data || [];
              if (hist.length > 1) {
                fundingTimestamps = hist.map((x: any) => Number(x.t) * 1000); // Convert to ms
              }
            } catch (err) {
              logger.debug(`Gate: Funding history fallback failed for ${contract}: ${(err as Error).message}`);
            }

            return detectFundingInterval('gate', fundingTimestamps, apiIntervalMinutes);
          },
          6 * 60 * 60 * 1000 // 6 hours
        );

        // Upsert contract metadata
        upsertContractMetadata({
          exchange: 'gate',
          contract,
          settleCurrency: config.exchange.settle,
        }).catch(() => {});

        // Normalize funding rate to hourly basis
        const normalized = normalizeFundingRate(fundingRate, interval.seconds);

        // Calculate time until next funding
        const now = Date.now();
        const timeUntilNext = nextFunding > now ? Math.floor((nextFunding - now) / 1000) : null;

        return {
          exchange: 'gate',
          contract,
          currentFunding: fundingRate,
          funding_interval_seconds: interval.seconds,
          funding_interval_hours: interval.hours,
          funding_interval_source: interval.source,
          funding_rate_per_hour: normalized.perHour,
          funding_rate_per_day: normalized.perDay,
          annualized_rate: normalized.annualized,
          funding_next_apply: nextFunding,
          time_until_next_funding_seconds: timeUntilNext,
          mark_price: mark,
          volume_24h_settle: vol24,
          // Legacy fields
          med_seconds: interval.seconds,
          med_hours: interval.hours,
        };
      } catch (err) {
        logger.debug(`Gate: Error for ${contract} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];

    // Log interval distribution
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
