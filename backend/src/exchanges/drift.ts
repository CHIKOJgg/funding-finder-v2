import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { mapWithConcurrency, retry, getOrCreateClient, cachedRequest, safeParseFloat } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const DRIFT_BASE = 'https://data.api.drift.trade';
const CONCURRENCY = 3;
const DRIFT_INTERVAL = KNOWN_INTERVALS.HOURLY; // per-market, ~1h

export async function scanDrift(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting Drift scan...');
    const client = getOrCreateClient(DRIFT_BASE, 30000);

    const extract = (d: any): any[] => {
      if (Array.isArray(d)) return d;
      if (Array.isArray(d?.markets)) return d.markets;
      if (Array.isArray(d?.data?.markets)) return d.data.markets;
      if (Array.isArray(d?.data)) return d.data;
      return [];
    };

    // Try the all-markets batch endpoint first; fall back to per-market if needed.
    const markets = await cachedRequest(
      'drift:markets',
      async () => {
        const res = await retry(() => client.get('/markets'));
        return extract(res.data);
      },
      60_000
    );

    let candidates: any[];
    if (markets.length) {
      candidates = markets.filter((m) => m && m.symbol && m.symbol.endsWith('PERP')).slice(0, 250);
    } else {
      const info = await cachedRequest('drift:perp-markets', async () => {
        const res = await retry(() => client.get('/perp-markets'));
        return extract(res.data);
      }, 6 * 60 * 60 * 1000);
      candidates = info.filter((m) => m && m.symbol && m.symbol.endsWith('PERP')).slice(0, 250);
    }
    logger.info(`Drift: Processing ${candidates.length} perp markets`);

    const results = await mapWithConcurrency(candidates, { concurrency: CONCURRENCY }, async (m: any) => {
      const symbol = m.symbol; // e.g. SOL-PERP
      try {
        // Batch call already has the data; only fetch per-market when using fallback list.
        let data = m.fundingRate !== undefined ? m : null;
        if (!data) {
          const pm = (await retry(() => client.get(`/perp-market/${symbol}`))).data;
          data = pm && pm.fundingRate !== undefined ? pm : pm?.data;
        }
        if (!data || data.fundingRate === undefined) return null;
        const currentFunding = safeParseFloat(data.fundingRate);
        const mark = safeParseFloat(data.markPrice) || safeParseFloat(data.oraclePrice);
        const vol24 = safeParseFloat(data.volume24h);
        const nextFunding = Number(data.nextFundingTimestamp) || 0;

        upsertContractMetadata({ exchange: 'drift', contract: symbol }).catch(() => {});

        return toExchangeResult({
          exchange: 'drift',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: DRIFT_INTERVAL,
          fundingIntervalSource: 'default',
          fundingNextApply: nextFunding,
          markPrice: mark,
          volume24hSettle: vol24,
        });
      } catch (err) {
        logger.debug(`Drift: Error ${symbol} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`Drift scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err) {
    logger.error(`Error scanning Drift: ${(err as Error).message}`);
    return [];
  }
}
