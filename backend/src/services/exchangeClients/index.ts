import type { ExchangeAdapter } from './types.js';
import { binanceAdapter } from './binance.js';
import { bybitAdapter } from './bybit.js';
import { okxAdapter } from './okx.js';
import { gateAdapter } from './gate.js';
import { mexcAdapter } from './mexc.js';
import { bitgetAdapter } from './bitget.js';
import { phemexAdapter } from './phemex.js';
import { htxAdapter } from './htx.js';
import { hyperliquidAdapter } from './hyperliquid.js';
import { bingxAdapter } from './bingx.js';

const REGISTRY: Record<string, ExchangeAdapter> = {
  binance: binanceAdapter,
  bybit: bybitAdapter,
  okx: okxAdapter,
  gate: gateAdapter,
  mexc: mexcAdapter,
  bitget: bitgetAdapter,
  phemex: phemexAdapter,
  htx: htxAdapter,
  hyperliquid: hyperliquidAdapter,
  bingx: bingxAdapter,
};

export function getAdapter(exchange: string): ExchangeAdapter {
  const adapter = REGISTRY[exchange.toLowerCase()];
  if (!adapter) {
    throw new Error(`Биржа "${exchange}" пока не поддерживается для подключения по API`);
  }
  return adapter;
}

export function supportedExchanges(): string[] {
  return Object.keys(REGISTRY);
}

export type { ExchangeAdapter } from './types.js';
