import { ExchangeResult, KNOWN_INTERVALS } from '../types/index.js';
import { mapWithConcurrency, retry, getOrCreateClient, cachedRequest } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { upsertOpenInterest, upsertLongShortRatio } from '../services/marketDataService.js';
import { logger } from '../utils/logger.js';

const OKX_BASE = 'https://www.okx.com';
const MAX_CONCURRENCY = 5;
const OKX_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR; // OKX is always 8h

// Fetch OI for a single symbol (OKX requires per-symbol call)
async function fetchOkxOpenInterest(
  client: ReturnType<typeof getOrCreateClient>,
  symbol: string
): Promise<number> {
  try {
    const res = await retry(() =>
      client.get('/api/v5/public/open-interest', {
        params: { instId: symbol },
        timeout: 10000,
      }),
      2,
      300
    );
    const data = res.data?.data?.[0];
    return data ? parseFloat(data.openInterest) : 0;
  } catch {
    return 0;
  }
}

// Fetch Long/Short ratio for a symbol
async function fetchOkxLongShortRatio(
  client: ReturnType<typeof getOrCreateClient>,
  symbol: string
): Promise<{ longShortRatio: number; longAccountRatio: number; shortAccountRatio: number } | null> {
  try {
    const res = await retry(() =>
      client.get('/api/v5/public/taker-long-short-account-ratio', {
        params: { instId: symbol },
        timeout: 10000,
      }),
      2,
      300
    );
    const data = res.data?.data || [];
    if (data.length === 0) return null;
    const latest = data[0];
    const longAcc = parseFloat(latest.longAccountRatio) || 0;
    const shortAcc = parseFloat(latest.shortAccountRatio) || 0;
    const total = longAcc + shortAcc;
    if (total === 0) return null;
    return {
      longShortRatio: longAcc / total,
      longAccountRatio: longAcc,
      shortAccountRatio: shortAcc,
    };
  } catch {
    return null;
  }
}

export async function scanOKX(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting OKX scan (optimized with normalization)...');

    const client = getOrCreateClient(OKX_BASE, 30000);

    // Use cached instruments
    const [instruments, tickers] = await Promise.all([
      cachedRequest(
        'okx:instruments:swap',
        async () => {
          const res = await retry(() =>
            client.get('/api/v5/public/instruments', {
              params: { instType: 'SWAP' },
            })
          );
          return res.data.data || [];
        },
        300_000 // Cache for 5 minutes
      ),
      cachedRequest(
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
      ),
    ]);

    logger.info(`OKX: Found ${instruments.length} SWAP instruments`);

    const tickerMap = new Map<string, any>();
    for (const t of tickers) {
      tickerMap.set(t.instId, t);
    }

    const usdtInstruments = instruments
      .filter((i: any) => i.instId && (i.instId.includes('-USDT-') || i.instId.includes('-USDC-')) && i.state === 'live')
      .sort((a: any, b: any) => Number(tickerMap.get(b.instId)?.volCcy24h || 0) - Number(tickerMap.get(a.instId)?.volCcy24h || 0));

    logger.info(`OKX: Processing ${usdtInstruments.length} USDT instruments`);

    const results = await mapWithConcurrency(
      usdtInstruments,
      { concurrency: MAX_CONCURRENCY, delayMs: 25 },
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

          // Tickers do not include funding fields. Use the documented public
          // funding endpoint and cache each instrument briefly.
          const funding = await cachedRequest(
            `okx:funding:${symbol}`,
            async () => {
              const res = await retry(
                () => client.get('/api/v5/public/funding-rate', { params: { instId: symbol }, timeout: 8000 }),
                2,
                200
              );
              return res.data?.data?.[0] || null;
            },
            120_000
          );
          const currentFunding = parseFloat(funding?.fundingRate) || 0;
          const nextRaw = funding?.nextFundingTime || funding?.fundingTime;
          const nextFundingTime = nextRaw ? (Number(nextRaw) > 0 && Number(nextRaw) < 1e12 ? Number(nextRaw) * 1000 : Number(nextRaw)) || new Date(nextRaw).getTime() || 0 : 0;

          const mark = parseFloat(ticker.last) || 0;
          const vol24 = parseFloat(ticker.volCcy24h) || parseFloat(ticker.vol24h) || 0;

          return toExchangeResult({
            exchange: 'okx',
            contract: symbol,
            currentFunding,
            fundingIntervalSeconds: OKX_INTERVAL,
            fundingIntervalSource: 'default',
            fundingNextApply: nextFundingTime,
            markPrice: mark,
            volume24hSettle: vol24,
          });
        } catch (err) {
          logger.debug(`OKX: Error processing ${symbol} — ${(err as Error).message}`);
          return null;
        }
      }
    );

    const valid = results.filter((r): r is ExchangeResult => r !== null);
    logger.info(`OKX scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err: any) {
    logger.error(`Error scanning OKX: ${err.message}`);
    return [];
  }
}
