import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { retry, getOrCreateClient, cachedRequest, safeParseFloat } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const PARADEX_BASE = 'https://api.prod.paradex.trade';

export async function scanParadex(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting Paradex scan...');

    const client = getOrCreateClient(PARADEX_BASE, 30000);

    const markets = await cachedRequest(
      'paradex:markets',
      async () => {
        const res = await retry(() => client.get('/v1/markets'));
        const raw = res.data?.results || res.data?.data || res.data || [];
        return Array.isArray(raw) ? raw : [];
      },
      60_000
    );

    logger.info(`Paradex: Found ${markets.length} markets`);

    const candidates = (markets as any[])
      .filter((m) => m && m.symbol && (m.asset_kind === 'PERP' || m.symbol.endsWith('-PERP') || m.symbol.endsWith('-USD-PERP')));

    logger.info(`Paradex: Processing ${candidates.length} perp markets`);

    const results = candidates.map((m: any) => {
      const symbol = m.symbol; // e.g. BTC-USD-PERP
      try {
        const currentFunding = safeParseFloat(m.funding_rate ?? m.fundingRate);
        const mark = safeParseFloat(m.mark_price ?? m.last_price ?? m.oracle_price);
        const vol24 = safeParseFloat(m.volume_24h ?? m.volume);
        const intervalHours = safeParseFloat(m.funding_period_hours, 1);
        const intervalSeconds = intervalHours > 0 ? intervalHours * 3600 : KNOWN_INTERVALS.HOURLY;
        const nextFunding = m.next_funding_time ? new Date(m.next_funding_time).getTime() : 0;

        if (!isFinite(currentFunding)) return null;

        upsertContractMetadata({
          exchange: 'paradex',
          contract: symbol,
          baseCurrency: m.base_currency,
          quoteCurrency: m.quote_currency,
          settleCurrency: m.settlement_currency,
        }).catch(() => {});

        return toExchangeResult({
          exchange: 'paradex',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: intervalSeconds,
          fundingIntervalSource: m.funding_period_hours ? 'api' : 'default',
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
