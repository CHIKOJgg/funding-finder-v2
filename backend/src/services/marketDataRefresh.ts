import { SUPPORTED_EXCHANGES } from '../exchanges/index.js';
import { logger } from '../utils/logger.js';
import { prisma } from './prisma.js';
import { upsertOpenInterest } from './marketDataService.js';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let isRefreshing = false;

// Binance: batch endpoint with OI data in ticker
async function refreshBinanceOI(): Promise<void> {
  try {
    const { getOrCreateClient, retry } = await import('../utils/exchangeClient.js');
    const client = getOrCreateClient('https://fapi.binance.com', 30000);
    const tickers = await retry(() =>
      client.get('/fapi/v1/ticker/24hr', { timeout: 15000 }),
      2,
      500
    ).then((r: any) => r.data || []);

    for (const t of tickers) {
      if (t.symbol && t.symbol.endsWith('USDT') && t.openInterest) {
        const oi = parseFloat(t.openInterest) || 0;
        if (oi > 0) {
          await upsertOpenInterest('binance', t.symbol, oi);
        }
      }
    }
    logger.debug(`Binance OI refresh: ${tickers.length} tickers checked`);
  } catch (err) {
    logger.debug(`Binance OI refresh error: ${(err as Error).message}`);
  }
}

// OKX: batch OI for top symbols
async function refreshOkxOI(): Promise<void> {
  try {
    const { getOrCreateClient, retry } = await import('../utils/exchangeClient.js');
    const client = getOrCreateClient('https://www.okx.com', 30000);
    const instruments = await retry(() =>
      client.get('/api/v5/public/instruments', {
        params: { instType: 'SWAP', state: 'live' },
        timeout: 15000,
      }),
      2,
      500
    ).then((r: any) => r.data?.data || []);

    const usdtInstruments = instruments
      .filter((inst: any) => inst.instId?.includes('-USDT-'))
      .slice(0, 100);

    for (const inst of usdtInstruments) {
      try {
        const oiRes = await retry(() =>
          client.get('/api/v5/public/open-interest', {
            params: { instId: inst.instId },
            timeout: 10000,
          }),
          2,
          300
        ).then((r: any) => r.data?.data?.[0]);
        if (oiRes?.openInterest) {
          const oiVal = parseFloat(oiRes.openInterest) || 0;
          if (oiVal > 0) {
            await upsertOpenInterest('okx', inst.instId, oiVal);
          }
        }
      } catch { /* skip individual */ }
    }
    logger.debug(`OKX OI refresh: ${usdtInstruments.length} instruments checked`);
  } catch (err) {
    logger.debug(`OKX OI refresh error: ${(err as Error).message}`);
  }
}

export function startMarketDataRefresh(): void {
  if (refreshTimer) {
    logger.warn('Market data refresh already running');
    return;
  }
  logger.info('Starting market data refresh (OI/LSR collection)');
  refreshTimer = setInterval(async () => {
    if (isRefreshing) return;
    try {
      isRefreshing = true;
      await refreshBinanceOI();
      await refreshOkxOI();
    } catch (err) {
      logger.error({ err }, 'Market data refresh cycle failed');
    } finally {
      isRefreshing = false;
    }
  }, REFRESH_INTERVAL_MS);
}

export function stopMarketDataRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
    logger.info('Market data refresh stopped');
  }
}