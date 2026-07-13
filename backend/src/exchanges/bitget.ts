import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { mapWithConcurrency, retry, getOrCreateClient, cachedRequest, safeParseFloat } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const BITGET_BASE = 'https://api.bitget.com';
const CONCURRENCY = 8;
const BITGET_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR; // 8h default

// Derive next funding time from the funding interval aligned to UTC day
// boundaries (Bitget settles at 00:00 / 08:00 / 16:00 UTC for 8h).
function deriveNextFunding(intervalSeconds: number): number {
  const intervalMs = intervalSeconds * 1000;
  const now = Date.now();
  return Math.ceil(now / intervalMs) * intervalMs;
}

export async function scanBitget(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting Bitget scan...');

    const client = getOrCreateClient(BITGET_BASE, 30000);

    const tickers = await cachedRequest(
      'bitget:tickers',
      async () => {
        const res = await retry(() =>
          client.get('/api/v2/mix/market/tickers', {
            params: { productType: 'usdt-futures' },
          })
        );
        return res.data?.data || [];
      },
      60_000
    );

    logger.info(`Bitget: Found ${tickers.length} tickers`);

    // Per-contract funding interval (hours) — stable, cache for 6h.
    const intervalMap = await cachedRequest(
      'bitget:contracts:intervals',
      async () => {
        const res = await retry(() =>
          client.get('/api/v2/mix/market/contracts', {
            params: { productType: 'usdt-futures' },
          })
        );
        const map = new Map<string, number>();
        for (const c of res.data?.data || []) {
          const hours = safeParseFloat(c.fundInterval, 8);
          map.set(c.symbol, hours > 0 ? hours * 3600 : BITGET_INTERVAL);
        }
        return map;
      },
      6 * 60 * 60 * 1000
    );

    const candidates = (tickers as any[])
      .filter((t) => t && t.symbol && t.symbol.endsWith('USDT'))
      .sort((a, b) => Number(b.usdtVolume || 0) - Number(a.usdtVolume || 0))
      .slice(0, 250);

    logger.info(`Bitget: Processing ${candidates.length} contracts`);

    const results = await mapWithConcurrency(candidates, { concurrency: CONCURRENCY }, async (t: any) => {
      try {
        const symbol = t.symbol;
        const currentFunding = safeParseFloat(t.fundingRate);
        const mark = safeParseFloat(t.markPrice);
        const vol24 = safeParseFloat(t.usdtVolume);

        const intervalSeconds = intervalMap.get(symbol) || BITGET_INTERVAL;

        upsertContractMetadata({ exchange: 'bitget', contract: symbol }).catch(() => {});

        return toExchangeResult({
          exchange: 'bitget',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: intervalSeconds,
          fundingIntervalSource: intervalMap.has(symbol) ? 'api' : 'default',
          fundingNextApply: deriveNextFunding(intervalSeconds),
          markPrice: mark,
          volume24hSettle: vol24,
        });
      } catch (err) {
        logger.debug(`Bitget: Error ${t.symbol} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`Bitget scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err) {
    logger.error(`Error scanning Bitget: ${(err as Error).message}`);
    return [];
  }
}
