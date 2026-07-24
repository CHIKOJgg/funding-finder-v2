import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { mapWithConcurrency, retry, getOrCreateClient, cachedRequest, safeParseFloat } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const DYDX_BASE = 'https://indexer.dydx.trade';
const CONCURRENCY = 3;
const DYDX_INTERVAL = KNOWN_INTERVALS.HOURLY; // 1h fixed

function deriveNextHourly(): number {
  const now = Date.now();
  const hourMs = 3600 * 1000;
  return Math.ceil(now / hourMs) * hourMs;
}

export async function scanDydx(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting dYdX v4 scan...');

    const client = getOrCreateClient(DYDX_BASE, 30000);

    const data = await cachedRequest(
      'dydx:perpetualMarkets',
      async () => {
        const res = await retry(() => client.get('/v4/perpetualMarkets'));
        return res.data?.markets || {};
      },
      60_000
    );

    const entries = Object.entries(data as Record<string, any>).filter(
      ([, m]) => m && m.status === 'ACTIVE'
    );

    logger.info(`dYdX: Found ${entries.length} active markets`);

    const candidates = entries
      .sort((a, b) => Number(b[1].volume24H || 0) - Number(a[1].volume24H || 0))
      .slice(0, 250);

    const results = await mapWithConcurrency(candidates, { concurrency: CONCURRENCY }, async ([symbol, m]: [string, any]) => {
      try {
        const currentFunding = safeParseFloat(m.nextFundingRate);
        const mark = safeParseFloat(m.oraclePrice); // dYdX indexer exposes oraclePrice (no separate mark)
        const vol24 = safeParseFloat(m.volume24H);

        if (!isFinite(currentFunding)) return null;

        upsertContractMetadata({ exchange: 'dydx', contract: symbol }).catch(() => {});

        return toExchangeResult({
          exchange: 'dydx',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: DYDX_INTERVAL,
          fundingIntervalSource: 'default',
          fundingNextApply: deriveNextHourly(),
          markPrice: mark,
          volume24hSettle: vol24,
        });
      } catch (err) {
        logger.debug(`dYdX: Error ${symbol} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`dYdX scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err) {
    logger.error(`Error scanning dYdX: ${(err as Error).message}`);
    return [];
  }
}
