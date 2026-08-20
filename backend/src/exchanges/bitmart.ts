import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { retry, getOrCreateClient, cachedRequest, safeParseFloat, toMs } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const BITMART_BASE = 'https://api-cloud-v2.bitmart.com';
const BITMART_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR; // typical 8h

export async function scanBitMart(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting BitMart scan...');
    const client = getOrCreateClient(BITMART_BASE, 30000);

    const symbols = await cachedRequest(
      'bitmart:v2:symbols',
      async () => {
        const res = await retry(() => client.get('/contract/public/details'));
        return res.data?.data?.symbols || [];
      },
      60_000
    );

    const candidates = (Array.isArray(symbols) ? symbols : [])
      .filter((t: any) => t && t.symbol && (t.symbol.endsWith('USDT') || t.symbol.endsWith('USDC')) && (t.status === 'Trading' || !t.status));

    logger.info(`BitMart: Processing ${candidates.length} perp symbols`);

    const results = candidates.map((t: any) => {
      const symbol = t.symbol; // BTCUSDT
      try {
        const currentFunding = safeParseFloat(t.funding_rate ?? t.fundingRate);
        const nextFunding = toMs(t.funding_time ?? t.fundingTime) || 0;
        const mark = safeParseFloat(t.mark_price ?? t.last_price ?? t.index_price);
        const vol24 = safeParseFloat(t.turnover_24h ?? t.volume_24h ?? t.open_interest_value);
        const intervalHours = safeParseFloat(t.funding_interval_hours, 8);
        const intervalSeconds = intervalHours > 0 ? intervalHours * 3600 : BITMART_INTERVAL;
        const oiUsd = safeParseFloat(t.open_interest_value);

        upsertContractMetadata({
          exchange: 'bitmart',
          contract: symbol,
          baseCurrency: t.base_currency,
          quoteCurrency: t.quote_currency || 'USDT',
        }).catch(() => {});

        return toExchangeResult({
          exchange: 'bitmart',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: intervalSeconds,
          fundingIntervalSource: t.funding_interval_hours ? 'api' : 'default',
          fundingNextApply: nextFunding,
          markPrice: mark,
          volume24hSettle: vol24,
          openInterestUsd: oiUsd > 0 ? oiUsd : undefined,
        });
      } catch (err) {
        logger.debug(`BitMart: Error ${symbol} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`BitMart scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err) {
    logger.error(`Error scanning BitMart: ${(err as Error).message}`);
    return [];
  }
}
