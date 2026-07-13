import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { cachedRequest, safeParseFloat } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const HYPERLIQUID_INFO = 'https://api.hyperliquid.xyz/info';
const HL_INTERVAL = KNOWN_INTERVALS.HOURLY; // 1h fixed

async function hlInfo(type: string): Promise<any> {
  const res = await fetch(HYPERLIQUID_INFO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type }),
  });
  if (!res.ok) throw new Error(`Hyperliquid ${type} HTTP ${res.status}`);
  return res.json();
}

export async function scanHyperliquid(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting Hyperliquid scan...');

    const [metaAndCtxs, predicted] = await Promise.all([
      cachedRequest('hl:metaAndAssetCtxs', () => hlInfo('metaAndAssetCtxs'), 60_000),
      cachedRequest('hl:predictedFundings', () => hlInfo('predictedFundings'), 30_000),
    ]);

    const meta = metaAndCtxs?.[0];
    const assetCtxs: any[] = metaAndCtxs?.[1] || [];
    const universe: any[] = meta?.universe || [];

    // Map coin -> next funding time (ms) from predicted fundings.
    const nextFundingMap = new Map<string, number>();
    for (const entry of predicted || []) {
      const coin = entry?.[0];
      const venues = entry?.[1] || [];
      const first = venues?.[0]?.[1];
      if (coin && first?.nextFundingTime) {
        nextFundingMap.set(coin, Number(first.nextFundingTime));
      }
    }

    if (!universe.length || !assetCtxs.length) {
      logger.warn('Hyperliquid: empty meta/contexts');
      return [];
    }

    // Pair universe index with its asset context. Some indices may be absent.
    const results: (ExchangeResult | null)[] = universe.map((u, i) => {
      const ctx = assetCtxs[i];
      if (!ctx) return null;
      try {
        const coin = u.name;
        const currentFunding = safeParseFloat(ctx.funding);
        const mark = safeParseFloat(ctx.markPx);
        const vol24 = safeParseFloat(ctx.dayNtlVlm);
        const nextFunding = nextFundingMap.get(coin) || 0;

        upsertContractMetadata({
          exchange: 'hyperliquid',
          contract: coin,
          baseCurrency: coin,
          maxLeverage: u.maxLeverage ? Number(u.maxLeverage) : undefined,
        }).catch(() => {});

        return toExchangeResult({
          exchange: 'hyperliquid',
          contract: coin,
          currentFunding,
          fundingIntervalSeconds: HL_INTERVAL,
          fundingIntervalSource: 'default',
          fundingNextApply: nextFunding,
          markPrice: mark,
          volume24hSettle: vol24,
        });
      } catch (err) {
        logger.debug(`Hyperliquid: Error ${u?.name} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results
      .filter((r): r is ExchangeResult => r !== null)
      .sort((a, b) => b.volume_24h_settle - a.volume_24h_settle)
      .slice(0, 300);

    logger.info(`Hyperliquid scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err) {
    logger.error(`Error scanning Hyperliquid: ${(err as Error).message}`);
    return [];
  }
}
