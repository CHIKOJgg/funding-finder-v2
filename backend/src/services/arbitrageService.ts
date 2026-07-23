import { ExchangeResult, ArbitrageOpportunity, ProfitCalculation, RiskAssessment } from '../types/index.js';
import { normalizeFundingRate } from '../utils/helpers.js';
import { prisma } from './prisma.js';
import { logger } from '../utils/logger.js';

// ==================== Persistence Score ====================

// Tracks how often a specific (pair, exchangeA, exchangeB) opportunity appears
// across recent scans. The score reflects "persistence" — how stable/consistent
// the arbitrage spread is. A persistent opportunity is more actionable than a
// one-off spike.

interface PersistenceEntry {
  pair: string;
  exchangeA: string;
  exchangeB: string;
}

const PERSISTENCE_WINDOW = 50;  // last N scans to consider
const persistenceHistory: PersistenceEntry[][] = [];
let persistenceScores: Record<string, number> = {};

function persistenceKey(p: PersistenceEntry): string {
  // Normalise order so A-B == B-A
  const [a, b] = [p.exchangeA, p.exchangeB].sort();
  return `${p.pair}:${a}:${b}`;
}

function recordScan(opportunities: ArbitrageOpportunity[]): void {
  const entries: PersistenceEntry[] = opportunities.map(o => ({
    pair: o.pair,
    exchangeA: o.exchangeA,
    exchangeB: o.exchangeB,
  }));
  persistenceHistory.push(entries);
  if (persistenceHistory.length > PERSISTENCE_WINDOW) {
    persistenceHistory.shift();
  }
  // Recompute scores
  const counts: Record<string, number> = {};
  for (const scan of persistenceHistory) {
    const unique = new Set(scan.map(persistenceKey));
    for (const k of unique) {
      counts[k] = (counts[k] || 0) + 1;
    }
  }
  const total = persistenceHistory.length || 1;
  const next: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) {
    next[k] = v / total;
  }
  persistenceScores = next;
}

/** Persistence grade A-F based on how often this pair appeared in recent scans. */
export function getPersistenceGrade(pair: string, exchangeA: string, exchangeB: string): string {
  const k = persistenceKey({ pair, exchangeA, exchangeB });
  const pct = (persistenceScores[k] ?? 0) * 100;
  if (pct >= 80) return 'A';
  if (pct >= 60) return 'B';
  if (pct >= 40) return 'C';
  if (pct >= 20) return 'D';
  return 'F';
}

// Exchange fee structures (taker fees)
export const EXCHANGE_FEES: Record<string, { taker: number; maker: number }> = {
  binance: { taker: 0.0004, maker: 0.0002 },   // 0.04%
  gate: { taker: 0.0005, maker: 0.00025 },      // 0.05%
  bybit: { taker: 0.00055, maker: 0.0002 },     // 0.055%
  okx: { taker: 0.0006, maker: 0.0003 },        // 0.06%
  mexc: { taker: 0.0006, maker: 0.0002 },       // 0.06%
  // New CEX additions (standard public taker/maker tiers)
  bitget: { taker: 0.0004, maker: 0.0002 },      // 0.04%
  bingx: { taker: 0.00045, maker: 0.0002 },      // 0.045%
  phemex: { taker: 0.0001, maker: 0.00006 },     // 0.01%
  woo: { taker: 0.0005, maker: 0.0002 },         // 0.05%
  // DEX additions (perp taker/maker tiers)
  hyperliquid: { taker: 0.00055, maker: 0.0001 },  // 0.055% / 0.01%
  dydx: { taker: 0.0005, maker: 0.0002 },          // 0.05%
  paradex: { taker: 0.00045, maker: 0.00015 },     // 0.045%
  // Phase-2 CEX additions
  htx: { taker: 0.00045, maker: 0.0002 },
  coinex: { taker: 0.0005, maker: 0.0002 },
  blofin: { taker: 0.0006, maker: 0.0002 },
  bitmart: { taker: 0.0004, maker: 0.0002 },
  weex: { taker: 0.0006, maker: 0.0002 },
  coinw: { taker: 0.0005, maker: 0.0002 },
  // Phase-2 DEX additions
  drift: { taker: 0.0005, maker: 0.0001 },
  helix: { taker: 0.0004, maker: 0.0002 },
  apex: { taker: 0.0004, maker: 0.0001 },
  aster: { taker: 0.0004, maker: 0.0002 },
  bluefin: { taker: 0.0004, maker: 0.0001 },
};

