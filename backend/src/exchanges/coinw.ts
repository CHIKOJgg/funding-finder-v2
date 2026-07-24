import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { mapWithConcurrency, retry, getOrCreateClient, cachedRequest, safeParseFloat } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const COINW_BASE = 'https://api.coinw.com';
const CONCURRENCY = 3;
const COINW_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR; // typical 8h

export async function scanCoinW(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting CoinW scan...');
    const client = getOrCreateClient(COINW_BASE, 30000);

    const symbols = await cachedRequest(
      'coinw:symbols',
      async () => {
        const res = await retry(() => client.get('/api/v2/futures/public/symbols'));
        return res.data?.data || [];
      },
      6 * 60 * 60 * 1000
    );

    const candidates = (symbols as any[])
      .filter((s) => s && s.symbol && s.symbol.endsWith('USDT'))
      .slice(0, 200);
    logger.info(`CoinW: Processing ${candidates.length} perp symbols`);

    const results = await mapWithConcurrency(candidates, { concurrency: CONCURRENCY }, async (s: any) => {
      const symbol = s.symbol; // BTCUSDT
      try {
        const [fr, tk] = await Promise.allSettled([
          retry(() => client.get('/api/v2/futures/public/funding-rate', { params: { symbol }, timeout: 10000 })),
          retry(() => client.get('/api/v2/futures/public/ticker', { params: { symbol }, timeout: 10000 })),
        ]);
        const fd = fr.status === 'fulfilled' ? fr.value.data?.data : null;
        const td = tk.status === 'fulfilled' ? tk.value.data?.data : null;
        if (!fd) return null;

        const currentFunding = safeParseFloat(fd.funding_rate);
        const nextFunding = Number(fd.funding_time) || Number(fd.next_funding_time) || 0;
        const mark = safeParseFloat(fd.mark_price) || safeParseFloat(td?.mark_price) || safeParseFloat(td?.last_price);
        const vol24 = safeParseFloat(td?.quote_volume) || safeParseFloat(td?.volume_24h);

        upsertContractMetadata({ exchange: 'coinw', contract: symbol }).catch(() => {});

        return toExchangeResult({
          exchange: 'coinw',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: COINW_INTERVAL,
          fundingIntervalSource: 'default',
          fundingNextApply: nextFunding,
          markPrice: mark,
          volume24hSettle: vol24,
        });
      } catch (err) {
        logger.debug(`CoinW: Error ${symbol} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`CoinW scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err) {
    logger.error(`Error scanning CoinW: ${(err as Error).message}`);
    return [];
  }
}
