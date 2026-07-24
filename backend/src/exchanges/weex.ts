import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { mapWithConcurrency, retry, getOrCreateClient, cachedRequest, safeParseFloat } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const WEEX_BASE = 'https://api.weex.com';
const CONCURRENCY = 3;
const WEEX_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR; // typical 8h

export async function scanWeex(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting WEEX scan...');
    const client = getOrCreateClient(WEEX_BASE, 30000);

    const symbols = await cachedRequest(
      'weex:symbols',
      async () => {
        const res = await retry(() => client.get('/api/v1/futures/public/symbols'));
        return res.data?.data || res.data?.result || [];
      },
      6 * 60 * 60 * 1000
    );

    const candidates = (symbols as any[])
      .filter((s) => s && s.symbol && s.symbol.endsWith('USDT'))
      .slice(0, 200);
    logger.info(`WEEX: Processing ${candidates.length} perp symbols`);

    const results = await mapWithConcurrency(candidates, { concurrency: CONCURRENCY }, async (s: any) => {
      const symbol = s.symbol; // BTCUSDT
      try {
        const [fr, tk] = await Promise.allSettled([
          retry(() => client.get('/api/v1/futures/public/funding-rate', { params: { symbol }, timeout: 10000 })),
          retry(() => client.get('/api/v1/futures/public/ticker', { params: { symbol }, timeout: 10000 })),
        ]);
        const fd = fr.status === 'fulfilled' ? fr.value.data?.data : null;
        const td = tk.status === 'fulfilled' ? tk.value.data?.data : null;
        if (!fd) return null;

        const currentFunding = safeParseFloat(fd.funding_rate);
        const nextFunding = Number(fd.funding_time) || 0;
        const mark = safeParseFloat(fd.mark_price) || safeParseFloat(td?.last_price);
        const vol24 = safeParseFloat(td?.volume_24h) || safeParseFloat(td?.turnover_24h);

        upsertContractMetadata({ exchange: 'weex', contract: symbol }).catch(() => {});

        return toExchangeResult({
          exchange: 'weex',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: WEEX_INTERVAL,
          fundingIntervalSource: 'default',
          fundingNextApply: nextFunding,
          markPrice: mark,
          volume24hSettle: vol24,
        });
      } catch (err) {
        logger.debug(`WEEX: Error ${symbol} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`WEEX scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err) {
    logger.error(`Error scanning WEEX: ${(err as Error).message}`);
    return [];
  }
}