function calculateSlippage(volumeA: number, volumeB: number): number {
  const minVolume = Math.min(volumeA, volumeB);
  if (minVolume > 10_000_000) return 0.0001;   // 0.01%
  if (minVolume > 1_000_000) return 0.0003;    // 0.03%
  if (minVolume > 100_000) return 0.0008;      // 0.08%
  return 0.0015;                               // 0.15%
}

/**
 * Calculate real profit for an arbitrage opportunity.
 * Uses normalized hourly rates for accurate comparison.
 */
function calculateRealProfit(
  opportunity: {
    exchangeA: string;
    exchangeB: string;
    difference: number;          // hourly rate difference
    difference_per_day: number;  // daily rate difference
    volumeA: number;
    volumeB: number;
  },
  capital: number = 1000
): ProfitCalculation {
  const feesA = EXCHANGE_FEES[opportunity.exchangeA]?.taker || 0.0005;
  const feesB = EXCHANGE_FEES[opportunity.exchangeB]?.taker || 0.0005;
  const slippage = calculateSlippage(opportunity.volumeA, opportunity.volumeB);

  // Recurring funding income per hour (from the normalized rate differential).
  const grossHourlyProfit = capital * opportunity.difference;

  // One-time round-trip costs: open + close on BOTH legs, plus entry + exit
  // slippage. These are paid ONCE per position, not every hour.
  const totalFees = capital * (feesA + feesB) * 2;
  const totalSlippage = capital * slippage * 2;
  const oneTimeCost = totalFees + totalSlippage;

  // Gross funding income by horizon (before one-time costs).
  const grossDaily = grossHourlyProfit * 24;
  const grossWeekly = grossDaily * 7;
  const grossAnnual = grossDaily * 365;

  // Net profit assumes a single entry/exit per horizon, so the one-time cost is
  // subtracted ONCE (not annualized). This is the key fix — previously the
  // one-time cost was baked into the hourly figure and then multiplied by 8760,
  // producing absurd negative APY values.
  const netHourly = grossHourlyProfit - oneTimeCost;
  const netDaily = grossDaily - oneTimeCost;
  const netWeekly = grossWeekly - oneTimeCost;
  const netAnnual = grossAnnual - oneTimeCost;

  const hourlyReturn = (netHourly / capital) * 100;
  const dailyReturn = (netDaily / capital) * 100;
  const weeklyReturn = (netWeekly / capital) * 100;
  const annualReturn = (netAnnual / capital) * 100;

  return {
    grossHourly: grossHourlyProfit,
    netHourly,
    grossDaily,
    netDaily,
    fees: totalFees,
    slippage: totalSlippage,
    hourlyReturn,
    dailyReturn,
    weeklyReturn,
    annualReturn,
    netWeekly,
    netAnnual,
  };
}

/**
 * Assess risk of an arbitrage opportunity.
 * Now includes interval mismatch as a risk factor.
 */
function assessRisk(opportunity: {
  volumeA: number;
  volumeB: number;
  percentageDiff: number;
  difference: number;
  intervalA_hours: number;
  intervalB_hours: number;
  intervalMismatch: boolean;
}): RiskAssessment {
  let riskScore = 0;
  const reasons: string[] = [];

  // Risk from liquidity
  const minVolume = Math.min(opportunity.volumeA, opportunity.volumeB);
  if (minVolume < 500_000) {
    riskScore += 3;
    reasons.push('Очень низкая ликвидность');
  } else if (minVolume < 2_000_000) {
    riskScore += 1;
    reasons.push('Низкая ликвидность');
  }

  // Risk from rate volatility
  if (opportunity.percentageDiff > 100) {
    riskScore += 2;
    reasons.push('Высокая волатильность ставок');
  } else if (opportunity.percentageDiff > 50) {
    riskScore += 1;
    reasons.push('Умеренная волатильность');
  }

  // Risk from absolute difference (too high = anomaly)
  if (opportunity.difference > 0.001) { // > 0.1% per hour
    riskScore += 2;
    reasons.push('Возможная временная аномалия');
  }

  // Risk from interval mismatch
  if (opportunity.intervalMismatch) {
    riskScore += 2;
    reasons.push(`Несовпадение интервалов: ${opportunity.intervalA_hours}h vs ${opportunity.intervalB_hours}h`);
  }

  // Determine risk level
  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  if (riskScore >= 4) riskLevel = 'HIGH';
  else if (riskScore >= 2) riskLevel = 'MEDIUM';
  else riskLevel = 'LOW';

  return { score: riskScore, level: riskLevel, reasons };
}

