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

    const symbolsData = await cachedRequest(
      'apex:v1:symbols',
      async () => {
        const res = await retry(() => client.get('/api/v1/symbols'));
        return res.data?.data || {};
      },
      5 * 60 * 1000
    );

    const contracts: any[] = symbolsData.perpetualContract || symbolsData.contractConfig?.perpetualContract || [];
    const candidates = contracts.filter((c) => c && c.enableTrade && (c.symbol || c.crossSymbolName));

    logger.info(`ApeX: Processing ${candidates.length} perp symbols`);

    const results = candidates.map((c: any) => {
      const symbol = (c.symbolDisplayName || c.symbol || c.crossSymbolName || '').replace('-', '');
      try {
        const currentFunding = safeParseFloat(c.fundingInterestRate ?? c.fundingRate ?? c.predictedFundingRate);
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
          fundingNextApply: 0,
          markPrice: 0,
          volume24hSettle: 0,
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
