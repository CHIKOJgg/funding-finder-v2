// Client-side profit calculation engine.
// Mirrors the backend calculateRealProfit() so the UI can show instant profit
// estimates without an API call. Used for the inline calculator in OpportunityCard.

const EXCHANGE_FEES: Record<string, { taker: number }> = {
  binance:     { taker: 0.0004 },
  gate:        { taker: 0.0005 },
  bybit:       { taker: 0.00055 },
  okx:         { taker: 0.0006 },
  mexc:        { taker: 0.0006 },
  bitget:      { taker: 0.0004 },
  bingx:       { taker: 0.00045 },
  phemex:      { taker: 0.0001 },
  woo:         { taker: 0.0005 },
  hyperliquid: { taker: 0.00055 },
  dydx:        { taker: 0.0005 },
  paradex:     { taker: 0.00045 },
  htx:         { taker: 0.00045 },
  coinex:      { taker: 0.0005 },
  blofin:      { taker: 0.0006 },
  bitmart:     { taker: 0.0004 },
  weex:        { taker: 0.0006 },
  coinw:       { taker: 0.0005 },
  drift:       { taker: 0.0005 },
  helix:       { taker: 0.0004 },
  apex:        { taker: 0.0004 },
  aster:       { taker: 0.0004 },
  bluefin:     { taker: 0.0004 },
  kraken:      { taker: 0.0005 },
  coinbase:    { taker: 0.0004 },
  bitunix:     { taker: 0.0006 },
  orderly:     { taker: 0.0006 },
  aevo:        { taker: 0.0005 },
  kucoin:      { taker: 0.0006 },
  cryptocom:   { taker: 0.0005 },
  deribit:     { taker: 0.0005 },
};

function calcSlippage(volumeA: number, volumeB: number): number {
  const minVol = Math.min(volumeA || 0, volumeB || 0);
  if (minVol > 10_000_000) return 0.0001;
  if (minVol > 1_000_000) return 0.0003;
  if (minVol > 100_000) return 0.0008;
  return 0.0015;
}

export interface ClientProfit {
  grossHourly: number;
  netHourly: number;
  grossDaily: number;
  netDaily: number;
  grossWeekly: number;
  netWeekly: number;
  grossAnnual: number;
  netAnnual: number;
  fees: number;
  slippage: number;
  hourlyReturn: number;
  dailyReturn: number;
  weeklyReturn: number;
  netApr: number;
  paybackDays: number;
  score: number;
  accumulated: { d1: number; d7: number; d30: number; y1: number };
}

export function profitCalcClient(
  opp: {
    exchangeA: string;
    exchangeB: string;
    difference: number;
    volumeA?: number;
    volumeB?: number;
  },
  capital: number = 1000,
): ClientProfit {
  const feesA = EXCHANGE_FEES[opp.exchangeA]?.taker || 0.0005;
  const feesB = EXCHANGE_FEES[opp.exchangeB]?.taker || 0.0005;
  const slippage = calcSlippage(opp.volumeA || 0, opp.volumeB || 0);

  const grossHourly = capital * (Number.isFinite(opp.difference) ? opp.difference : 0);
  const fees = capital * (feesA + feesB) * 2;
  const slippageCost = capital * slippage * 2;
  const oneTime = fees + slippageCost;

  const grossDaily = grossHourly * 24;
  const netHourly = grossHourly - oneTime;
  const netDaily = grossDaily - oneTime;
  const grossWeekly = grossDaily * 7;
  const netWeekly = grossWeekly - oneTime;
  const grossAnnual = grossDaily * 365;
  const netAnnual = grossAnnual - oneTime;

  const netApr = (netAnnual / capital) * 100;
  const paybackDays = grossDaily > 0 ? oneTime / grossDaily : (oneTime === 0 ? 0 : Infinity);

  const vol = Math.min(opp.volumeA || 0, opp.volumeB || 0);
  const score = Math.max(0, netApr * Math.min(1, vol / 1_000_000));
  const accumulated = {
    d1: netDaily,
    d7: netWeekly,
    d30: grossDaily * 30 - oneTime,
    y1: netAnnual,
  };
  return {
    grossHourly,
    netHourly,
    grossDaily,
    netDaily,
    grossWeekly,
    netWeekly,
    grossAnnual,
    netAnnual,
    fees,
    slippage: slippageCost,
    hourlyReturn: (netHourly / capital) * 100,
    dailyReturn: (netDaily / capital) * 100,
    weeklyReturn: (netWeekly / capital) * 100,
    netApr,
    paybackDays: paybackDays === Infinity ? -1 : paybackDays,
    score,
    accumulated,
  };
}

export function breakEvenDays(profit: ClientProfit): number {
  return profit.paybackDays;
}

export function getPaybackDays(profit: ClientProfit): number {
  if (profit.paybackDays < 0) return Infinity;
  return profit.paybackDays;
}
