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
//   - Rates are normalized to a common 8h basis (a 1h interval rate is worth
//     an eighth of an 8h rate), so pairs mixing funding intervals are compared
//     fairly instead of inflating the spread.
//   - The market-neutral play captures (maxRate - minRate) that day: long the
//     exchange paying the most, short the one charging the most.
//   - We count ONE capture per day per pair (no compounding assumption), 1x
//     notional. Fees/slippage are intentionally excluded so the figure is a
//     ceiling, not a promise. The UI/landing must label it "illustrative".

const HISTORY_DAYS = 30;
const ASSUMED_NOTIONAL_USD = 10_000;
const DIVERSIFIED_TOP_N = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 30 * 60 * 1000; // public endpoint — serve warm cache
const CHUNK_SIZE = 10_000;

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

// funding is stored as the raw per-settlement rate; normalize to per-8h so
// 1h/4h/8h/24h contracts are comparable. NULL interval = legacy row, assume 8h.
function normalizeTo8h(funding: number, intervalHours: number | null | undefined): number {
  const hours = intervalHours && intervalHours > 0 ? intervalHours : 8;
  return funding * (8 / hours);
}

let cached: { at: number; result: Awaited<ReturnType<typeof computeTrackRecord>> } | null = null;

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
  const base = {
    ok: true,
    available: false,
    windowDays: days,
    notionalUsd,
    pairsAnalyzed: 0,
    bestPair: null as any,
    diversified: null as any,
  };

  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  const since = new Date(Date.now() - days * DAY_MS);

  // Build a historyId -> (exchange, contract) map once. Histories are few
  // (one row per exchange:contract) compared to the millions of records.
  const keyRows = await prisma.fundingHistory.findMany({
    select: { id: true, key: true },
  });
  const keyById = new Map<string, { exchange: string; pair: string }>();
  for (const h of keyRows) {
    const sep = h.key.indexOf(':');
    if (sep < 0) continue;
    const exchange = h.key.slice(0, sep);
    const pair = canonicalPairKey(h.key.slice(sep + 1));
    if (!pair) continue;
    keyById.set(h.id, { exchange, pair });
  }

  // canonical pair -> day -> exchange -> latest rate that day (8h-normalized).
  // Records stream in timestamp-ascending order, so the last write per
  // (history, day) IS the latest of that day.
  const byPair = new Map<string, Map<string, Map<string, number>>>();
  let pairsWithData = 0;

  let lastTs: Date | null = null;
  let lastId = '';

  const processChunk = async (afterTs: Date | null, afterId: string): Promise<{ rows: any[]; done: boolean }> => {
    const rows = await prisma.fundingRecord.findMany({
      where: afterTs
        ? {
            OR: [
              { timestamp: { gt: afterTs } },
              { timestamp: afterTs, id: { gt: afterId } },
            ],
          }
        : { timestamp: { gte: since } },
      select: { id: true, timestamp: true, funding: true, intervalHours: true, fundingHistoryId: true },
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
      take: CHUNK_SIZE,
    });
    return { rows, done: rows.length < CHUNK_SIZE };
  };

  try {
    let { rows, done } = await processChunk(null, '');
    while (rows.length > 0) {
      for (const rec of rows) {
        const meta = keyById.get(rec.fundingHistoryId);
        if (!meta) continue;
        let pairMap = byPair.get(meta.pair);
        if (!pairMap) {
          pairMap = new Map();
          byPair.set(meta.pair, pairMap);
          pairsWithData += 1;
        }
        const dk = dayKey(rec.timestamp.getTime());
        let dayMap = pairMap.get(dk);
        if (!dayMap) {
          dayMap = new Map();
          pairMap.set(dk, dayMap);
        }
        // timestamp ascending => overwriting keeps the latest rate of the day
        dayMap.set(meta.exchange, normalizeTo8h(rec.funding, rec.intervalHours));
      }
      const last = rows[rows.length - 1];
      lastTs = last.timestamp;
      lastId = last.id;
      if (done) break;
      ({ rows, done } = await processChunk(lastTs, lastId));
    }
  } catch (e) {
    logger.error({ err: (e as Error).message }, 'Track record scan failed');
    return base;
  }

  if (pairsWithData === 0) return base;

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

  const result = {
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

  cached = { at: Date.now(), result };
  return result;
}

export function clearTrackRecordCache(): void {
  cached = null;
}
