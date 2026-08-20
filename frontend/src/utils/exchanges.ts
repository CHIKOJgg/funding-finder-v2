// Maps our internal exchange ids to human-friendly labels and to the
// exchange's perpetual-futures trading page for a given pair, so users can go
// from "found an opportunity" straight to "open the position".

export const EXCHANGE_LABELS: Record<string, string> = {
  gate: 'Gate.io',
  binance: 'Binance',
  bybit: 'Bybit',
  kucoin: 'KuCoin',
  cryptocom: 'Crypto.com',
  deribit: 'Deribit',
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
  kraken: 'Kraken Futures',
  coinbase: 'Coinbase International',
  bitunix: 'Bitunix',
  orderly: 'Orderly Network',
  aevo: 'Aevo',
};

// ---------------------------------------------------------------------------
// Affiliate / referral monetization.
//
// Every "Open on exchange" click is free traffic we send to the exchange —
// so it should carry OUR referral code and earn a commission (a second revenue
// stream that can fund hosting + ads with zero extra work).
//
// Each exchange uses a different referral query param. Fill in `code` with your
// affiliate code from the exchange's partner program to activate revenue.
// An empty code is a safe no-op (URL is left unchanged), so the app behaves
// exactly as before until you plug your codes in.
//
// Codes can also be injected at build time via Vite env vars
// (e.g. VITE_AFF_BINANCE=xxxx) so you don't commit them to git.
interface AffiliateConfig {
  param: string;
  code: string;
}

const env = (import.meta as any).env || {};

export const AFFILIATE: Record<string, AffiliateConfig> = {
  binance: { param: 'ref', code: env.VITE_AFF_BINANCE || '' },
  bybit: { param: 'ref', code: env.VITE_AFF_BYBIT || '' },
  okx: { param: 'channelId', code: env.VITE_AFF_OKX || '' },
  gate: { param: 'ref', code: env.VITE_AFF_GATE || '' },
  mexc: { param: 'inviteCode', code: env.VITE_AFF_MEXC || '' },
  bitget: { param: 'ref', code: env.VITE_AFF_BITGET || '' },
  bingx: { param: 'ref', code: env.VITE_AFF_BINGX || '' },
  phemex: { param: 'referralCode', code: env.VITE_AFF_PHEMEX || '' },
  woo: { param: 'ref', code: env.VITE_AFF_WOO || '' },
  htx: { param: 'invite_code', code: env.VITE_AFF_HTX || '' },
  coinex: { param: 'refer_code', code: env.VITE_AFF_COINEX || '' },
  blofin: { param: 'referral_code', code: env.VITE_AFF_BLOFIN || '' },
  bitmart: { param: 'r', code: env.VITE_AFF_BITMART || '' },
  weex: { param: 'code', code: env.VITE_AFF_WEEX || '' },
  coinw: { param: 'r', code: env.VITE_AFF_COINW || '' },
  hyperliquid: { param: 'ref', code: env.VITE_AFF_HYPERLIQUID || '' },
  dydx: { param: 'ref', code: env.VITE_AFF_DYDX || '' },
  paradex: { param: 'ref', code: env.VITE_AFF_PARADEX || '' },
  drift: { param: 'ref', code: env.VITE_AFF_DRIFT || '' },
  helix: { param: 'ref', code: env.VITE_AFF_HELIX || '' },
  apex: { param: 'ref', code: env.VITE_AFF_APEX || '' },
  aster: { param: 'ref', code: env.VITE_AFF_ASTER || '' },
  bluefin: { param: 'ref', code: env.VITE_AFF_BLUEFIN || '' },
  kucoin: { param: 'ref', code: env.VITE_AFF_KUCOIN || '' },
  cryptocom: { param: 'ref', code: env.VITE_AFF_CRYPTOCOM || '' },
  deribit: { param: 'ref', code: env.VITE_AFF_DERIBIT || '' },
};

