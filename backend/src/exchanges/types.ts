import { ExchangeResult } from '../types/index.js';

export interface ExchangeScanner {
  name: string;
  scan(): Promise<ExchangeResult[]>;
}

export const EXCHANGE_MAP: Record<string, () => Promise<ExchangeResult[]>> = {};

export function registerExchange(name: string, scanner: () => Promise<ExchangeResult[]>): void {
  EXCHANGE_MAP[name] = scanner;
}
