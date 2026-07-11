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

// Normalize any pair representation a caller might pass — "BTCUSDT",
// "btc/usdt", "BTC", "BTC_USDT" — into a clean USDT-perp symbol. This is what
// makes the deep link always point at the coin: a malformed symbol (e.g. with
// a slash, or missing the USDT quote) makes the exchange autoroute to its
// homepage instead of opening the trading pair.
function normalizePerpSymbol(pair: string): string {
  const cleaned = (pair || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return '';
  return cleaned.endsWith('USDT') ? cleaned : `${cleaned}USDT`;
}

export function getExchangeTradeUrl(exchange: string, pair: string): string {
  const symbol = normalizePerpSymbol(pair);
  const base = symbol.replace(/USDT$/i, '');
  // When no specific pair is known (e.g. an exchange-level "open" button) we
  // still land on the exchange's futures section rather than a dead "#" link.
  switch (exchange.toLowerCase()) {
    case 'binance':
      return symbol ? `https://www.binance.com/en/futures/${symbol}` : 'https://www.binance.com/en/futures';
    case 'bybit':
      return symbol ? `https://www.bybit.com/en/trade/usdt/${symbol}` : 'https://www.bybit.com/en/trade/usdt';
    case 'okx':
      return symbol ? `https://www.okx.com/trade-futures/${base}-USDT-SWAP` : 'https://www.okx.com/trade-futures';
    case 'gate':
      return symbol ? `https://www.gate.io/futures/USDT/${base}_USDT` : 'https://www.gate.io/futures/USDT';
    case 'mexc':
      // MEXC requires the underscore form (BTC_USDT); the concatenated form
      // (BTCUSDT) 404s and the exchange autoredirects to its homepage.
      return symbol ? `https://futures.mexc.com/exchange/${base}_USDT` : 'https://futures.mexc.com';
    default:
      return symbol ? `https://www.binance.com/en/futures/${symbol}` : 'https://www.binance.com/en/futures';
  }
}

// Open an exchange trading page. Inside Telegram we must use the native
// openLink so the link opens in an external browser instead of being blocked.
export function openExchange(exchange: string, pair: string): void {
  const url = getExchangeTradeUrl(exchange, pair);
  // Mark that the user took the "open a position" step (used by the
  // first-profit onboarding checklist). No personal data is stored.
  try {
    localStorage.setItem('ff_opened_position', '1');
  } catch { /* storage may be unavailable — non-critical */ }
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