/**
 * Calculate opportunity score for sorting (profitability / risk).
 */
function calculateOpportunityScore(opportunity: ArbitrageOpportunity): number {
  let score = opportunity.profit.annualReturn;

  // Risk adjustments
  if (opportunity.risk.level === 'HIGH') score *= 0.3;
  else if (opportunity.risk.level === 'MEDIUM') score *= 0.7;

  // Liquidity bonus
  const minVolume = Math.min(opportunity.volumeA, opportunity.volumeB);
  if (minVolume > 5_000_000) score *= 1.2;

  // Interval mismatch penalty
  if (opportunity.intervalMismatch) {
    score *= 0.5;
  }

  return score;
}

/**
 * Detect arbitrage opportunities using normalized hourly rates.
 * 
 * Key improvement: Uses normalized rates for fair comparison across
 * different funding intervals. Flags interval mismatches as risk.
 */
const QUOTE_CURRENCIES = ['USDT', 'USDC', 'USD', 'BTC', 'ETH', 'DAI'];

/**
 * Normalize an exchange-specific contract symbol to a canonical key so the same
 * market can be matched across exchanges. Examples:
 *   gate  BTC_USDT       -> BTCUSDT
 *   bybit BTCUSDT        -> BTCUSDT
 *   okx   BTC-USDT-SWAP  -> BTCUSDT
 *   mexc  BTC_USDT       -> BTCUSDT
 */
export function canonicalPairKey(contract: string): string {
  let key = (contract || '')
    .toUpperCase()
    .replace(/[-_/]/g, ' ')          // separators -> space
    .replace(/\bSWAP\b/g, ' ')       // OKX suffix
    .replace(/\bPERP\b/g, ' ')       // perp suffix
    .replace(/[^A-Z0-9]/g, '');      // strip everything else
  // Treat USD-quoted perps (dYdX, Paradex) as matching USDT perps so cross-exchange
  // funding-rate comparison includes DEX pairs.
  if (key.endsWith('USD')) key += 'T';
  // Hyperliquid and Drift return bare coin names (e.g. "BTC", "SOL").
  // Append USDT so they match CEX pairs like "BTCUSDT".
  if (key.length <= 5 && !key.endsWith('USDT') && !key.endsWith('USDC')) key += 'USDT';
  return key;
}

/**
 * Human-readable pair (e.g. "BTC/USDT") derived from the canonical key.
 */
function formatPair(contract: string): string {
  const key = canonicalPairKey(contract);
  for (const q of QUOTE_CURRENCIES) {
    if (key.endsWith(q) && key.length > q.length) {
      return `${key.slice(0, -q.length)}/${q}`;
    }
  }
  return key;
}

