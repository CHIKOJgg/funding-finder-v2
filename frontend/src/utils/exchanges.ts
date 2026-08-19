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

export function exchangeLabel(id: string): string {
  return EXCHANGE_LABELS[id.toLowerCase()] || id.toUpperCase();
}

/**
 * Direct link to open a perpetual futures pair on an exchange.
 * Normalizes common pair formats (e.g. BTC_USDT, BTCUSDT, BTC-USDT)
 * to the exchange's specific URL structure.
 */
export function getExchangeTradeUrl(exchange: string, pair: string): string {
  const ex = exchange.toLowerCase();
  // Strip slashes/underscores/dashes to get the clean symbols (BTC, USDT)
  const clean = pair.replace(/[-/_]/g, '').toUpperCase();
  const base = clean.replace(/USDT$|USD$|PERP$/i, '');
  const quote = clean.endsWith('USD') ? 'USD' : 'USDT';

  let rawUrl: string;
  switch (ex) {
    case 'gate':
      rawUrl = `https://www.gate.io/futures_trade/USDT/${base}_${quote}`;
      break;
    case 'binance':
      rawUrl = `https://www.binance.com/en/futures/${base}${quote}`;
      break;
    case 'bybit':
      rawUrl = `https://www.bybit.com/trade/usdt/${base}${quote}`;
      break;
    case 'kucoin':
      rawUrl = `https://www.kucoin.com/futures/trade/${base}${quote}M`;
      break;
    case 'mexc':
      rawUrl = `https://futures.mexc.com/exchange/${base}_${quote}`;
      break;
    case 'okx':
      rawUrl = `https://www.okx.com/trade-swap/${base.toLowerCase()}-${quote.toLowerCase()}-swap`;
      break;
    case 'bitget':
      rawUrl = `https://www.bitget.com/mix/usdt/${base}${quote}_UMCBL`;
      break;
    case 'bingx':
      rawUrl = `https://bingx.com/en-us/futures/forward/${base}${quote}/`;
      break;
    case 'phemex':
      rawUrl = `https://phemex.com/trade/${base}${quote}`;
      break;
    case 'woo':
      rawUrl = `https://x.woo.org/en/trade/PERP_${base}_${quote}`;
      break;
    case 'hyperliquid':
      rawUrl = `https://app.hyperliquid.xyz/trade/${base}`;
      break;
    case 'dydx':
      rawUrl = `https://dydx.exchange/trade/${base}-${quote}`;
      break;
    case 'paradex':
      rawUrl = `https://app.paradex.trade/trade/${base}-USD-PERP`;
      break;
    case 'htx':
      rawUrl = `https://www.htx.com/en-us/futures/linear_swap/exchange#contract_code=${base}-${quote}`;
      break;
    case 'blofin':
      rawUrl = `https://blofin.com/futures/${base}-${quote}`;
      break;
    case 'bitmart':
      rawUrl = `https://www.bitmart.com/futures/en-US?symbol=${base}${quote}`;
      break;
    case 'weex':
      rawUrl = `https://www.weex.com/futures/${base}_${quote}`;
      break;
    case 'coinw':
      rawUrl = `https://www.coinw.com/front/futures?symbol=${base}${quote}`;
      break;
    case 'coinex':
      rawUrl = `https://www.coinex.com/futures/${base}${quote}`;
      break;
    case 'drift':
      rawUrl = `https://app.drift.trade/trade/${base}-PERP`;
      break;
    case 'helix':
      rawUrl = `https://helixapp.com/futures/${base.toLowerCase()}-usdt-perp`;
      break;
    case 'apex':
      rawUrl = `https://pro.apex.exchange/trade/${base}-${quote}`;
      break;
    case 'aster':
      rawUrl = `https://aster.finance/trade/${base}-${quote}`;
      break;
    case 'bluefin':
      rawUrl = `https://trade.bluefin.io/trade/${base}-${quote}`;
      break;
    case 'kraken':
      rawUrl = `https://pro.kraken.com/app/trade/${base.toLowerCase()}-${quote.toLowerCase()}`;
      break;
    case 'coinbase':
      rawUrl = `https://international.coinbase.com/trade/${base}-PERP`;
      break;
    case 'bitunix':
      rawUrl = `https://www.bitunix.com/contract-trading/${base}${quote}`;
      break;
    case 'orderly':
      rawUrl = `https://orderly.network/`;
      break;
    case 'aevo':
      rawUrl = `https://app.aevo.xyz/perpetual/${base.toLowerCase()}`;
      break;
    case 'cryptocom':
      rawUrl = `https://crypto.com/exchange/trade/${base}_${quote}`;
      break;
    case 'deribit':
      rawUrl = `https://www.deribit.com/futures/${base}-PERPETUAL`;
      break;
    default:
      rawUrl = `https://www.google.com/search?q=${encodeURIComponent(`${exchange} ${pair} futures trading`)}`;
  }

  return withAffiliate(ex, rawUrl);
}

/** Opens the exchange trading pair in a new tab/window. */
export function openExchange(exchange: string, pair: string): void {
  const url = getExchangeTradeUrl(exchange, pair);
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export const ALL_EXCHANGES = [
  'gate',
  'binance',
  'bybit',
  'kucoin',
  'mexc',
  'okx',
  'bitget',
  'bingx',
  'phemex',
  'woo',
  'hyperliquid',
  'dydx',
  'htx',
  'blofin',
  'aster',
  'bluefin',
  'kraken',
  'coinbase',
  'bitunix',
  'orderly',
  'aevo',
  'apex',
  'bitmart',
  'coinex',
  'coinw',
  'cryptocom',
  'deribit',
  'drift',
  'helix',
  'paradex',
  'weex',
];
