import { ExchangeResult, KNOWN_INTERVALS } from '../types/index.js';
import { retry, getOrCreateClient, cachedRequest, safeParseFloat, toMs } from '../utils/exchangeClient.js';
import { normalizeFundingRate } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const MEXC_BASE = 'https://contract.mexc.com';
const MEXC_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR; // MEXC is always 8h

function deriveNextFunding(): number {
  const intervalMs = MEXC_INTERVAL * 1000;
  const now = Date.now();
  return Math.ceil(now / intervalMs) * intervalMs;
}

export async function scanMEXC(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting MEXC scan (optimized with normalization)...');

    const client = getOrCreateClient(MEXC_BASE, 20000);

    const [tickersRes, contractsRes] = await Promise.all([
      cachedRequest(
        'mexc:tickers',
        async () => {
          const r = await retry(() => client.get('/api/v1/contract/ticker'));
          return r.data?.data || [];
        },
        60_000
      ),
      cachedRequest(
        'mexc:contracts',
        async () => {
          const r = await retry(() => client.get('/api/v1/contract/detail'));
          return r.data?.data || [];
        },
        5 * 60 * 1000
      ),
    ]);

    logger.info(`MEXC: Found ${tickersRes.length} tickers, ${contractsRes.length} contracts`);

    const contractMap = new Map<string, any>();
    for (const c of contractsRes) {
      if (c && c.symbol) contractMap.set(c.symbol, c);
    }

    const candidates = (tickersRes as any[]).filter(
      (t: any) =>
        t &&
        t.symbol &&
        (t.symbol.includes('USDT') || t.symbol.includes('USDC')) &&
        !t.symbol.includes('1_USDT')
    );

    logger.info(`MEXC: Processing ${candidates.length} USDT/USDC contracts`);

    const results = candidates.map((t: any) => {
      const rawSymbol = t.symbol; // e.g. BTC_USDT
      const displaySymbol = rawSymbol.replace('_', ''); // e.g. BTCUSDT
      const c = contractMap.get(rawSymbol) || {};

      try {
        const currentFunding = safeParseFloat(t.fundingRate);
        const mark = safeParseFloat(t.fairPrice ?? t.lastPrice);
        const vol24 = safeParseFloat(t.amount24 ?? t.volume24);
        const nextFunding = deriveNextFunding();

        if (!isFinite(currentFunding)) return null;

        upsertContractMetadata({
          exchange: 'mexc',
          contract: displaySymbol,
          settleCurrency: c.settleCoin || 'USDT',
          baseCurrency: c.baseCoin,
          quoteCurrency: c.quoteCoin,
          maxLeverage: c.maxLeverage ? parseInt(c.maxLeverage) : undefined,
        }).catch(() => {});

        const normalized = normalizeFundingRate(currentFunding, MEXC_INTERVAL);
        const now = Date.now();
        const timeUntilNext = nextFunding > now ? Math.floor((nextFunding - now) / 1000) : null;

        return {
          exchange: 'mexc',
          contract: displaySymbol,
          currentFunding,
          funding_interval_seconds: MEXC_INTERVAL,
          funding_interval_hours: MEXC_INTERVAL / 3600,
          funding_interval_source: 'default' as const,
          funding_rate_per_hour: normalized.perHour,
          funding_rate_per_day: normalized.perDay,
          annualized_rate: normalized.annualized,
          funding_next_apply: nextFunding,
          time_until_next_funding_seconds: timeUntilNext,
          mark_price: mark,
          volume_24h_settle: vol24,
          med_seconds: MEXC_INTERVAL,
          med_hours: MEXC_INTERVAL / 3600,
        };
      } catch (err) {
        logger.debug(`MEXC: Error ${rawSymbol} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`MEXC scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err: any) {
    logger.error(`Error scanning MEXC: ${err.message}`);
    return [];
  }
}
