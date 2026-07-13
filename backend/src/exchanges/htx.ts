import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { mapWithConcurrency, retry, getOrCreateClient, cachedRequest, safeParseFloat } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const HTX_BASE = 'https://api.hbdm.com';
const CONCURRENCY = 6;
const HTX_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR;

export async function scanHtx(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting HTX scan...');
    const client = getOrCreateClient(HTX_BASE, 30000);

    const contractInfo = await cachedRequest(
      'htx:contract_info',
      async () => {
        const res = await retry(() => client.get('/linear-swap-api/v1/swap_contract_info'));
        return res.data?.data || [];
      },
      6 * 60 * 60 * 1000
    );

    const candidates = (contractInfo as any[])
      .filter(
        (c) =>
          c &&
          c.contract_code &&
          c.trade_partition === 'USDT' &&
          c.contract_status === 1 &&
          c.business_type === 'swap'
      )
      .slice(0, 200);
    logger.info(`HTX: ${candidates.length} USDT perp contracts`);

    // Best-effort batch tickers for mark price.
    const markMap = await cachedRequest(
      'htx:tickers',
      async () => {
        try {
          const res = await retry(() => client.get('/linear-swap-api/v1/swap_ticker'));
          const m = new Map<string, number>();
          for (const t of res.data?.data || []) m.set(t.contract_code, safeParseFloat(t.last_price));
          return m;
        } catch {
          return new Map<string, number>();
        }
      },
      60_000
    );

    const results = await mapWithConcurrency(candidates, { concurrency: CONCURRENCY }, async (c: any) => {
      const symbol = c.contract_code; // e.g. BTC-USDT
      try {
        const [fr, oi] = await Promise.allSettled([
          retry(() => client.get('/linear-swap-api/v1/swap_funding_rate', { params: { contract_code: symbol }, timeout: 10000 })),
          retry(() => client.get('/linear-swap-api/v1/swap_open_interest', { params: { contract_code: symbol }, timeout: 10000 })),
        ]);
        const fd = fr.status === 'fulfilled' ? fr.value.data?.data : null;
        const od = oi.status === 'fulfilled' ? oi.value.data?.data?.[0] : null;
        if (!fd) return null;

        const currentFunding = safeParseFloat(fd.funding_rate);
        const nextFunding = Number(fd.funding_time) || 0;
        const mark = markMap.get(symbol) || 0;
        const vol24 = safeParseFloat(od?.value);
        const intervalHours = safeParseFloat(c.settlement_period, 8);
        const intervalSeconds = intervalHours > 0 ? intervalHours * 3600 : HTX_INTERVAL;

        upsertContractMetadata({ exchange: 'htx', contract: symbol }).catch(() => {});

        return toExchangeResult({
          exchange: 'htx',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: intervalSeconds,
          fundingIntervalSource: c.settlement_period ? 'api' : 'default',
          fundingNextApply: nextFunding,
          markPrice: mark,
          volume24hSettle: vol24,
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
