import { ExchangeResult, KNOWN_INTERVALS } from '../types/index.js';
import { cachedRequest, getOrCreateClient, mapWithConcurrency, retry, safeParseFloat, toMs } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

export async function scanAevo(): Promise<ExchangeResult[]> {
  try {
    const client = getOrCreateClient('https://api.aevo.xyz', 30000);
    const markets = await cachedRequest('aevo:markets', async () => (await retry(() => client.get('/markets'))).data, 5 * 60 * 1000);
    const candidates = (Array.isArray(markets) ? markets : [])
      .filter((m: any) => m?.instrument_type === 'PERPETUAL' || /-PERP$/.test(m?.instrument_name || ''))
      .sort((a, b) => Number(b.volume_24h || b.volume || 0) - Number(a.volume_24h || a.volume || 0))
      .slice(0, 80);

    const results = await mapWithConcurrency(candidates, { concurrency: 5, delayMs: 20 }, async (m: any) => {
      try {
        const name = m.instrument_name;
        const funding = await cachedRequest(`aevo:funding:${name}`, async () => (await retry(() => client.get('/funding', { params: { instrument_name: name } }))).data, 60 * 1000);
        const rate = safeParseFloat(funding?.funding_rate, NaN);
        if (!name || !Number.isFinite(rate)) return null;
        upsertContractMetadata({ exchange: 'aevo', contract: name }).catch(() => {});
        const nextApplyMs = funding?.next_epoch ? Number(funding.next_epoch) / 1e6 : 0;
        return toExchangeResult({ exchange: 'aevo', contract: name, currentFunding: rate, fundingIntervalSeconds: KNOWN_INTERVALS.EIGHT_HOUR, fundingIntervalSource: 'default', fundingNextApply: nextApplyMs, markPrice: safeParseFloat(m.mark_price), volume24hSettle: safeParseFloat(m.volume_24h ?? m.volume), });
      } catch { return null; }
    });
    return results.filter((r): r is ExchangeResult => r !== null);
  } catch (err) { logger.error(`Error scanning Aevo: ${(err as Error).message}`); return []; }
}
