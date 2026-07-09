import { ExchangeResult } from '../types/index.js';
import { sleep, getOrCreateClient, cachedRequest } from '../utils/exchangeClient.js';
import { safeParseFloat, safeParseInt } from '../utils/exchangeClient.js';
import { normalizeFundingRate } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const BYBIT_BASE = 'https://api.bybit.com';

export async function scanBybit(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting Bybit v5 funding rates scan with normalization...');

    const client = getOrCreateClient(BYBIT_BASE, 30000);
    const categories = ['linear', 'inverse'];
    const allResults: ExchangeResult[] = [];

    for (const category of categories) {
      // Use cached tickers
      const tickers = await cachedRequest(
        `bybit:tickers:${category}`,
        async () => {
          const resp = await client.get('/v5/market/tickers', {
            params: { category },
          });
          if (resp.data.retCode !== 0) {
            logger.error(`Bybit ${category} error: ${resp.data.retMsg}`);
            return [];
          }
          return resp.data.result.list || [];
        },
        60_000
      );

      logger.info(`Bybit ${category}: ${tickers.length} tickers`);

      for (const t of tickers) {
        if (t.deliveryTime && t.deliveryTime !== '0') continue;
        if (t.fundingFeeExpiryTime) continue;

        const symbol = t.symbol;
        if (!symbol) continue;

        // Get funding rate
        const fundingRateStr =
          t.predictedFundingRate ?? t.fundingRate ?? t.predicted_funding_rate ?? t.funding_rate ?? '';
        if (!fundingRateStr) continue;

        const rawFunding = safeParseFloat(fundingRateStr);
        if (!Number.isFinite(rawFunding)) continue;

        let currentFunding = rawFunding;

        // Sanity check: skip extreme values
        if (Math.abs(currentFunding) > 1) {
          logger.debug(`Bybit: Extreme anomaly for ${symbol}: raw="${fundingRateStr}", parsed=${currentFunding.toFixed(4)}% — skipping`);
          continue;
        }

        // Get next funding time
        const nextFundingTimeStr = t.nextFundingTime ?? t.next_funding_time ?? '';
        const nextFundingTime = safeParseInt(nextFundingTimeStr);

        // Get funding interval from API (Bybit provides this directly)
        const intervalMinutes = safeParseInt(t.fundingInterval ?? t.funding_interval, 480); // Default 8h
        
        // Calculate interval in seconds
        const intervalSeconds = intervalMinutes * 60;
        const intervalHours = intervalMinutes / 60;

        // Upsert contract metadata
        upsertContractMetadata({
          exchange: 'bybit',
          contract: symbol,
          settleCurrency: category === 'linear' ? 'USDT' : 'USD',
        }).catch(() => {});

        const markPrice = safeParseFloat(t.markPrice ?? t.mark_price ?? 0);
        const turnover24h = safeParseFloat(t.turnover24h ?? t.turnover_24h ?? 0);

        // Filter low volume
        if (turnover24h < 1_000_000) continue;

        // Normalize funding rate to hourly basis
        const normalized = normalizeFundingRate(currentFunding, intervalSeconds);

        // Calculate time until next funding
        const now = Date.now();
        const timeUntilNext = nextFundingTime > now ? Math.floor((nextFundingTime - now) / 1000) : 0;

        allResults.push({
          exchange: 'bybit',
          contract: symbol,
          currentFunding: Number(currentFunding.toFixed(8)),
          funding_interval_seconds: intervalSeconds,
          funding_interval_hours: intervalHours,
          funding_interval_source: 'api',  // Bybit provides this directly
          funding_rate_per_hour: normalized.perHour,
          funding_rate_per_day: normalized.perDay,
          annualized_rate: normalized.annualized,
          funding_next_apply: nextFundingTime,
          time_until_next_funding_seconds: timeUntilNext,
          mark_price: markPrice,
          volume_24h_settle: turnover24h || safeParseFloat(t.volume24h ?? 0) * markPrice,
          // Legacy fields
          med_seconds: intervalSeconds,
          med_hours: intervalHours,
        });
      }

      await sleep(200);
    }

    // Log interval distribution
    const intervalCounts: Record<string, number> = {};
    for (const r of allResults) {
      const label = `${r.funding_interval_hours}h`;
      intervalCounts[label] = (intervalCounts[label] || 0) + 1;
    }
    
    logger.info(`Bybit scan completed: ${allResults.length} valid contracts`);
    logger.info(`Bybit interval distribution:`, intervalCounts);

    return allResults;
  } catch (err: any) {
    logger.error(`Bybit scan error: ${err.response?.data || err.message}`);
    return [];
  }
}
