import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { retry, getOrCreateClient, cachedRequest, safeParseFloat } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const APEX_BASE = 'https://omni.apex.exchange';
const APEX_INTERVAL = KNOWN_INTERVALS.HOURLY; // ApeX is 1h / 8h

export async function scanApex(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting ApeX Omni scan...');
    const client = getOrCreateClient(APEX_BASE, 30000);

    const [symbolsData, tickersData] = await Promise.all([
      cachedRequest(
        'apex:v1:symbols',
        async () => {
          const res = await retry(() => client.get('/api/v1/symbols'));
          return res.data?.data || {};
        },
        5 * 60 * 1000
      ),
      cachedRequest(
        'apex:v3:tickers',
        async () => {
          try {
            const res = await retry(() => client.get('/api/v3/ticker'));
            return res.data?.data || [];
          } catch {
            return [];
          }
        },
        60_000
      ),
    ]);

    const tickerList = Array.isArray(tickersData) ? tickersData : [];
    const tickerMap = new Map<string, any>();
    for (const t of tickerList) {
      if (t && t.symbol) {
        tickerMap.set(t.symbol, t);
        tickerMap.set(t.symbol.replace('-', ''), t);
      }
    }

    const contracts: any[] = symbolsData.perpetualContract || symbolsData.contractConfig?.perpetualContract || [];
    const candidates = contracts.filter((c) => c && c.enableTrade && (c.symbol || c.crossSymbolName));

    logger.info(`ApeX: Processing ${candidates.length} perp symbols`);

    const results = candidates.map((c: any) => {
      const rawSymbol = c.symbolDisplayName || c.symbol || c.crossSymbolName || '';
      const symbol = rawSymbol.replace('-', '');
      try {
        const td = tickerMap.get(symbol) || tickerMap.get(c.symbol) || tickerMap.get(rawSymbol);
        const currentFunding = safeParseFloat(td?.fundingRate ?? c.fundingInterestRate ?? c.fundingRate ?? c.predictedFundingRate);
        const markPrice = safeParseFloat(td?.markPrice ?? td?.lastPrice ?? td?.oraclePrice ?? 0);
        const volume24h = safeParseFloat(td?.turnover24h ?? td?.volume24h ?? 0);
        const nextFunding = safeParseFloat(td?.nextFundingTime ?? 0) || (Date.now() + 3600_000);
        const intervalSeconds = APEX_INTERVAL;

        upsertContractMetadata({
          exchange: 'apex',
          contract: symbol,
          baseCurrency: c.underlyingCurrencyId,
          quoteCurrency: c.settleCurrencyId || 'USDC',
        }).catch(() => {});

        return toExchangeResult({
          exchange: 'apex',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: intervalSeconds,
          fundingIntervalSource: 'default',
          fundingNextApply: nextFunding,
          markPrice: markPrice > 0 ? markPrice : 0,
          volume24hSettle: volume24h > 0 ? volume24h : 20000,
        });
      } catch (err) {
        logger.debug(`ApeX: Error ${symbol} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`ApeX scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err) {
    logger.error(`Error scanning ApeX: ${(err as Error).message}`);
    return [];
  }
}
