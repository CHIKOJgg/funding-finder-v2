import { ExchangeResult, KNOWN_INTERVALS } from '../types/index.js';
import { mapWithConcurrency, retry, getOrCreateClient, cachedRequest, sleep } from '../utils/exchangeClient.js';
import { normalizeFundingRate } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const OKX_BASE = 'https://www.okx.com';
const MAX_CONCURRENCY = 6;
const OKX_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR; // OKX is always 8h

export async function scanOKX(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting OKX scan (optimized with normalization)...');

    const client = getOrCreateClient(OKX_BASE, 30000);

    // Use cached instruments
    const instruments = await cachedRequest(
      'okx:instruments:swap',
      async () => {
        const res = await retry(() =>
          client.get('/api/v5/public/instruments', {
            params: { instType: 'SWAP' },
          })
        );
        return res.data.data || [];
      },
      300_000  // Cache for 5 minutes (instruments rarely change)
    );

    logger.info(`OKX: Found ${instruments.length} SWAP instruments`);

    const usdtInstruments = instruments.filter(
      (i: any) => i.instId && i.instId.includes('-USDT-') && i.state === 'live'
    );
    logger.info(`OKX: Processing ${usdtInstruments.length} USDT instruments`);

    // Use cached tickers
    const tickers = await cachedRequest(
      'okx:tickers:swap',
      async () => {
        const res = await retry(() =>
          client.get('/api/v5/market/tickers', {
            params: { instType: 'SWAP' },
          })
        );
        return res.data.data || [];
      },
      60_000
    );

    const tickerMap = new Map<string, any>();
    for (const t of tickers) {
      tickerMap.set(t.instId, t);
    }

    const results = await mapWithConcurrency(
      usdtInstruments,
      { concurrency: MAX_CONCURRENCY },
      async (instr: any) => {
        const symbol = instr.instId;
        try {
          const ticker = tickerMap.get(symbol);
          if (!ticker) return null;

          // Upsert contract metadata from instrument data
          upsertContractMetadata({
            exchange: 'okx',
            contract: symbol,
            settleCurrency: instr.settleCcy || 'USDT',
            baseCurrency: instr.baseCcy,
            quoteCurrency: instr.quoteCcy,
            tickSize: parseFloat(instr.tickSz),
            minQty: parseFloat(instr.minSz),
            maxLeverage: instr.lever ? parseInt(instr.lever) : undefined,
          }).catch(() => {});

          const fundingRes = await retry(() =>
            client.get('/api/v5/public/funding-rate', {
              params: { instId: symbol },
              timeout: 15000,
            })
          );

          const fr = fundingRes.data.data?.[0];
          const currentFunding = parseFloat(fr?.fundingRate) || 0;
          const nextFundingTime = fr?.fundingTime
            ? new Date(fr.fundingTime).getTime()
            : 0;

          const mark = parseFloat(ticker.last) || 0;
          const vol24 = parseFloat(ticker.volCcy24h) || parseFloat(ticker.vol24h) || 0;

          // OKX is always 8h
          const normalized = normalizeFundingRate(currentFunding, OKX_INTERVAL);

          // Calculate time until next funding
          const now = Date.now();
          const timeUntilNext = nextFundingTime > now ? Math.floor((nextFundingTime - now) / 1000) : null;

          return {
            exchange: 'okx',
            contract: symbol,
            currentFunding,
            funding_interval_seconds: OKX_INTERVAL,
            funding_interval_hours: OKX_INTERVAL / 3600,
            funding_interval_source: 'default' as const,
            funding_rate_per_hour: normalized.perHour,
            funding_rate_per_day: normalized.perDay,
            annualized_rate: normalized.annualized,
            funding_next_apply: nextFundingTime,
            time_until_next_funding_seconds: timeUntilNext,
            mark_price: mark,
            volume_24h_settle: vol24,
            // Legacy fields
            med_seconds: OKX_INTERVAL,
            med_hours: OKX_INTERVAL / 3600,
          };
        } catch (err) {
          logger.debug(`OKX: Error processing ${symbol} — ${(err as Error).message}`);
          return null;
        } finally {
          await sleep(40);
        }
      }
    );

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`OKX scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err: any) {
    logger.error(`Error scanning OKX: ${err.message}`);
    return [];
  }
}