export function detectArbitrageOpportunities(scanResults: ExchangeResult[]): ArbitrageOpportunity[] {
  const opportunities: ArbitrageOpportunity[] = [];

  // Group by canonical pair key (so different exchange symbol formats match)
  const pairsMap = new Map<string, ExchangeResult[]>();
  scanResults.forEach((item) => {
    const key = canonicalPairKey(item.contract);
    if (!key) return;
    if (!pairsMap.has(key)) {
      pairsMap.set(key, []);
    }
    pairsMap.get(key)!.push(item);
  });

  pairsMap.forEach((items) => {
    if (items.length < 2) return;

    const pair = formatPair(items[0].contract);

    // Compare each exchange pair
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];

        // Don't compare an exchange against itself
        if (a.exchange === b.exchange) continue;
        // Use normalized hourly rates for comparison
        const fundingA_per_hour = a.funding_rate_per_hour || 0;
        const fundingB_per_hour = b.funding_rate_per_hour || 0;
        const fundingA_per_day = a.funding_rate_per_day || 0;
        const fundingB_per_day = b.funding_rate_per_day || 0;

        // Calculate difference using normalized rates
        const difference = Math.abs(fundingA_per_hour - fundingB_per_hour);
        const difference_per_day = Math.abs(fundingA_per_day - fundingB_per_day);
        
        // Percentage difference (relative to smaller rate)
        const minRate = Math.min(Math.abs(fundingA_per_hour), Math.abs(fundingB_per_hour));
        const percentageDiff = minRate > 0 ? (difference / minRate) * 100 : 0;

        // Interval info
        const intervalA_hours = a.funding_interval_hours || 8;
        const intervalB_hours = b.funding_interval_hours || 8;
        const intervalMismatch = Math.abs(intervalA_hours - intervalB_hours) > 1;

        // Only compare contracts with the SAME funding interval. Comparing e.g.
        // an 8h contract against a 24h one via per-hour normalization produces
        // misleading, non-collectible "opportunities", so skip mismatches.
        if (intervalMismatch) continue;

        // Minimum threshold: 0.001% per hour difference
        if (difference > 0.00001) {
          const opp: ArbitrageOpportunity = {
            pair,
            exchangeA: a.exchange,
            exchangeB: b.exchange,
            fundingA: a.currentFunding,
            fundingB: b.currentFunding,
            fundingA_per_hour,
            fundingB_per_hour,
            fundingA_per_day,
            fundingB_per_day,
            intervalA_hours,
            intervalB_hours,
            intervalMismatch,
            difference,
            difference_per_day,
            percentageDiff,
            volumeA: a.volume_24h_settle,
            volumeB: b.volume_24h_settle,
            markPriceA: a.mark_price,
            markPriceB: b.mark_price,
            opportunity:
              fundingA_per_hour > fundingB_per_hour
                ? `SHORT on ${a.exchange}, LONG on ${b.exchange}`
                : `LONG on ${a.exchange}, SHORT on ${b.exchange}`,
            profit: calculateRealProfit({
              exchangeA: a.exchange,
              exchangeB: b.exchange,
              difference,
              difference_per_day,
              volumeA: a.volume_24h_settle,
              volumeB: b.volume_24h_settle,
            }),
            risk: assessRisk({
              volumeA: a.volume_24h_settle,
              volumeB: b.volume_24h_settle,
              percentageDiff,
              difference,
              intervalA_hours,
              intervalB_hours,
              intervalMismatch,
            }),
            score: 0,
            timestamp: Date.now(),
          };
          opp.score = calculateOpportunityScore(opp);
          opportunities.push(opp);
        }
      }
    }
  });

  // Sort by score (best opportunities first)
  const sorted = opportunities.sort((a, b) => b.score - a.score);
  // Record this scan for persistence tracking
  recordScan(sorted);
  return sorted;
}

// ==================== Alert Management ====================

export async function createArbitrageAlert(
  userId: string,
  data: {
    pair: string;
    exchangeA: string;
    exchangeB: string;
    condition?: string;
    threshold?: number;
    direction?: string;
    cooldown?: number;
  }
) {
  const count = await prisma.arbitrageAlert.count({ where: { userId } });
  if (count >= 50) {
    throw new Error('Maximum 50 arbitrage alerts per user');
  }

  return prisma.arbitrageAlert.create({
    data: {
      userId,
      pair: data.pair,
      exchangeA: data.exchangeA,
      exchangeB: data.exchangeB,
      condition: data.condition || 'difference',
      threshold: data.threshold || 0.002,
      direction: data.direction || 'both',
      cooldown: data.cooldown || 300000,
    },
  });
}

export async function getUserArbitrageAlerts(userId: string, limit: number = 50, offset: number = 0) {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const safeOffset = Math.max(offset, 0);
  const [alerts, total] = await Promise.all([
    prisma.arbitrageAlert.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
      skip: safeOffset,
    }),
    prisma.arbitrageAlert.count({ where: { userId } }),
  ]);
  return { alerts, total, limit: safeLimit, offset: safeOffset };
}

export async function deleteArbitrageAlert(userId: string, alertId: string) {
  const result = await prisma.arbitrageAlert.deleteMany({
    where: { id: alertId, userId },
  });
  return result.count > 0;
}

export async function toggleArbitrageAlert(userId: string, alertId: string) {
  const alert = await prisma.arbitrageAlert.findFirst({
    where: { id: alertId, userId },
  });
  if (!alert) return null;

  return prisma.arbitrageAlert.update({
    where: { id: alertId },
    data: { isActive: !alert.isActive },
  });
}

export async function calculateProfit(opportunity: ArbitrageOpportunity, capital: number) {
  const profit = calculateRealProfit({
    exchangeA: opportunity.exchangeA,
    exchangeB: opportunity.exchangeB,
    difference: opportunity.difference,
    difference_per_day: opportunity.difference_per_day,
    volumeA: opportunity.volumeA,
    volumeB: opportunity.volumeB,
  }, capital);
  
  const risk = assessRisk({
    volumeA: opportunity.volumeA,
    volumeB: opportunity.volumeB,
    percentageDiff: opportunity.percentageDiff,
    difference: opportunity.difference,
    intervalA_hours: opportunity.intervalA_hours,
    intervalB_hours: opportunity.intervalB_hours,
    intervalMismatch: opportunity.intervalMismatch,
  });

  return { profit, risk };
}
