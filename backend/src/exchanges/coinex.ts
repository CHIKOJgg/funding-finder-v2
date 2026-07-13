import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { retry, getOrCreateClient, cachedRequest, safeParseFloat } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const COINEX_BASE = 'https://api.coinex.com/v2';
const COINEX_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR; // dynamic, default 8h (not an API field)

export async function scanCoinEx(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting CoinEx scan...');
    const client = getOrCreateClient(COINEX_BASE, 30000);

    const [fundingAll, tickerAll, marketAll] = await Promise.all([
      cachedRequest('coinex:funding', async () => {
        const res = await retry(() => client.get('/futures/funding-rate'));
        return res.data?.data || [];
      }, 60_000),
      cachedRequest('coinex:tickers', async () => {
        const res = await retry(() => client.get('/futures/ticker'));
        return res.data?.data || [];
      }, 60_000),
      cachedRequest('coinex:market', async () => {
        const res = await retry(() => client.get('/futures/market'));
        return res.data?.data || [];
      }, 6 * 60 * 60 * 1000),
    ]);

    const fundingMap = new Map<string, any>();
    for (const f of fundingAll as any[]) fundingMap.set(f.market, f);
    const tickerMap = new Map<string, any>();
    for (const t of tickerAll as any[]) tickerMap.set(t.market, t);

    const candidates = (marketAll as any[])
      .filter((m) => m && m.market && m.market.endsWith('USDT') && m.contract_type === 'perpetual')
      .sort((a, b) => Number(tickerMap.get(b.market)?.value || 0) - Number(tickerMap.get(a.market)?.value || 0))
      .slice(0, 250);
    logger.info(`CoinEx: Processing ${candidates.length} perp markets`);

    const results = (candidates as any[]).map((m: any) => {
      const symbol = m.market; // BTCUSDT
      try {
        const f = fundingMap.get(symbol);
        const t = tickerMap.get(symbol);
        if (!f) return null;

        const currentFunding = safeParseFloat(f.latest_funding_rate);
        const nextFunding = Number(f.next_funding_time) || 0;
        const mark = safeParseFloat(f.mark_price) || safeParseFloat(t?.last);
        const vol24 = safeParseFloat(t?.value);

        upsertContractMetadata({ exchange: 'coinex', contract: symbol }).catch(() => {});

        return toExchangeResult({
          exchange: 'coinex',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: COINEX_INTERVAL,
          fundingIntervalSource: 'default',
          fundingNextApply: nextFunding,
          markPrice: mark,
          volume24hSettle: vol24,
        });
      } catch (err) {
        logger.debug(`CoinEx: Error ${symbol} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`CoinEx scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err) {
    logger.error(`Error scanning CoinEx: ${(err as Error).message}`);
    return [];
  }
}
