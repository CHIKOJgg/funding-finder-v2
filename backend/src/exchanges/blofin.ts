import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { mapWithConcurrency, retry, getOrCreateClient, cachedRequest, safeParseFloat } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const BLOFIN_BASE = 'https://openapi.blofin.com';
const CONCURRENCY = 3;
const BLOFIN_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR; // not exposed by API

export async function scanBloFin(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting BloFin scan...');
    const client = getOrCreateClient(BLOFIN_BASE, 30000);

    const instruments = await cachedRequest(
      'blofin:instruments',
      async () => {
        const res = await retry(() => client.get('/api/v1/market/instruments'));
        return res.data?.data || [];
      },
      5 * 60 * 1000
    );

    const candidates = (instruments as any[])
      .filter((i) => i && i.instId && i.instType === 'SWAP' && i.settleCurrency === 'USDT' && i.state === 'live')
      .slice(0, 150);
    logger.info(`BloFin: Processing ${candidates.length} USDT swaps`);

    const results = await mapWithConcurrency(candidates, { concurrency: CONCURRENCY }, async (i: any) => {
      const symbol = i.instId; // BTC-USDT
      try {
        const [fr, mp, tk] = await Promise.allSettled([
          retry(() => client.get('/api/v1/market/funding-rate', { params: { instId: symbol }, timeout: 10000 })),
          retry(() => client.get('/api/v1/market/mark-price', { params: { instId: symbol }, timeout: 10000 })),
          retry(() => client.get('/api/v1/market/tickers', { params: { instId: symbol }, timeout: 10000 })),
        ]);
        const fd = fr.status === 'fulfilled' ? fr.value.data?.data?.[0] : null;
        const md = mp.status === 'fulfilled' ? mp.value.data?.data?.[0] : null;
        const td = tk.status === 'fulfilled' ? tk.value.data?.data?.[0] : null;
        if (!fd) return null;

        const currentFunding = safeParseFloat(fd.fundingRate);
        const nextFunding = Number(fd.fundingTime) || 0;
        const mark = safeParseFloat(md?.markPrice) || 0;
        const vol24 = safeParseFloat(td?.volCurrency24h);

        upsertContractMetadata({ exchange: 'blofin', contract: symbol }).catch(() => {});

        return toExchangeResult({
          exchange: 'blofin',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: BLOFIN_INTERVAL,
          fundingIntervalSource: 'default',
          fundingNextApply: nextFunding,
          markPrice: mark,
          volume24hSettle: vol24,
        });
      } catch (err) {
        logger.debug(`BloFin: Error ${symbol} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`BloFin scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err) {
    logger.error(`Error scanning BloFin: ${(err as Error).message}`);
    return [];
  }
}
