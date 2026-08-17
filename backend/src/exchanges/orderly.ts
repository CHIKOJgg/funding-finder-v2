import { ExchangeResult, KNOWN_INTERVALS } from '../types/index.js';
import { cachedRequest, getOrCreateClient, retry, safeParseFloat, toMs } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

export async function scanOrderly(): Promise<ExchangeResult[]> {
  try {
    const client = getOrCreateClient('https://api.orderly.org', 30000);
    const response = await cachedRequest('orderly:market-summary', async () => (await retry(() => client.post('/v1/public/query', { type: 'marketSummary' }))).data, 60 * 1000);
    const markets = response?.data?.markets;
    if (!Array.isArray(markets)) return [];
    return markets.filter((m: any) => m?.symbol?.startsWith('PERP_')).map((m: any) => {
      const funding = safeParseFloat(m.last_funding_rate ?? m.est_funding_rate, NaN);
      if (!Number.isFinite(funding)) return null;
      upsertContractMetadata({ exchange: 'orderly', contract: m.symbol }).catch(() => {});
      return toExchangeResult({ exchange: 'orderly', contract: m.symbol, currentFunding: funding, fundingIntervalSeconds: KNOWN_INTERVALS.EIGHT_HOUR, fundingIntervalSource: 'default', fundingNextApply: toMs(m.next_funding_time), markPrice: safeParseFloat(m.mark_price), volume24hSettle: safeParseFloat(m.total_24h_volume), openInterestUsd: safeParseFloat(m.open_interest), });
    }).filter((r): r is ExchangeResult => r !== null);
  } catch (err) { logger.error(`Error scanning Orderly: ${(err as Error).message}`); return []; }
}
