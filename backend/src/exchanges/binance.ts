import { ExchangeResult } from '../types/index.js';
import { mapWithConcurrency, retry, getOrCreateClient, cachedRequest } from '../utils/exchangeClient.js';
import { normalizeFundingRate } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';
import { KNOWN_INTERVALS } from '../types/index.js';

const BINANCE_BASE = 'https://fapi.binance.com';
const CONCURRENCY = 8;
const BINANCE_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR; // Binance is always 8h

async function fetchPremiumIndex(client: ReturnType<typeof getOrCreateClient>, symbol: string) {
  const res = await retry(() =>
    client.get('/fapi/v1/premiumIndex', {
      params: { symbol },
      timeout: 15000,
    })
  );
  return res.data || null;
}

async function fetchFundingHistory(client: ReturnType<typeof getOrCreateClient>, symbol: string, limit: number = 5) {
  const res = await retry(() =>
    client.get('/fapi/v1/fundingRate', {
      params: { symbol, limit },
      timeout: 15000,
    })
  );
  return res.data || [];
}

async function fetchExchangeInfo(client: ReturnType<typeof getOrCreateClient>, symbol: string) {
  const res = await retry(() =>
    client.get('/fapi/v1/exchangeInfo', { timeout: 15000 })
  );
  return res.data || null;
}

export async function scanBinance(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting Binance scan (optimized with normalization)...');

    const client = getOrCreateClient(BINANCE_BASE, 30000);

    // Use cached tickers
    const tickersAll = await cachedRequest(
      'binance:tickers:24hr',
      async () => {
        const res = await retry(() => client.get('/fapi/v1/ticker/24hr'));
        return res.data || [];
      },
      60_000
    );

    logger.info(`Binance: Found ${tickersAll.length} tickers total`);

    const usdtTickers = tickersAll.filter(
      (t: any) => t && t.symbol && (t.symbol.endsWith('USDT') || t.symbol.endsWith('BUSD'))
    );
    logger.info(`Binance: Processing ${usdtTickers.length} USDT/BUSD pairs`);

    // Fetch exchange info once for metadata
    let exchangeInfo: any = null;
    try {
      exchangeInfo = await cachedRequest('binance:exchangeInfo', async () => {
        return fetchExchangeInfo(client, '');
      }, 3600_000); // Cache for 1 hour
    } catch (err) {
      logger.debug(`Binance: Failed to fetch exchange info: ${(err as Error).message}`);
    }

    const processed = await mapWithConcurrency(usdtTickers, { concurrency: CONCURRENCY }, async (t: any) => {
      try {
        const symbol = t.symbol;
        const vol24 = parseFloat(t.quoteVolume || t.volume || 0) || 0;
        const mark = parseFloat(t.lastPrice || t.last || 0) || 0;

        let currentFunding = 0;
        let funding_next_apply = 0;

        // Try premiumIndex first (faster)
        try {
          const prem = await fetchPremiumIndex(client, symbol);
          if (prem && prem.lastFundingRate !== undefined && prem.lastFundingRate !== null) {
            currentFunding = parseFloat(prem.lastFundingRate) || 0;
            funding_next_apply = Number(prem.nextFundingTime) || 0;
          }
        } catch (err) {
          // Fallback to funding history
          try {
            const histRaw = await fetchFundingHistory(client, symbol, 5);
            if (Array.isArray(histRaw) && histRaw.length) {
              const last = histRaw[histRaw.length - 1];
              currentFunding = parseFloat(last?.fundingRate) || 0;
              funding_next_apply = Number(last?.fundingTime) || 0;
            }
          } catch (err2) {
            logger.debug(`Binance: Funding history fallback failed for ${symbol}: ${(err2 as Error).message}`);
          }
        }

        if (!isFinite(currentFunding)) currentFunding = 0;
        if (!isFinite(funding_next_apply)) funding_next_apply = 0;

        // Normalize to hourly basis (Binance is always 8h)
        const normalized = normalizeFundingRate(currentFunding, BINANCE_INTERVAL);

        // Calculate time until next funding
        const now = Date.now();
        const timeUntilNext = funding_next_apply > now ? Math.floor((funding_next_apply - now) / 1000) : null;

        // Auto-fetch metadata if exchange info available
        if (exchangeInfo?.symbols) {
          const symbolInfo = exchangeInfo.symbols.find((s: any) => s.symbol === symbol);
          if (symbolInfo) {
            upsertContractMetadata({
              exchange: 'binance',
              contract: symbol,
              settleCurrency: symbolInfo.marginAsset || 'USDT',
              baseCurrency: symbolInfo.baseAsset,
              quoteCurrency: symbolInfo.quoteAsset,
              tickSize: parseFloat(symbolInfo.filters?.find((f: any) => f.filterType === 'PRICE_FILTER')?.tickSize),
              minQty: parseFloat(symbolInfo.filters?.find((f: any) => f.filterType === 'LOT_SIZE')?.minQty),
              maxLeverage: symbolInfo.maxLeverage ? parseInt(symbolInfo.maxLeverage) : undefined,
            }).catch(() => {});
          }
        }

        return {
          exchange: 'binance',
          contract: symbol,
          currentFunding,
          funding_interval_seconds: BINANCE_INTERVAL,
          funding_interval_hours: BINANCE_INTERVAL / 3600,
          funding_interval_source: 'default' as const,
          funding_rate_per_hour: normalized.perHour,
          funding_rate_per_day: normalized.perDay,
          annualized_rate: normalized.annualized,
          funding_next_apply,
          time_until_next_funding_seconds: timeUntilNext,
          mark_price: mark,
          volume_24h_settle: vol24,
          // Legacy fields
          med_seconds: BINANCE_INTERVAL,
          med_hours: BINANCE_INTERVAL / 3600,
        };
      } catch (err) {
        logger.debug(`Binance: Error processing ${t.symbol} - ${(err as Error).message}`);
        return null;
      }
    });

    const valid = processed.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`Binance scan completed: ${valid.length} results`);
    return valid;
  } catch (error) {
    logger.error(`Error scanning Binance: ${(error as Error).message}`);
    return [];
  }
}
