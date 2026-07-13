import { ExchangeResult } from '../types/index.js';
import { mapWithConcurrency, retry, getOrCreateClient, cachedRequest, safeParseFloat } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const WOO_BASE = 'https://api.woox.io';
const CONCURRENCY = 8;

export async function scanWOO(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting WOO X scan...');

    const client = getOrCreateClient(WOO_BASE, 30000);

    // Futures market data (mark price + 24h volume)
    const futures = await cachedRequest(
      'woo:futures',
      async () => {
        const res = await retry(() => client.get('/v1/public/futures'));
        return res.data?.rows || [];
      },
      60_000
    );

    logger.info(`WOO: Found ${futures.length} futures`);

    // Funding rates (last rate + next funding time + interval)
    const funding = await cachedRequest(
      'woo:funding_rates',
      async () => {
        const res = await retry(() => client.get('/v1/public/funding_rates'));
        return res.data?.rows || [];
      },
      30_000
    );

    const fundingMap = new Map<string, any>();
    for (const f of funding as any[]) fundingMap.set(f.symbol, f);

    const candidates = (futures as any[])
      .filter((f) => f && f.symbol && f.symbol.startsWith('PERP_') && f.symbol.endsWith('_USDT'))
      .sort((a, b) => Number(b['24h_volume'] || 0) - Number(a['24h_volume'] || 0))
      .slice(0, 250);

    logger.info(`WOO: Processing ${candidates.length} contracts`);

    const results = await mapWithConcurrency(candidates, { concurrency: CONCURRENCY }, async (f: any) => {
      const symbol = f.symbol; // e.g. PERP_BTC_USDT
      try {
        const vol24 = safeParseFloat(f['24h_volume']);
        const mark = safeParseFloat(f.mark_price);

        const fr = fundingMap.get(symbol);
        if (!fr) return null;

        const currentFunding = safeParseFloat(fr.last_funding_rate);
        const nextFunding = Number(fr.next_funding_time) || 0;
        // Interval unit is hours per WOO docs (verify live); fall back to 8h.
        const intervalHours = safeParseFloat(fr.last_funding_rate_interval, 8);
        const intervalSeconds = intervalHours > 0 ? intervalHours * 3600 : 28800;

        upsertContractMetadata({ exchange: 'woo', contract: symbol }).catch(() => {});

        return toExchangeResult({
          exchange: 'woo',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: intervalSeconds,
          fundingIntervalSource: fr.last_funding_rate_interval ? 'api' : 'default',
          fundingNextApply: nextFunding,
          markPrice: mark,
          volume24hSettle: vol24,
        });
      } catch (err) {
        logger.debug(`WOO: Error ${symbol} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`WOO scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err) {
    logger.error(`Error scanning WOO X: ${(err as Error).message}`);
    return [];
  }
}
