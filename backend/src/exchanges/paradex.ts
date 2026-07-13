import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { mapWithConcurrency, retry, getOrCreateClient, cachedRequest, safeParseFloat } from '../utils/exchangeClient.js';
import { normalizeFundingRate, toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const PARADEX_BASE = 'https://api.paradex.io';
const CONCURRENCY = 8;

export async function scanParadex(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting Paradex scan...');

    const client = getOrCreateClient(PARADEX_BASE, 30000);

    const markets = await cachedRequest(
      'paradex:markets',
      async () => {
        const res = await retry(() => client.get('/v1/markets'));
        return res.data || [];
      },
      60_000
    );

    logger.info(`Paradex: Found ${markets.length} markets`);

    const candidates = (markets as any[])
      .filter((m) => m && m.symbol && m.symbol.endsWith('PERP') && m.status === 'ACTIVE')
      .sort((a, b) => Number(b.volume_24h || 0) - Number(a.volume_24h || 0))
      .slice(0, 250);

    logger.info(`Paradex: Processing ${candidates.length} perp markets`);

    const results = await mapWithConcurrency(candidates, { concurrency: CONCURRENCY }, async (m: any) => {
      const symbol = m.symbol; // e.g. ETH-USD-PERP
      try {
        const currentFunding = safeParseFloat(m.funding_rate);
        const mark = safeParseFloat(m.mark_price);
        const vol24 = safeParseFloat(m.volume_24h);
        const intervalSeconds = Number(m.funding_interval) || KNOWN_INTERVALS.HOURLY;
        const nextFunding = m.next_funding_time ? new Date(m.next_funding_time).getTime() : 0;

        if (!isFinite(currentFunding)) return null;

        upsertContractMetadata({ exchange: 'paradex', contract: symbol }).catch(() => {});

        return toExchangeResult({
          exchange: 'paradex',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: intervalSeconds,
          fundingIntervalSource: m.funding_interval ? 'api' : 'default',
          fundingNextApply: nextFunding,
          markPrice: mark,
          volume24hSettle: vol24,
        });
      } catch (err) {
        logger.debug(`Paradex: Error ${symbol} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`Paradex scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err) {
    logger.error(`Error scanning Paradex: ${(err as Error).message}`);
    return [];
  }
}
