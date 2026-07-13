import { KNOWN_INTERVALS, EXCHANGE_FUNDING_INTERVALS, ExchangeResult } from '../types/index.js';

// ==================== Unified ExchangeResult builder ====================

/**
 * Build a fully-populated ExchangeResult from the minimal fields a scanner
 * extracts from an exchange. Centralizes normalization (hourly/day/annualized)
 * and next-funding timing so every scanner produces an identical shape.
 */
export interface ExchangeResultInput {
  exchange: string;
  contract: string;
  currentFunding: number;
  fundingIntervalSeconds: number;
  fundingIntervalSource?: 'api' | 'detected' | 'default';
  fundingNextApply: number; // ms timestamp (0 if unknown)
  markPrice: number;
  volume24hSettle: number;
}

export function toExchangeResult(input: ExchangeResultInput): ExchangeResult {
  const intervalSeconds = input.fundingIntervalSeconds > 0 ? input.fundingIntervalSeconds : KNOWN_INTERVALS.EIGHT_HOUR;
  const normalized = normalizeFundingRate(input.currentFunding, intervalSeconds);
  const now = Date.now();
  const timeUntilNext =
    input.fundingNextApply > now ? Math.floor((input.fundingNextApply - now) / 1000) : null;

  return {
    exchange: input.exchange,
    contract: input.contract,
    currentFunding: input.currentFunding,
    funding_interval_seconds: intervalSeconds,
    funding_interval_hours: intervalSeconds / 3600,
    funding_interval_source: input.fundingIntervalSource ?? 'default',
    funding_rate_per_hour: normalized.perHour,
    funding_rate_per_day: normalized.perDay,
    annualized_rate: normalized.annualized,
    funding_next_apply: input.fundingNextApply,
    time_until_next_funding_seconds: timeUntilNext ?? 0,
    mark_price: input.markPrice,
    volume_24h_settle: input.volume24hSettle,
    // Legacy fields
    med_seconds: intervalSeconds,
    med_hours: intervalSeconds / 3600,
  };
}

// ==================== Math Utilities ====================

export function median(arr: number[]): number | null {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ==================== Funding Rate Normalization ====================

/**
 * Detect the funding interval for a contract based on exchange defaults and history.
 * Returns the interval in seconds.
 */
export function detectFundingInterval(
  exchange: string,
  historyTimestamps?: number[],
  apiIntervalMinutes?: number
): { seconds: number; hours: number; source: 'api' | 'detected' | 'default' } {
  // 1. If the API directly provides interval, use it
  if (apiIntervalMinutes && apiIntervalMinutes > 0) {
    const seconds = apiIntervalMinutes * 60;
    return { seconds, hours: seconds / 3600, source: 'api' };
  }

  // 2. If we have history timestamps, detect from time deltas
  if (historyTimestamps && historyTimestamps.length >= 2) {
    const sorted = [...historyTimestamps].sort((a, b) => a - b);
    const deltas: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      deltas.push(sorted[i] - sorted[i - 1]);
    }
    const medDelta = median(deltas);
    if (medDelta && medDelta > 0) {
      // Round to nearest known interval
      const rounded = roundToNearestInterval(medDelta);
      return { seconds: rounded, hours: rounded / 3600, source: 'detected' };
    }
  }

  // 3. Fall back to exchange default
  const defaultSeconds = EXCHANGE_FUNDING_INTERVALS[exchange] || KNOWN_INTERVALS.EIGHT_HOUR;
  return { seconds: defaultSeconds, hours: defaultSeconds / 3600, source: 'default' };
}

/**
 * Round a delta (in seconds) to the nearest known funding interval
 */
function roundToNearestInterval(deltaSeconds: number): number {
  const knownIntervals = Object.values(KNOWN_INTERVALS);
  let closest = knownIntervals[0];
  let minDiff = Math.abs(deltaSeconds - closest);

  for (const interval of knownIntervals) {
    const diff = Math.abs(deltaSeconds - interval);
    if (diff < minDiff) {
      minDiff = diff;
      closest = interval;
    }
  }

  // If the delta is very close to a known interval (within 20%), use it
  if (minDiff / closest < 0.2) {
    return closest;
  }

  // Otherwise, round to the nearest standard interval
  if (deltaSeconds <= 5400) return KNOWN_INTERVALS.HOURLY;      // <= 1.5h → hourly
  if (deltaSeconds <= 21600) return KNOWN_INTERVALS.FOUR_HOUR;   // <= 6h → 4h
  if (deltaSeconds <= 36000) return KNOWN_INTERVALS.EIGHT_HOUR;  // <= 10h → 8h
  if (deltaSeconds <= 64800) return KNOWN_INTERVALS.TWELVE_HOUR; // <= 18h → 12h
  return KNOWN_INTERVALS.TWENTY_FOUR_HOUR;                        // > 18h → 24h
}

/**
 * Normalize a funding rate to hourly basis.
 * 
 * If a contract has 0.01% funding every 8 hours, the hourly rate is 0.00125%.
 * This allows fair comparison across contracts with different intervals.
 */
export function normalizeFundingRate(
  rawRate: number,
  intervalSeconds: number
): {
  perHour: number;
  perDay: number;
  annualized: number;
} {
  if (intervalSeconds <= 0 || !Number.isFinite(intervalSeconds)) {
    // Unknown interval, assume 8h as conservative default
    intervalSeconds = KNOWN_INTERVALS.EIGHT_HOUR;
  }

  const intervalsPerDay = 86400 / intervalSeconds; // e.g., 3 for 8h, 6 for 4h, 24 for 1h
  const intervalsPerYear = intervalsPerDay * 365;

  const perHour = rawRate / (intervalSeconds / 3600);
  const perDay = rawRate * intervalsPerDay;
  const annualized = rawRate * intervalsPerYear; // APR in decimal (not percentage)

  return {
    perHour,
    perDay,
    annualized,
  };
}

