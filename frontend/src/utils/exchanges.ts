// Maps our internal exchange ids to human-friendly labels and to the
// exchange's perpetual-futures trading page for a given pair, so users can go
// from "found an opportunity" straight to "open the position".

export const EXCHANGE_LABELS: Record<string, string> = {
  gate: 'Gate.io',
  binance: 'Binance',
  bybit: 'Bybit',
  mexc: 'MEXC',
  okx: 'OKX',
  bitget: 'Bitget',
  bingx: 'BingX',
  phemex: 'Phemex',
  woo: 'WOO X',
  hyperliquid: 'Hyperliquid',
  dydx: 'dYdX',
  paradex: 'Paradex',
  htx: 'HTX',
  coinex: 'CoinEx',
  blofin: 'BloFin',
  bitmart: 'BitMart',
  weex: 'WEEX',
  coinw: 'CoinW',
  drift: 'Drift',
  helix: 'Helix',
  apex: 'ApeX',
  aster: 'Aster',
  bluefin: 'Bluefin',
};

/** Single source of truth — must match backend SUPPORTED_EXCHANGES. */
export const ALL_EXCHANGES = [
  'gate', 'binance', 'bybit', 'mexc', 'okx',
  'bitget', 'bingx', 'phemex', 'woo',
  'hyperliquid', 'dydx', 'paradex',
  'htx', 'coinex', 'blofin', 'bitmart', 'weex', 'coinw',
  'drift', 'helix', 'apex', 'aster', 'bluefin',
];

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
    case 'bitget':
      return pair ? `https://www.bitget.com/futures/usdt/${pair}` : 'https://www.bitget.com/futures/usdt';
    case 'bingx':
      return pair ? `https://www.bingx.com/futures/${pair}` : 'https://www.bingx.com/futures';
    case 'phemex':
      return pair ? `https://www.phemex.com/futures/${pair}` : 'https://www.phemex.com/futures';
    case 'woo':
      return pair ? `https://app.woox.io/markets/${pair}` : 'https://app.woox.io/markets';
    case 'hyperliquid':
      return pair ? `https://hyperliquid.xyz/trade/${pair}` : 'https://hyperliquid.xyz/trade';
    case 'dydx':
      return pair ? `https://dydx.trade/markets/${pair}` : 'https://dydx.trade/markets';
    case 'paradex':
      return pair ? `https://paradex.io/trade/${pair}` : 'https://paradex.io/trade';
    case 'htx':
      return pair ? `https://www.htx.com/en-us/futures/USDT/${pair}` : 'https://www.htx.com/en-us/futures';
    case 'coinex':
      return pair ? `https://www.coinex.com/futures/${pair}` : 'https://www.coinex.com/futures';
    case 'blofin':
      return pair ? `https://blofin.com/futures/${pair}` : 'https://blofin.com/futures';
    case 'bitmart':
      return pair ? `https://www.bitmart.com/contract/${pair}` : 'https://www.bitmart.com/contract';
    case 'weex':
      return pair ? `https://www.weex.com/futures/${pair}` : 'https://www.weex.com/futures';
    case 'coinw':
      return pair ? `https://www.coinw.com/futures/${pair}` : 'https://www.coinw.com/futures';
    case 'drift':
      return pair ? `https://drift.trade/market/${pair}` : 'https://drift.trade';
    case 'helix':
      return pair ? `https://helixapp.com/trade/${pair}` : 'https://helixapp.com/trade';
    case 'apex':
      return pair ? `https://pro.apex.exchange/market/${pair}` : 'https://pro.apex.exchange';
    case 'aster':
      return pair ? `https://www.asterdex.com/futures/${pair}` : 'https://www.asterdex.com/futures';
    case 'bluefin':
      return pair ? `https://bluefin.io/trade/${pair}` : 'https://bluefin.io/trade';
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
