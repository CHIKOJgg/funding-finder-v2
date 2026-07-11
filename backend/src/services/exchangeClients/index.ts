import type { ExchangeAdapter } from './types.js';
import { binanceAdapter } from './binance.js';
import { bybitAdapter } from './bybit.js';
import { okxAdapter } from './okx.js';
import { gateAdapter } from './gate.js';
import { mexcAdapter } from './mexc.js';

const REGISTRY: Record<string, ExchangeAdapter> = {
  binance: binanceAdapter,
  bybit: bybitAdapter,
  okx: okxAdapter,
  gate: gateAdapter,
  mexc: mexcAdapter,
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
