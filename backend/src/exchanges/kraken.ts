import { ExchangeResult, KNOWN_INTERVALS } from '../types/index.js';
import { cachedRequest, getOrCreateClient, retry, safeParseFloat } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const BASE = 'https://futures.kraken.com';

export async function scanKraken(): Promise<ExchangeResult[]> {
  try {
    const client = getOrCreateClient(BASE, 30000);
    const [instruments, tickers] = await Promise.all([
      cachedRequest('kraken:instruments', async () => (await retry(() => client.get('/derivatives/api/v3/instruments'))).data?.instruments || [], 5 * 60 * 1000),
      cachedRequest('kraken:tickers', async () => (await retry(() => client.get('/derivatives/api/v3/tickers'))).data?.tickers || [], 60 * 1000),
    ]);
    const metadata = new Map((instruments as any[]).map((i) => [i.symbol, i]));
    return (tickers as any[]).filter((t) => t?.tag === 'perpetual' && t.symbol).map((t) => {
      try {
        const meta = metadata.get(t.symbol) || {};
        const intervalValue = meta.fundingIntervalHours ?? meta.funding_interval_hours ?? meta.fundingInterval;
        const intervalHours = safeParseFloat(intervalValue, 8);
        const next = safeParseFloat(t.nextFundingTime ?? t.next_funding_time, 0);
        const result = toExchangeResult({ exchange: 'kraken', contract: t.symbol, currentFunding: safeParseFloat(t.fundingRate), fundingIntervalSeconds: intervalHours * 3600 || KNOWN_INTERVALS.EIGHT_HOUR, fundingIntervalSource: intervalValue !== undefined && intervalValue !== null ? 'api' : 'default', fundingNextApply: next < 1e12 && next > 0 ? next * 1000 : next, markPrice: safeParseFloat(t.markPrice), volume24hSettle: safeParseFloat(t.volume24h ?? t.volume), });
        upsertContractMetadata({ exchange: 'kraken', contract: t.symbol }).catch(() => {});
        return result;
      } catch { return null; }
    }).filter((r): r is ExchangeResult => r !== null);
  } catch (err) {
    logger.error(`Error scanning Kraken: ${(err as Error).message}`);
    return [];
  }
}
