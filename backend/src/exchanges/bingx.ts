import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { retry, getOrCreateClient, cachedRequest, safeParseFloat, toMs } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const BINGX_BASE = 'https://open-api.bingx.com';
const BINGX_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR; // 8h default

export async function scanBingX(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting BingX scan...');

    const client = getOrCreateClient(BINGX_BASE, 30000);

    const [premiumIndexRes, tickersRes] = await Promise.all([
      cachedRequest(
        'bingx:premiumIndex',
        async () => {
          const res = await retry(() => client.get('/openApi/swap/v2/quote/premiumIndex'));
          return res.data?.data || [];
        },
        60_000
      ),
      cachedRequest(
        'bingx:tickers',
        async () => {
          const res = await retry(() => client.get('/openApi/swap/v2/quote/ticker'));
          return res.data?.data || [];
        },
        60_000
      ),
    ]);

    logger.info(`BingX: Found ${premiumIndexRes.length} premium indices, ${tickersRes.length} tickers`);

    const tickerMap = new Map<string, any>();
    for (const t of tickersRes as any[]) {
      if (t && t.symbol) tickerMap.set(t.symbol, t);
    }

    const candidates = (premiumIndexRes as any[])
      .filter((t) => t && t.symbol && (t.symbol.endsWith('USDT') || t.symbol.endsWith('USDC')));

    logger.info(`BingX: Processing ${candidates.length} contracts`);

    const results = candidates.map((p: any) => {
      const symbol = p.symbol; // e.g. BTC-USDT
      try {
        const t = tickerMap.get(symbol);
        const vol24 = safeParseFloat(t?.quoteVolume ?? t?.volume);
        const mark = safeParseFloat(p.markPrice ?? t?.lastPrice);
        const currentFunding = safeParseFloat(p.lastFundingRate);
        const nextFunding = toMs(p.nextFundingTime) || 0;
        const intervalHours = safeParseFloat(p.fundingIntervalHours, 8);
        const intervalSeconds = intervalHours > 0 ? intervalHours * 3600 : BINGX_INTERVAL;

        upsertContractMetadata({ exchange: 'bingx', contract: symbol }).catch(() => {});

        return toExchangeResult({
          exchange: 'bingx',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: intervalSeconds,
          fundingIntervalSource: p.fundingIntervalHours ? 'api' : 'default',
          fundingNextApply: nextFunding,
          markPrice: mark,
          volume24hSettle: vol24,
        });
      } catch (err) {
        logger.debug(`BingX: Error ${symbol} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`BingX scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err) {
    logger.error(`Error scanning BingX: ${(err as Error).message}`);
    return [];
  }
}
