// Maps our internal exchange ids to human-friendly labels and to the
// exchange's perpetual-futures trading page for a given pair, so users can go
// from "found an opportunity" straight to "open the position".

export const EXCHANGE_LABELS: Record<string, string> = {
  gate: 'Gate.io',
  binance: 'Binance',
  bybit: 'Bybit',
  mexc: 'MEXC',
  okx: 'OKX',
};

// Our pairs are normalized to e.g. "BTCUSDT". OKX and Gate use their own
// instrument naming, so strip the USDT quote and rebuild the symbol.
function baseOf(pair: string): string {
  return pair.replace(/USDT$/i, '');
}

export function getExchangeTradeUrl(exchange: string, pair: string): string {
  const base = baseOf(pair);
  switch (exchange.toLowerCase()) {
    case 'binance':
      return `https://www.binance.com/en/futures/${pair}`;
    case 'bybit':
      return `https://www.bybit.com/en/trade/usdt/${pair}`;
    case 'okx':
      return `https://www.okx.com/trade-futures/${base}-USDT-SWAP`;
    case 'gate':
      return `https://www.gate.io/futures/USDT/${base}_USDT`;
    case 'mexc':
      return `https://futures.mexc.com/exchange/${pair}`;
    default:
      return '#';
  }
}

// Open an exchange trading page. Inside Telegram we must use the native
// openLink so the link opens in an external browser instead of being blocked.
export function openExchange(exchange: string, pair: string): void {
  const url = getExchangeTradeUrl(exchange, pair);
  const tg = (window as any).Telegram?.WebApp;
  if (tg?.openLink) {
    tg.openLink(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export function exchangeLabel(exchange: string): string {
  return EXCHANGE_LABELS[exchange.toLowerCase()] || exchange;
}