/**
 * Get a human-readable label for a funding interval
 */
export function getIntervalLabel(intervalSeconds: number | null): string {
  if (!intervalSeconds) return 'неизвестно';
  
  const hours = intervalSeconds / 3600;
  if (hours <= 1) return 'часовой (1h)';
  if (hours <= 4) return '4-часовой (4h)';
  if (hours <= 8) return '8-часовой (8h)';
  if (hours <= 12) return '12-часовой (12h)';
  if (hours <= 24) return 'суточный (24h)';
  return `${hours}ч`;
}

/**
 * Get yield category based on hourly rate
 */
export function getYieldCategory(ratePerHour: number): 'high' | 'medium' | 'low' {
  const absRate = Math.abs(ratePerHour);
  if (absRate >= 0.0001) return 'high';    // > 0.01% per hour
  if (absRate >= 0.00001) return 'medium'; // 0.001% - 0.01% per hour
  return 'low';
}

// ==================== Size Recommendations ====================

export function recommendSizePct(absFundingPerHour: number, volume24: number): number {
  // Use normalized hourly rate for recommendations
  if (absFundingPerHour >= 0.0001) return 3.0;   // > 0.01%/h
  if (absFundingPerHour >= 0.00005) return 2.0;   // > 0.005%/h
  if (absFundingPerHour >= 0.00002) return 1.5;   // > 0.002%/h
  return volume24 >= 5_000_000 ? 1.0 : 0.7;
}

// ==================== Labels ====================

export function liquidityLabel(volume24: number): string {
  if (volume24 >= 50_000_000) return 'очень высокая';
  if (volume24 >= 10_000_000) return 'высокая';
  if (volume24 >= 2_000_000) return 'средняя';
  return 'низкая';
}

export function volatilityProxyLabel(medHours: number | null): string {
  if (!medHours) return 'неизвестно';
  if (medHours <= 1) return 'высокая (hourly cycles)';
  if (medHours <= 2) return 'умеренная (2h)';
  return 'ниже среднего';
}

// ==================== Formatters ====================

export function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return 'N/A';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(2) + 'K';
  return num.toFixed(2);
}

export function formatFunding(funding: number | null | undefined): string {
  if (funding === null || funding === undefined) return 'N/A';
  return (funding * 100).toFixed(4) + '%';
}

export function formatInterval(seconds: number | null): string {
  if (!seconds) return 'N/A';
  const hours = seconds / 3600;
  if (hours === 1) return '1h';
  if (hours === 4) return '4h';
  if (hours === 8) return '8h';
  if (hours === 12) return '12h';
  if (hours === 24) return '24h';
  return `${hours}h`;
}

// ==================== Referral ====================

export function generateReferralLink(botUsername: string, referralCode: string): string {
  return `https://t.me/${botUsername}?start=ref_${referralCode}`;
}

// ==================== Recommendations ====================

export function generateRecommendations(
  list: ExchangeResult[],
  capital: number = 1000
): string {
  if (!Array.isArray(list) || list.length === 0) return 'Нет кандидатов для рекомендаций.';

  // Sort by normalized hourly rate (absolute value) for fair comparison
  const sorted = [...list].sort((a, b) => Math.abs(b.funding_rate_per_hour) - Math.abs(a.funding_rate_per_hour));
  const top = sorted.slice(0, 5);

  return top
    .map((x, idx) => {
      const ticker = `${x.exchange.toUpperCase()}:${x.contract}`;
      const rawPct = (x.currentFunding * 100).toFixed(4);
      const hourlyPct = (x.funding_rate_per_hour * 100).toFixed(6);
      const dailyPct = (x.funding_rate_per_day * 100).toFixed(4);
      const aprPct = (x.annualized_rate * 100).toFixed(2);
      
      const fundingSign = x.currentFunding > 0 ? 'положительный' : x.currentFunding < 0 ? 'отрицательный' : 'нейтральный';
      const earnSide = x.currentFunding > 0 ? 'шорты получают funding' : 'лонги получают funding';
      const liqLabel = liquidityLabel(x.volume_24h_settle);
      const intervalLabel = getIntervalLabel(x.funding_interval_seconds);
      
      const absHourly = Math.abs(x.funding_rate_per_hour);
      const sizePct = recommendSizePct(absHourly, x.volume_24h_settle);
      const notional = Math.round(((capital * sizePct) / 100) * 100) / 100;
      
      const recSide = x.currentFunding > 0
        ? 'SHORT perp + LONG spot (дельта-нейтрально)'
        : 'LONG perp + SHORT spot (или long perp с хеджем)';

      const intervalWarning = x.funding_interval_source === 'default' 
        ? '\n   ⚠️ Интервал неопределен, использован стандартный (8h)' 
        : '';

      return (
        `${idx + 1}. ${ticker}\n` +
        `   Сырая ставка: ${rawPct}% за ${intervalLabel} (${fundingSign})\n` +
        `   Нормализованная: ${hourlyPct}%/ч | ${dailyPct}%/д | ${aprPct}% APR\n` +
        `   Кто получает: ${earnSide}\n` +
        `   Объём 24ч: ${x.volume_24h_settle.toLocaleString()} USD (${liqLabel})\n` +
        `   Цена: ${x.mark_price}\n` +
        `   Рекомендация: ${recSide}\n` +
        `   Размер: ≈ ${sizePct}% от капитала (≈ ${notional} USDT)\n` +
        `   Риски: проскальзывание, basis-risk, волатильность.${intervalWarning}\n`
      );
    })
    .join('\n');
}
