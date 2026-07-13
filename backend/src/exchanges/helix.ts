import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { retry, getOrCreateClient, cachedRequest, safeParseFloat } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const HELIX_BASE = 'https://k8s.mainnet.exchange.gm.injective.network/api/exchange/v1';
const HELIX_INTERVAL = KNOWN_INTERVALS.HOURLY; // 1h fixed

export async function scanHelix(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting Helix (Injective) scan...');
    const client = getOrCreateClient(HELIX_BASE, 30000);

    const markets = await cachedRequest(
      'helix:perpetual-markets',
      async () => {
        const res = await retry(() => client.get('/perpetual-markets'));
        return res.data?.data || res.data || [];
      },
      60_000
    );

    const candidates = (markets as any[])
      .filter((m) => m && m.marketId && m.marketId.toLowerCase().includes('perp'))
      .slice(0, 250);
    logger.info(`Helix: Processing ${candidates.length} perp markets`);

    const results = (candidates as any[]).map((m: any) => {
      const symbol = m.marketId; // e.g. btcusdt-perp
      try {
        const currentFunding = safeParseFloat(m.fundingRate);
        const mark = safeParseFloat(m.markPrice) || safeParseFloat(m.oraclePrice);
        const vol24 = safeParseFloat(m.volume24h) || safeParseFloat(m.takerVolume) || 0;
        const nextFunding = Number(m.nextFundingTimestamp) || 0;

        upsertContractMetadata({ exchange: 'helix', contract: symbol }).catch(() => {});

        return toExchangeResult({
          exchange: 'helix',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: HELIX_INTERVAL,
          fundingIntervalSource: 'default',
          fundingNextApply: nextFunding,
          markPrice: mark,
          volume24hSettle: vol24,
        });
      } catch (err) {
        logger.debug(`Helix: Error ${symbol} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`Helix scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err) {
    logger.error(`Error scanning Helix: ${(err as Error).message}`);
    return [];
  }
}
