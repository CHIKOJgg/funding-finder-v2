import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { mapWithConcurrency, retry, getOrCreateClient, cachedRequest, safeParseFloat } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const APEX_BASE = 'https://omni.apex.exchange/api/v3';
const CONCURRENCY = 3;
const APEX_INTERVAL = KNOWN_INTERVALS.HOURLY; // 1h fixed

function deriveNextHourly(): number {
  const now = Date.now();
  const hourMs = 3600 * 1000;
  return Math.ceil(now / hourMs) * hourMs;
}

export async function scanApex(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting ApeX Omni scan...');
    const client = getOrCreateClient(APEX_BASE, 30000);

    const symbols = await cachedRequest(
      'apex:symbols',
      async () => {
        const res = await retry(() => client.get('/symbols'));
        // Defensive: the endpoint has returned both `{ data: [...] }` and a bare
        // array across versions. Normalise to an array so the later `.filter`
        // can never throw ("symbols.filter is not a function").
        const raw = (res?.data?.data ?? res?.data) as unknown;
        return Array.isArray(raw) ? raw : [];
      },
      6 * 60 * 60 * 1000
    );

    const candidates = (symbols as any[])
      .filter((s) => s && s.symbol && s.symbol.endsWith('USDT') && s.contractType === 'PERPETUAL')
      .slice(0, 250);
    logger.info(`ApeX: Processing ${candidates.length} perp symbols`);

    const results = await mapWithConcurrency(candidates, { concurrency: CONCURRENCY }, async (s: any) => {
      const symbol = s.symbol; // BTCUSDT
      try {
        const tk = await retry(() => client.get('/ticker', { params: { symbol }, timeout: 10000 }));
        const t = Array.isArray(tk.data?.data) ? tk.data.data[0] : tk.data?.data;
        if (!t) return null;

        const currentFunding = safeParseFloat(t.fundingRate);
        const mark = safeParseFloat(t.markPrice);
        const vol24 = safeParseFloat(t.turnover24h) || safeParseFloat(t.volume24h);
        const nextFunding = deriveNextHourly();

        upsertContractMetadata({ exchange: 'apex', contract: symbol }).catch(() => {});

        return toExchangeResult({
          exchange: 'apex',
          contract: symbol,
          currentFunding,
          fundingIntervalSeconds: APEX_INTERVAL,
          fundingIntervalSource: 'default',
          fundingNextApply: nextFunding,
          markPrice: mark,
          volume24hSettle: vol24,
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