/** Append the exchange's affiliate code to a URL, if configured. */
function withAffiliate(exchange: string, url: string): string {
  const aff = AFFILIATE[exchange.toLowerCase()];
  if (!aff || !aff.code) return url;
  try {
    const u = new URL(url);
    u.searchParams.set(aff.param, aff.code);
    return u.toString();
  } catch {
    // Fallback for any non-standard URL: append manually.
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}${encodeURIComponent(aff.param)}=${encodeURIComponent(aff.code)}`;
  }
}

/** Single source of truth — must match backend SUPPORTED_EXCHANGES. */
export const ALL_EXCHANGES = [
  'gate', 'binance', 'bybit', 'kucoin', 'mexc', 'okx',
  'bitget', 'bingx', 'phemex', 'woo', 'hyperliquid', 'dydx',
  'htx', 'blofin', 'aster', 'bluefin', 'kraken', 'coinbase',
  'bitunix', 'orderly', 'aevo', 'apex', 'bitmart', 'coinex',
  'coinw', 'cryptocom', 'deribit', 'drift', 'helix', 'paradex', 'weex',
];

export const FREE_DEFAULT_EXCHANGES = ['binance', 'bybit', 'okx', 'gate'];
export const PRO_DEFAULT_EXCHANGES = [
  'binance', 'bybit', 'okx', 'gate', 'kucoin', 'mexc',
  'bitget', 'bingx', 'phemex', 'woo', 'hyperliquid', 'htx'
];

export function getPlanMaxExchanges(plan: string): number {
  const p = (plan || 'free').toLowerCase();
  if (p === 'proplus' || p === 'promax' || p === 'ultimate' || p === 'admin') return 31;
  if (p === 'pro') return 12;
  return 4;
}

export function getPlanDefaultExchanges(plan: string): string[] {
  const p = (plan || 'free').toLowerCase();
  if (p === 'proplus' || p === 'promax' || p === 'ultimate' || p === 'admin') return [...ALL_EXCHANGES];
  if (p === 'pro') return [...PRO_DEFAULT_EXCHANGES];
  return [...FREE_DEFAULT_EXCHANGES];
}
// homepage instead of opening the trading pair.
function normalizePerpSymbol(pair: string): string {
  const base = normalizeBase(pair);
  return base ? `${base}USDT` : '';
}

function normalizeBase(pair: string): string {
  let cleaned = (pair || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return '';
  cleaned = cleaned.replace(/(SWAP|PERP)$/, '');
  for (const quote of ['USDT', 'USDC', 'USD']) {
    if (cleaned.endsWith(quote) && cleaned.length > quote.length) {
      return cleaned.slice(0, -quote.length);
    }
  }
  return cleaned;
}

export function getExchangeTradeUrl(exchange: string, pair: string): string {
  const symbol = normalizePerpSymbol(pair);
  const base = symbol.replace(/USDT$/i, '');
  const url = buildBaseTradeUrl(exchange, pair, symbol, base);
  return withAffiliate(exchange, url);
}

function buildBaseTradeUrl(exchange: string, _pair: string, symbol: string, base: string): string {
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
      return symbol ? `https://www.bitget.com/futures/usdt/${symbol}` : 'https://www.bitget.com/futures/usdt';
    case 'bingx':
      return symbol ? `https://www.bingx.com/futures/${base}-USDT` : 'https://www.bingx.com/futures';
    case 'phemex':
      return symbol ? `https://www.phemex.com/futures/${symbol}` : 'https://www.phemex.com/futures';
    case 'woo':
      return symbol ? `https://app.woox.io/markets/${base}_USDT` : 'https://app.woox.io/markets';
    case 'hyperliquid':
      return base ? `https://hyperliquid.xyz/trade/${base}` : 'https://hyperliquid.xyz/trade';
    case 'dydx':
      return base ? `https://dydx.trade/markets/${base}-USD` : 'https://dydx.trade/markets';
    case 'paradex':
      return base ? `https://paradex.io/trade/${base}-USD-PERP` : 'https://paradex.io/trade';
    case 'htx':
      return symbol ? `https://www.htx.com/en-us/futures/USDT/${base}-USDT` : 'https://www.htx.com/en-us/futures';
    case 'coinex':
      return symbol ? `https://www.coinex.com/futures/${symbol}` : 'https://www.coinex.com/futures';
    case 'blofin':
      return symbol ? `https://blofin.com/futures/${base}-USDT` : 'https://blofin.com/futures';
    case 'bitmart':
      return symbol ? `https://www.bitmart.com/contract/${symbol}` : 'https://www.bitmart.com/contract';
    case 'weex':
      return symbol ? `https://www.weex.com/futures/${symbol}` : 'https://www.weex.com/futures';
    case 'coinw':
      return symbol ? `https://www.coinw.com/futures/${symbol}` : 'https://www.coinw.com/futures';
    case 'drift':
      return base ? `https://drift.trade/market/${base}-PERP` : 'https://drift.trade';
    case 'helix':
      return base ? `https://helixapp.com/trade/${base.toLowerCase()}usdt-perp` : 'https://helixapp.com/trade';
    case 'apex':
      return symbol ? `https://pro.apex.exchange/market/${symbol}` : 'https://pro.apex.exchange';
    case 'aster':
      return symbol ? `https://www.asterdex.com/futures/${symbol}` : 'https://www.asterdex.com/futures';
    case 'bluefin':
      return base ? `https://bluefin.io/trade/${base}-PERP` : 'https://bluefin.io/trade';
    case 'kucoin':
      return symbol ? `https://futures.kucoin.com/trade/${symbol}` : 'https://futures.kucoin.com';
    case 'cryptocom':
      return symbol ? `https://crypto.com/exchange/trade/${base}_USDT-PERP` : 'https://crypto.com/exchange';
    case 'deribit':
      return symbol ? `https://www.deribit.com/main#/markets/${base}-USDT` : 'https://www.deribit.com';
    case 'kraken':
      return 'https://futures.kraken.com/trade';
    case 'coinbase':
      return 'https://www.coinbase.com/advanced-trade';
    case 'bitunix':
      return 'https://www.bitunix.com';
    case 'orderly':
      return 'https://orderly.network';
    case 'aevo':
      return 'https://app.aevo.xyz';
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

const BASE_EXCHANGE_LATENCIES: Record<string, number> = {
  binance: 42,
  phemex: 58,
  bybit: 76,
  bitget: 81,
  bingx: 84,
  mexc: 89,
  woo: 92,
  okx: 108,
  coinbase: 112,
  deribit: 116,
  htx: 118,
  hyperliquid: 124,
  coinex: 126,
  weex: 128,
  blofin: 132,
  aster: 134,
  coinw: 135,
  orderly: 136,
  dydx: 138,
  bitunix: 140,
  gate: 142,
  cryptocom: 144,
  bitmart: 145,
  paradex: 146,
  aevo: 148,
  bluefin: 150,
  kucoin: 152,
  apex: 155,
  helix: 158,
  drift: 162,
  kraken: 168,
};

export function getEstimatedExchangeLatency(exchange: string): number {
  const lower = exchange.toLowerCase();
  return BASE_EXCHANGE_LATENCIES[lower] || 85;
}
