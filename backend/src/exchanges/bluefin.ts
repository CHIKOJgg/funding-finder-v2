import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { retry, getOrCreateClient, cachedRequest, safeParseFloat } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const BLUEFIN_BASE = 'https://api.sui-prod.bluefin.io/v1';
const E9 = 1e9;
const BLUEFIN_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR; // 8h fixed

export async function scanBluefin(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting Bluefin scan...');
    const client = getOrCreateClient(BLUEFIN_BASE, 30000);

    const [info, tickers] = await Promise.all([
      cachedRequest('bluefin:info', async () => {
        const res = await retry(() => client.get('/exchange/info'));
        return res.data?.data?.markets || res.data?.markets || [];
      }, 6 * 60 * 60 * 1000),
      cachedRequest('bluefin:tickers', async () => {
        const res = await retry(() => client.get('/exchange/tickers'));
        return res.data?.data || res.data || [];
      }, 60_000),
    ]);

    const tickerMap = new Map<string, any>();
    for (const t of tickers as any[]) tickerMap.set(t.symbol, t);

    const candidates = (info as any[])
      .filter((m) => m && m.symbol && m.symbol.endsWith('PERP'))
      .slice(0, 250);
    logger.info(`Bluefin: Processing ${candidates.length} perp markets`);

    const results = (candidates as any[]).map((m: any) => {
      const symbol = m.symbol; // BTC-PERP
      try {
        const t = tickerMap.get(symbol);
        if (!t) return null;

        const currentFunding = safeParseFloat(t.lastFundingRateE9) / E9;
        const mark = safeParseFloat(t.markPriceE9) / E9;
        const vol24 = safeParseFloat(t.quoteVolume24hrE9) / E9; // USDC
        const nextFunding = Number(t.nextFundingTimeAtMillis) || 0;

        upsertContractMetadata({ exchange: 'bluefin', contract: symbol }).catch(() => {});

        return toExchangeResult({
          exchange: 'bluefin',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: BLUEFIN_INTERVAL,
          fundingIntervalSource: 'default',
          fundingNextApply: nextFunding,
          markPrice: mark,
          volume24hSettle: vol24,
        });
      } catch (err) {
        logger.debug(`Bluefin: Error ${symbol} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`Bluefin scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err) {
    logger.error(`Error scanning Bluefin: ${(err as Error).message}`);
    return [];
  }
}
