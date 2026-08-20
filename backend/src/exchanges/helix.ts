import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { retry, getOrCreateClient, cachedRequest, safeParseFloat, toMs } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const HELIX_BASE = 'https://sentry.lcd.injective.network';
const HELIX_INTERVAL = KNOWN_INTERVALS.HOURLY; // 1h fixed

export async function scanHelix(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting Helix (Injective) scan...');
    const client = getOrCreateClient(HELIX_BASE, 30000);

    const markets = await cachedRequest(
      'helix:derivative-markets',
      async () => {
        try {
          const res = await retry(() => client.get('/injective/exchange/v1beta1/derivative/markets'));
          return res.data?.markets || res.data?.data || [];
        } catch {
          const altClient = getOrCreateClient('https://injective-rest.publicnode.com', 30000);
          const res2 = await retry(() => altClient.get('/injective/exchange/v1beta1/derivative/markets'));
          return res2.data?.markets || res2.data?.data || [];
        }
      },
      60_000
    );

    const candidates = (markets as any[])
      .filter((m) => m && m.market && (m.market.ticker?.includes('PERP') || m.market.isPerpetual));
    logger.info(`Helix: Processing ${candidates.length} perp markets`);

    const results = (candidates as any[]).map((m: any) => {
      const ticker = String(m.market?.ticker || '');
      const cleanContract = ticker.replace(/\s+/g, '').replace('/', '').replace('PERP', 'PERP'); // e.g. BTCUSDT-PERP or BTC/USDT PERP
      try {
        const perpInfo = m.perpetual_info?.market_info || m.perpetual_market_info || {};
        const fundingInfo = m.perpetual_market_funding || {};
        const hourlyRate = safeParseFloat(
          perpInfo.hourly_funding_rate ??
          fundingInfo.funding_rate ??
          fundingInfo.hourly_funding_rate ??
          perpInfo.funding_rate ??
          perpInfo.hourly_funding_rate_cap ??
          perpInfo.hourly_interest_rate ??
          0
        );
        const quoteDecimals = safeParseFloat(m.market?.quote_decimals, 6) || 6;
        const rawMark = safeParseFloat(m.mark_price ?? m.oracle_price ?? 0);
        const mark = rawMark > 1e6 ? rawMark / Math.pow(10, quoteDecimals) : rawMark;
        const intervalSec = safeParseFloat(perpInfo.funding_interval, 3600);
        const nextFunding = toMs(perpInfo.next_funding_timestamp) || (Date.now() + 3600_000);
        const vol = safeParseFloat(m.volume_24h ?? m.volume_usd ?? m.turnover ?? m.volume ?? 0);

        upsertContractMetadata({ exchange: 'helix', contract: ticker }).catch(() => {});

        return toExchangeResult({
          exchange: 'helix',
          contract: ticker || cleanContract,
          currentFunding: hourlyRate,
          fundingIntervalSeconds: intervalSec > 0 ? intervalSec : HELIX_INTERVAL,
          fundingIntervalSource: perpInfo.funding_interval ? 'api' : 'default',
          fundingNextApply: nextFunding,
          markPrice: mark > 0 ? mark : 0,
          volume24hSettle: vol > 0 ? vol : 50000,
        });
      } catch (err) {
        logger.debug(`Helix: Error ${ticker} — ${(err as Error).message}`);
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
