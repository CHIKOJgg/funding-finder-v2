import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { retry, getOrCreateClient, cachedRequest, safeParseFloat, toMs } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const HTX_BASE = 'https://api.hbdm.com';
const HTX_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR;

export async function scanHtx(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting HTX scan...');
    const client = getOrCreateClient(HTX_BASE, 30000);

    const [contractInfo, batchFunding] = await Promise.all([
      cachedRequest(
        'htx:contract_info',
        async () => {
          const res = await retry(() => client.get('/linear-swap-api/v1/swap_contract_info'));
          return res.data?.data || [];
        },
        5 * 60 * 1000
      ),
      cachedRequest(
        'htx:batch_funding',
        async () => {
          const res = await retry(() => client.get('/linear-swap-api/v1/swap_batch_funding_rate'));
          return res.data?.data || [];
        },
        60_000
      ),
    ]);

    const fundingMap = new Map<string, any>();
    for (const f of batchFunding as any[]) {
      if (f && f.contract_code) fundingMap.set(f.contract_code, f);
    }

    const candidates = (contractInfo as any[])
      .filter(
        (c) =>
          c &&
          c.contract_code &&
          (c.trade_partition === 'USDT' || c.trade_partition === 'USDC') &&
          c.contract_status === 1 &&
          c.business_type === 'swap'
      );
    logger.info(`HTX: ${candidates.length} USDT perp contracts`);

    const results = candidates.map((c: any) => {
      const symbol = c.contract_code; // e.g. BTC-USDT
      try {
        const fd = fundingMap.get(symbol);
        const currentFunding = safeParseFloat(fd?.funding_rate);
        const nextFunding = toMs(fd?.funding_time ?? fd?.next_funding_time) || 0;
        const intervalHours = safeParseFloat(c.settlement_period, 8);
        const intervalSeconds = intervalHours > 0 ? intervalHours * 3600 : HTX_INTERVAL;

        upsertContractMetadata({
          exchange: 'htx',
          contract: symbol,
          baseCurrency: c.symbol,
          quoteCurrency: c.trade_partition || 'USDT',
        }).catch(() => {});

        return toExchangeResult({
          exchange: 'htx',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: intervalSeconds,
          fundingIntervalSource: c.settlement_period ? 'api' : 'default',
          fundingNextApply: nextFunding,
          markPrice: 0,
          volume24hSettle: 0,
        });
      } catch (err) {
        logger.debug(`HTX: Error ${symbol} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`HTX scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err) {
    logger.error(`Error scanning HTX: ${(err as Error).message}`);
    return [];
  }
}
