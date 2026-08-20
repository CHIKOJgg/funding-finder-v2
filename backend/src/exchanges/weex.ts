import { ExchangeResult } from '../types/index.js';
import { KNOWN_INTERVALS } from '../types/index.js';
import { retry, getOrCreateClient, cachedRequest, safeParseFloat, toMs } from '../utils/exchangeClient.js';
import { toExchangeResult } from '../utils/helpers.js';
import { upsertContractMetadata } from '../services/contractMetadata.js';
import { logger } from '../utils/logger.js';

const WEEX_BASE = 'https://api-contract.weex.com';
const WEEX_INTERVAL = KNOWN_INTERVALS.EIGHT_HOUR; // typical 8h

export async function scanWeex(): Promise<ExchangeResult[]> {
  try {
    logger.info('Starting WEEX scan...');
    const client = getOrCreateClient(WEEX_BASE, 30000);

    const [contractsRes, fundingRes, tickersRes] = await Promise.all([
      cachedRequest('weex:contracts', async () => {
        const res = await retry(() => client.get('/capi/v2/market/contracts'));
        const raw = res.data?.data || res.data?.result || res.data || [];
        return Array.isArray(raw) ? raw : [];
      }, 6 * 60 * 60 * 1000),
      cachedRequest('weex:funding', async () => {
        const res = await retry(() => client.get('/capi/v2/market/funding_rate'));
        const raw = res.data?.data || res.data?.result || res.data || [];
        return Array.isArray(raw) ? raw : [];
      }, 60_000),
      cachedRequest('weex:tickers', async () => {
        const res = await retry(() => client.get('/capi/v2/market/tickers'));
        const raw = res.data?.data || res.data?.result || res.data || [];
        return Array.isArray(raw) ? raw : [];
      }, 60_000),
    ]);

    const fundingMap = new Map<string, any>();
    for (const f of fundingRes as any[]) {
      if (f.symbol) fundingMap.set(f.symbol.toLowerCase(), f);
      if (f.baseCurrency) fundingMap.set(f.baseCurrency.toLowerCase().replace('_', ''), f);
    }

    const tickerMap = new Map<string, any>();
    for (const t of tickersRes as any[]) {
      if (t.symbol) tickerMap.set(t.symbol.toLowerCase(), t);
    }

    const candidates = (contractsRes as any[])
      .filter((s) => s && s.symbol && s.symbol.toLowerCase().endsWith('usdt'));
    logger.info(`WEEX: Processing ${candidates.length} perp symbols`);

    const results = candidates.map((s: any) => {
      const rawSymbol = String(s.symbol || '');
      const cleanKey = rawSymbol.toLowerCase().replace(/^cmt_/, '');
      const displaySymbol = (s.underlying_index ? `${s.underlying_index}USDT` : rawSymbol.toUpperCase().replace(/^CMT_/, '')).toUpperCase();
      try {
        const fd = fundingMap.get(rawSymbol.toLowerCase()) || fundingMap.get(cleanKey) || fundingMap.get(displaySymbol.toLowerCase());
        const td = tickerMap.get(rawSymbol.toLowerCase()) || tickerMap.get(cleanKey);

        const currentFunding = safeParseFloat(fd?.fundingRate ?? td?.fundingRate ?? 0);
        const nextFunding = toMs(fd?.timestamp) || 0;
        const mark = safeParseFloat(td?.markPrice ?? td?.last ?? s.last_price);
        const vol24 = safeParseFloat(td?.volume_24h ?? td?.base_volume);
        const cycleMinutes = safeParseFloat(fd?.collectCycle, 480);
        const intervalSeconds = cycleMinutes > 0 ? cycleMinutes * 60 : WEEX_INTERVAL;

        upsertContractMetadata({
          exchange: 'weex',
          contract: displaySymbol,
          baseCurrency: s.underlying_index,
          quoteCurrency: s.quote_currency || 'USDT',
        }).catch(() => {});

        return toExchangeResult({
          exchange: 'weex',
          contract: displaySymbol,
          currentFunding,
          fundingIntervalSeconds: intervalSeconds,
          fundingIntervalSource: fd?.collectCycle ? 'api' : 'default',
          fundingNextApply: nextFunding,
          markPrice: mark,
          volume24hSettle: vol24,
        });
      } catch (err) {
        logger.debug(`WEEX: Error ${rawSymbol} — ${(err as Error).message}`);
        return null;
      }
    });

    const valid = results.filter((r) => r !== null) as ExchangeResult[];
    logger.info(`WEEX scan complete: ${valid.length} valid results`);
    return valid;
  } catch (err) {
    logger.error(`Error scanning WEEX: ${(err as Error).message}`);
    return [];
  }
}
