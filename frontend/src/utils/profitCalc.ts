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

function calcSlippage(volumeA: number, volumeB: number): number {\n  const minVol = Math.min(volumeA || 0, volumeB || 0);\n  if (minVol > 10_000_000) return 0.0001;\n  if (minVol > 1_000_000) return 0.0003;\n  if (minVol > 100_000) return 0.0008;\n  return 0.0015;\n}\n\nexport interface ClientProfit {\n  grossHourly: number;\n  netHourly: number;\n  grossDaily: number;\n  netDaily: number;\n  grossWeekly: number;\n  netWeekly: number;\n  grossAnnual: number;\n  netAnnual: number;\n  fees: number;\n  slippage: number;\n  hourlyReturn: number;\n  dailyReturn: number;\n  weeklyReturn: number;\n  netApr: number;\n  paybackDays: number;\n  score: number;\n  accumulated: { d1: number; d7: number; d30: number; y1: number };\n}\n\nexport function profitCalcClient(\n  opp: {\n    exchangeA: string;\n    exchangeB: string;\n    difference: number;\n    volumeA?: number;\n    volumeB?: number;\n  },\n  capital: number = 1000,\n): ClientProfit {\n  const feesA = EXCHANGE_FEES[opp.exchangeA]?.taker || 0.0005;\n  const feesB = EXCHANGE_FEES[opp.exchangeB]?.taker || 0.0005;\n  const slippage = calcSlippage(opp.volumeA || 0, opp.volumeB || 0);\n\n  const grossHourly = capital * (Number.isFinite(opp.difference) ? opp.difference : 0);\n  const fees = capital * (feesA + feesB) * 2;\n  const slippageCost = capital * slippage * 2;\n  const oneTime = fees + slippageCost;\n\n  const grossDaily = grossHourly * 24;\n  const netHourly = grossHourly - oneTime;\n  const netDaily = grossDaily - oneTime;\n  const grossWeekly = grossDaily * 7;\n  const netWeekly = grossWeekly - oneTime;\n  const grossAnnual = grossDaily * 365;\n  const netAnnual = grossAnnual - oneTime;\n\n  const netApr = (netAnnual / capital) * 100;\n  const paybackDays = grossDaily > 0 ? oneTime / grossDaily : (oneTime === 0 ? 0 : Infinity);\n\n  const vol = Math.min(opp.volumeA || 0, opp.volumeB || 0);\n  const score = Math.max(0, netApr * Math.min(1, vol / 1_000_000));\n  const accumulated = {\n    d1: netDaily,\n    d7: netWeekly,\n    d30: grossDaily * 30 - oneTime,\n    y1: netAnnual,\n  };\n  return {\n    grossHourly,\n    netHourly,\n    grossDaily,\n    netDaily,\n    grossWeekly,\n    netWeekly,\n    grossAnnual,\n    netAnnual,\n    fees,\n    slippage: slippageCost,\n    hourlyReturn: (netHourly / capital) * 100,\n    dailyReturn: (netDaily / capital) * 100,\n    weeklyReturn: (netWeekly / capital) * 100,\n    netApr,\n    paybackDays: paybackDays === Infinity ? -1 : paybackDays,\n    score,\n    accumulated,\n  };\n}\n\nexport function breakEvenDays(profit: ClientProfit): number {\n  return profit.paybackDays;\n}\n\nexport function getPaybackDays(profit: ClientProfit): number {\n  if (profit.paybackDays < 0) return Infinity;\n  return profit.paybackDays;\n}\n