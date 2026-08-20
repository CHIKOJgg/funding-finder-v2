/**
 * Exchange Partner & Affiliate Referral Configuration
 * 
 * To monetize traffic sent to exchanges:
 * 1. Register in the partner/affiliate program of the exchanges below.
 * 2. Paste your referral code or partner ID into the `code` field, OR
 *    set the corresponding environment variable (e.g. VITE_AFF_BINANCE=your_code).
 * 3. When users click "Open on exchange", your referral code is automatically attached.
 * 
 * Empty codes ('') are safe no-ops (URLs remain standard without any referral query param).
 */

const env = (import.meta as any).env || {};

export interface ExchangeAffiliate {
  name: string;
  param: string;
  code: string;
  registerUrl?: string;
  description?: string;
}

export const AFFILIATE_CONFIG: Record<string, ExchangeAffiliate> = {
  binance: {
    name: 'Binance',
    param: 'ref',
    code: env.VITE_AFF_BINANCE || '',
    registerUrl: 'https://accounts.binance.com/register?ref=',
    description: 'Binance Futures affiliate program',
  },
  bybit: {
    name: 'Bybit',
    param: 'ref',
    code: env.VITE_AFF_BYBIT || '',
    registerUrl: 'https://www.bybit.com/invite?ref=',
    description: 'Bybit Partner program',
  },
  okx: {
    name: 'OKX',
    param: 'channelId',
    code: env.VITE_AFF_OKX || '',
    registerUrl: 'https://www.okx.com/join/',
    description: 'OKX Affiliate program',
  },
  gate: {
    name: 'Gate.io',
    param: 'ref',
    code: env.VITE_AFF_GATE || '',
    registerUrl: 'https://www.gate.io/signup/',
    description: 'Gate.io Referral program',
  },
  mexc: {
    name: 'MEXC',
    param: 'inviteCode',
    code: env.VITE_AFF_MEXC || '',
    registerUrl: 'https://www.mexc.com/register?inviteCode=',
    description: 'MEXC Affiliate program',
  },
  bitget: {
    name: 'Bitget',
    param: 'ref',
    code: env.VITE_AFF_BITGET || '',
    registerUrl: 'https://www.bitget.com/expressly?channelCode=',
    description: 'Bitget Partner program',
  },
  bingx: {
    name: 'BingX',
    param: 'ref',
    code: env.VITE_AFF_BINGX || '',
    registerUrl: 'https://bingx.com/invite/',
    description: 'BingX Affiliate program',
  },
  phemex: {
    name: 'Phemex',
    param: 'referralCode',
    code: env.VITE_AFF_PHEMEX || '',
    registerUrl: 'https://phemex.com/register?referralCode=',
    description: 'Phemex Partner program',
  },
  woo: {
    name: 'WOO X',
    param: 'ref',
    code: env.VITE_AFF_WOO || '',
    registerUrl: 'https://x.woo.org/register?ref=',
    description: 'WOO X Referral program',
  },
  htx: {
    name: 'HTX',
    param: 'invite_code',
    code: env.VITE_AFF_HTX || '',
    registerUrl: 'https://www.htx.com/invite/en-us/1h?invite_code=',
    description: 'HTX Affiliate program',
  },
  coinex: {
    name: 'CoinEx',
    param: 'refer_code',
    code: env.VITE_AFF_COINEX || '',
    registerUrl: 'https://www.coinex.com/register?refer_code=',
    description: 'CoinEx Partner program',
  },
  blofin: {
    name: 'BloFin',
    param: 'referral_code',
    code: env.VITE_AFF_BLOFIN || '',
    registerUrl: 'https://blofin.com/register?referral_code=',
    description: 'BloFin Affiliate program',
  },
  bitmart: {
    name: 'BitMart',
    param: 'r',
    code: env.VITE_AFF_BITMART || '',
    registerUrl: 'https://www.bitmart.com/register-referral/en-US?r=',
    description: 'BitMart Referral program',
  },
  weex: {
    name: 'WEEX',
    param: 'code',
    code: env.VITE_AFF_WEEX || '',
    registerUrl: 'https://www.weex.com/register?code=',
    description: 'WEEX Affiliate program',
  },
  coinw: {
    name: 'CoinW',
    param: 'r',
    code: env.VITE_AFF_COINW || '',
    registerUrl: 'https://www.coinw.com/register?r=',
    description: 'CoinW Partner program',
  },
  hyperliquid: {
    name: 'Hyperliquid',
    param: 'ref',
    code: env.VITE_AFF_HYPERLIQUID || '',
    registerUrl: 'https://app.hyperliquid.xyz/join/',
    description: 'Hyperliquid DEX referral',
  },
  dydx: {
    name: 'dYdX',
    param: 'ref',
    code: env.VITE_AFF_DYDX || '',
    registerUrl: 'https://dydx.trade/r/',
    description: 'dYdX DEX affiliate',
  },
  paradex: {
    name: 'Paradex',
    param: 'ref',
    code: env.VITE_AFF_PARADEX || '',
    registerUrl: 'https://paradex.io/trade?ref=',
    description: 'Paradex DEX referral',
  },
  drift: {
    name: 'Drift',
    param: 'ref',
    code: env.VITE_AFF_DRIFT || '',
    registerUrl: 'https://app.drift.trade/ref/',
    description: 'Drift Protocol referral',
  },
  helix: {
    name: 'Helix',
    param: 'ref',
    code: env.VITE_AFF_HELIX || '',
    registerUrl: 'https://helixapp.com?ref=',
    description: 'Helix Injective DEX referral',
  },
  apex: {
    name: 'ApeX',
    param: 'ref',
    code: env.VITE_AFF_APEX || '',
    registerUrl: 'https://pro.apex.exchange/trade?ref=',
    description: 'ApeX Omni DEX affiliate',
  },
  aster: {
    name: 'Aster',
    param: 'ref',
    code: env.VITE_AFF_ASTER || '',
    registerUrl: 'https://www.asterdex.com?ref=',
    description: 'Aster DEX referral',
  },
  bluefin: {
    name: 'Bluefin',
    param: 'ref',
    code: env.VITE_AFF_BLUEFIN || '',
    registerUrl: 'https://trade.bluefin.io?ref=',
    description: 'Bluefin DEX referral',
  },
  kucoin: {
    name: 'KuCoin',
    param: 'ref',
    code: env.VITE_AFF_KUCOIN || '',
    registerUrl: 'https://www.kucoin.com/ucenter/signup?rcode=',
    description: 'KuCoin Affiliate program',
  },
  cryptocom: {
    name: 'Crypto.com',
    param: 'ref',
    code: env.VITE_AFF_CRYPTOCOM || '',
    registerUrl: 'https://crypto.com/exchange/signup?ref=',
    description: 'Crypto.com Exchange affiliate',
  },
  deribit: {
    name: 'Deribit',
    param: 'ref',
    code: env.VITE_AFF_DERIBIT || '',
    registerUrl: 'https://www.deribit.com/reg-',
    description: 'Deribit Affiliate program',
  },
  bitunix: {
    name: 'Bitunix',
    param: 'ref',
    code: env.VITE_AFF_BITUNIX || '',
    registerUrl: 'https://www.bitunix.com/register?vipCode=',
    description: 'Bitunix Affiliate program',
  },
  orderly: {
    name: 'Orderly',
    param: 'ref',
    code: env.VITE_AFF_ORDERLY || '',
    registerUrl: 'https://orderly.network?ref=',
    description: 'Orderly Network referral',
  },
  aevo: {
    name: 'Aevo',
    param: 'ref',
    code: env.VITE_AFF_AEVO || '',
    registerUrl: 'https://app.aevo.xyz/r/',
    description: 'Aevo DEX referral',
  },
};
