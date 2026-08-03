import { describe, expect, it } from 'vitest';
import { getExchangeTradeUrl } from '../utils/exchanges';

describe('exchange trade links', () => {
  it('opens normalized CEX symbols', () => {
    expect(getExchangeTradeUrl('binance', 'BTC/USDT')).toContain('/futures/BTCUSDT');
    expect(getExchangeTradeUrl('gate', 'BTC/USDT')).toContain('/futures/USDT/BTC_USDT');
    expect(getExchangeTradeUrl('okx', 'BTC/USDT')).toContain('/trade-futures/BTC-USDT-SWAP');
  });

  it('uses native DEX market formats', () => {
    expect(getExchangeTradeUrl('hyperliquid', 'BTC/USDT')).toContain('/trade/BTC');
    expect(getExchangeTradeUrl('dydx', 'BTC/USDT')).toContain('/markets/BTC-USD');
    expect(getExchangeTradeUrl('drift', 'SOL-PERP')).toContain('/market/SOL-PERP');
    expect(getExchangeTradeUrl('bluefin', 'BTC-PERP')).toContain('/trade/BTC-PERP');
  });
});
