import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { mapWithConcurrency, retry, getOrCreateClient, cachedRequest, safeParseFloat, toMs } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const BLOFIN_BASE = 'https://openapi.blofin.com';
const CONCURRENCY = 5;
const BLOFIN_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR;

export async function scanBloFin(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting BloFin scan...');
    const client = getOrCreateClient(BLOFIN_BASE, 30000);

    const [instruments, tickers] = await Promise.all([
      cachedRequest(
        'blofin:instruments',
        async () => {
          const res = await retry(() => client.get('/api/v1/market/instruments'));
          return res.data?.data || [];
        },
        5 * 60 * 1000
      ),
      cachedRequest(
        'blofin:tickers',
        async () => {
          const res = await retry(() => client.get('/api/v1/market/tickers'));
          return res.data?.data || [];
        },
        60_000
      ),
    ]);

    const tickerMap = new Map<string, any>();
    for (const t of tickers as any[]) {
      if (t && t.instId) tickerMap.set(t.instId, t);
    }

    const candidates = (instruments as any[])
      .filter((i) => i && i.instId && i.instType === 'SWAP' && (i.settleCurrency === 'USDT' || i.settleCurrency === 'USDC') && i.state === 'live')
      .sort((a, b) => Number(tickerMap.get(b.instId)?.volCurrency24h || 0) - Number(tickerMap.get(a.instId)?.volCurrency24h || 0))
      .slice(0, 100);

    logger.info(`BloFin: Processing ${candidates.length} USDT swaps`);

    const results = await mapWithConcurrency(candidates, { concurrency: CONCURRENCY, delayMs: 25 }, async (i: any) => {
      const symbol = i.instId; // BTC-USDT
      try {
        const td = tickerMap.get(symbol);
        const fd = await cachedRequest(
          `blofin:funding:${symbol}`,
          async () => {
            try {
              const res = await retry(() => client.get('/api/v1/market/funding-rate', { params: { instId: symbol }, timeout: 8000 }), 2, 200);
              return res.data?.data?.[0] || null;
            } catch {
              return null;
            }
          },
          120_000
        );
        if (!fd) return null;

        const currentFunding = safeParseFloat(fd.fundingRate);
        const nextFunding = toMs(fd.fundingTime) || 0;
        const mark = safeParseFloat(td?.last ?? td?.askPrice);
        const vol24 = safeParseFloat(td?.volCurrency24h ?? td?.vol24h);

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
