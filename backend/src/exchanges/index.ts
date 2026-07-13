import { ExchangeResult } from '../types/index.js';
import { scanGate } from './gate.js';
import { scanBinance } from './binance.js';
import { scanBybit } from './bybit.js';
import { scanMEXC } from './mexc.js';
import { scanOKX } from './okx.js';
import { scanBitget } from './bitget.js';
import { scanBingX } from './bingx.js';
import { scanPhemex } from './phemex.js';
import { scanWOO } from './woo.js';
import { scanHyperliquid } from './hyperliquid.js';
import { scanDydx } from './dydx.js';
import { scanParadex } from './paradex.js';
// Phase-2 additions
import { scanHtx } from './htx.js';
import { scanCoinEx } from './coinex.js';
import { scanBloFin } from './blofin.js';
import { scanBitMart } from './bitmart.js';
import { scanWeex } from './weex.js';
import { scanCoinW } from './coinw.js';
import { scanDrift } from './drift.js';
import { scanHelix } from './helix.js';
import { scanApex } from './apex.js';
import { scanAster } from './aster.js';
import { scanBluefin } from './bluefin.js';
import { sleep, circuitBreaker, cleanupConnections } from '../utils/exchangeClient.js';
import { logger } from '../utils/logger.js';

const EXCHANGE_SCANNERS: Record<string, () => Promise<ExchangeResult[]>> = {
  gate: scanGate,
  binance: scanBinance,
  bybit: scanBybit,
  mexc: scanMEXC,
  okx: scanOKX,
  // CEX additions (batch 1)
  bitget: scanBitget,
  bingx: scanBingX,
  phemex: scanPhemex,
  woo: scanWOO,
  // DEX additions (batch 1)
  hyperliquid: scanHyperliquid,
  dydx: scanDydx,
  paradex: scanParadex,
  // CEX additions (batch 2)
  htx: scanHtx,
  coinex: scanCoinEx,
  blofin: scanBloFin,
  bitmart: scanBitMart,
  weex: scanWeex,
  coinw: scanCoinW,
  // DEX additions (batch 2)
  drift: scanDrift,
  helix: scanHelix,
  apex: scanApex,
  aster: scanAster,
  bluefin: scanBluefin,
};

/** Single source of truth for every supported exchange id. */
export const SUPPORTED_EXCHANGES = Object.keys(EXCHANGE_SCANNERS);

/**
 * Scan multiple exchanges in parallel with circuit breaker protection.
 * 
 * Improvements:
 * - Parallel scanning (2-3 exchanges at a time to avoid rate limits)
 * - Circuit breaker to skip failing exchanges
 * - Graceful degradation on errors
 */
export async function scanExchanges(exchanges: string[]): Promise<ExchangeResult[]> {
  const allResults: ExchangeResult[] = [];
  const BATCH_SIZE = 3; // Scan 3 exchanges in parallel

  // Split exchanges into batches
  const batches: string[][] = [];
  for (let i = 0; i < exchanges.length; i += BATCH_SIZE) {
    batches.push(exchanges.slice(i, i + BATCH_SIZE));
  }

  logger.info(`Scanning ${exchanges.length} exchanges in ${batches.length} batches`);

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const batchResults = await Promise.allSettled(
      batch.map(async (exchange) => {
        const scanner = EXCHANGE_SCANNERS[exchange];
        if (!scanner) {
          logger.warn(`Unknown exchange: ${exchange}`);
          return [];
        }

        try {
          return await circuitBreaker.execute(exchange, scanner);
        } catch (err) {
          logger.error(`Circuit breaker triggered for ${exchange}: ${(err as Error).message}`);
          return [];
        }
      })
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        allResults.push(...result.value);
      }
    }

    // Small delay between batches
    if (batchIndex < batches.length - 1) {
      await sleep(500);
    }
  }

  logger.info(`Total results from all exchanges: ${allResults.length}`);
  return allResults;
}

/**
 * Scan a single exchange (for testing/debugging)
 */
export async function scanSingleExchange(exchange: string): Promise<ExchangeResult[]> {
  const scanner = EXCHANGE_SCANNERS[exchange];
  if (!scanner) {
    throw new Error(`Unknown exchange: ${exchange}`);
  }
  return circuitBreaker.execute(exchange, scanner);
}

/**
 * Get list of supported exchanges
 */
export function getSupportedExchanges(): string[] {
  return Object.keys(EXCHANGE_SCANNERS);
}

/**
 * Cleanup all connections and caches
 */
export function cleanup(): void {
  cleanupConnections();
  logger.info('Cleaned up all exchange connections');
}

export { scanGate, scanBinance, scanBybit, scanMEXC, scanOKX, scanBitget, scanBingX, scanPhemex, scanWOO, scanHyperliquid, scanDydx, scanParadex, scanHtx, scanCoinEx, scanBloFin, scanBitMart, scanWeex, scanCoinW, scanDrift, scanHelix, scanApex, scanAster, scanBluefin };
