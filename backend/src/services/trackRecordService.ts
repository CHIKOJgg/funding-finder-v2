import { prisma } from './prisma.js';
import { logger } from '../utils/logger.js';
import { canonicalPairKey } from './arbitrageService.js';

// Social-proof "track record": an ILLUSTRATIVE, market-neutral funding
// arbitrage paper backtest computed from the real FundingHistory the scanner
// already stores. This is the single biggest missing trust element for selling
// the product — instead of asking prospects to "trust us", we show a concrete,
// data-backed number.
//
// Method (kept deliberately conservative and clearly labelled):
//   - For each canonical pair traded on >=2 exchanges, take each day's latest
//     funding rate per exchange.
//   - The market-neutral play captures (maxRate - minRate) that day: long the
//     exchange paying the most, short the one charging the most.
//   - We count ONE capture per day per pair (no compounding assumption), 1x
//     notional. Fees/slippage are intentionally excluded so the figure is a
//     ceiling, not a promise. The UI/landing must label it "illustrative".

const HISTORY_DAYS = 30;
const ASSUMED_NOTIONAL_USD = 10_000;
const DIVERSIFIED_TOP_N = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

interface PairStat {
  pair: string;
  longExchange: string;
  shortExchange: string;
  cumulativeFraction: number;
  daysWithSpread: number;
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

export async function computeTrackRecord(
  days: number = HISTORY_DAYS,
  notionalUsd: number = ASSUMED_NOTIONAL_USD
): Promise<{
  ok: boolean;
  available: boolean;
  windowDays: number;
  notionalUsd: number;
  pairsAnalyzed: number;
  bestPair: (PairStat & { cumulativePct: number; annualizedPct: number; profitUsd: number }) | null;
  diversified: { cumulativePct: number; annualizedPct: number; profitUsd: number } | null;
}> {
  const since = new Date(Date.now() - days * DAY_MS);

  // Load in batches to avoid OOM
  const BATCH_SIZE = 100;
  let cursor: string | undefined;
  const allHistories: any[] = [];

  while (true) {
    const batch = await prisma.fundingHistory.findMany({
      where: { records: { some: { timestamp: { gte: since } } } },
      include: {
        records: {
          where: { timestamp: { gte: since } },
          orderBy: { timestamp: 'asc' },
        },
      },
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    });

    if (batch.length === 0) break;
    allHistories.push(...batch);
    cursor = batch[batch.length - 1].id;
  }

  const base = {
    ok: true,
    available: false,
    windowDays: days,
    notionalUsd,
    pairsAnalyzed: 0,
    bestPair: null as any,
    diversified: null as any,
  };

  if (!allHistories.length) return base;

  // canonical pair -> day -> exchange -> latest rate that day
  const byPair = new Map<string, Map<string, Map<string, number>>>();

  for (const h of allHistories) {
    const sep = h.key.indexOf(':');
    if (sep < 0) continue;
    const exchange = h.key.slice(0, sep);
    const contract = h.key.slice(sep + 1);
    const pair = canonicalPairKey(contract);
    if (!pair) continue;

    for (const rec of h.records) {
      const dk = dayKey(rec.timestamp.getTime());
      if (!byPair.has(pair)) byPair.set(pair, new Map());
      const pairMap = byPair.get(pair)!;
      if (!pairMap.has(dk)) pairMap.set(dk, new Map());
      const dayMap = pairMap.get(dk)!;
      // keep latest rate of the day
      dayMap.set(exchange, rec.funding);
    }
  }

  const stats: PairStat[] = [];

  byPair.forEach((pairMap, pair) => {
    let cumulative = 0;
    let daysWithSpread = 0;
    let longEx = '';
    let shortEx = '';

    pairMap.forEach((dayMap) => {
      if (dayMap.size < 2) return;
      let maxRate = -Infinity;
      let minRate = Infinity;
      let maxEx = '';
      let minEx = '';
      dayMap.forEach((rate, ex) => {
        if (rate > maxRate) { maxRate = rate; maxEx = ex; }
        if (rate < minRate) { minRate = rate; minEx = ex; }
      });
      const spread = maxRate - minRate;
      if (spread > 0) {
        cumulative += spread;
        daysWithSpread += 1;
        longEx = minEx;
        shortEx = maxEx;
      }
    });

    if (daysWithSpread >= 3 && cumulative > 0) {
      stats.push({
        pair,
        longExchange: longEx,
        shortExchange: shortEx,
        cumulativeFraction: cumulative,
        daysWithSpread,
      });
    }
  });

  if (stats.length === 0) return base;

  stats.sort((a, b) => b.cumulativeFraction - a.cumulativeFraction);

  const toResult = (s: PairStat) => {
    const profit = s.cumulativeFraction * notionalUsd;
    const cumulativePct = (s.cumulativeFraction * 100);
    const annualizedPct = (cumulativePct / days) * 365;
    return { ...s, cumulativePct, annualizedPct, profitUsd: profit };
  };

  const best = toResult(stats[0]);

  // Diversified: average the top-N pairs' cumulative returns (you'd spread
  // capital across several, so we don't stack uncorrelated pairs).
  const topN = stats.slice(0, DIVERSIFIED_TOP_N);
  const divFraction = topN.reduce((sum, s) => sum + s.cumulativeFraction, 0) / topN.length;
  const divProfit = divFraction * notionalUsd;
  const divCumulativePct = divFraction * 100;
  const divAnnualizedPct = (divCumulativePct / days) * 365;

  return {
    ...base,
    available: true,
    pairsAnalyzed: stats.length,
    bestPair: best,
    diversified: {
      cumulativePct: divCumulativePct,
      annualizedPct: divAnnualizedPct,
      profitUsd: divProfit,
    },
  };
}
