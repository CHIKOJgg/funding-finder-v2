import { ExchangeResult, KNOWN_INTERVALS } from '../types/index.js';
import { cachedRequest, getOrCreateClient, mapWithConcurrency, retry, safeParseFloat } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const BASE = 'https://api.international.coinbase.com';
export async function scanCoinbase(): Promise<ExchangeResult[]> {
  try {
    const client = getOrCreateClient(BASE, 30000);
    const instruments = await cachedRequest('coinbase:instruments', async () => (await retry(() => client.get('/api/v1/instruments'))).data, 5 * 60 * 1000);
    const candidates = (Array.isArray(instruments) ? instruments : []).filter((i: any) => i?.type === 'PERP').slice(0, 100);
    const results = await mapWithConcurrency(candidates, { concurrency: 3 }, async (i: any) => {
      try {
        const name = i.instrument ?? i.instrument_name ?? i.symbol;
        if (!name) return null;
        const quote = await cachedRequest(`coinbase:quote:${name}`, async () => (await retry(() => client.get(`/api/v1/instruments/${encodeURIComponent(name)}/quote`))).data, 60 * 1000);
        const funding = safeParseFloat(quote?.predicted_funding, NaN);
        if (!Number.isFinite(funding)) return null;
        upsertContractMetadata({ exchange: 'coinbase', contract: name }).catch(() => {});
        // The quote timestamp is observation time, not a funding settlement time.
        return toExchangeResult({ exchange: 'coinbase', contract: name, currentFunding: funding, fundingIntervalSeconds: KNOWN_INTERVALS.EIGHT_HOUR, fundingIntervalSource: 'default', fundingNextApply: 0, markPrice: safeParseFloat(quote?.mark_price), volume24hSettle: safeParseFloat(i.volume_24h ?? i.volume), });
      } catch { return null; }
    });
    return results.filter((r): r is ExchangeResult => r !== null);
  } catch (err) { logger.error(`Error scanning Coinbase International: ${(err as Error).message}`); return []; }
}
