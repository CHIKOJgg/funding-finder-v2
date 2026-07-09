// Known funding intervals by exchange (in seconds)
// These are the standard intervals each exchange uses
export const EXCHANGE_FUNDING_INTERVALS: Record<string, number> = {
  binance: 28800,   // 8 hours fixed
  okx: 28800,       // 8 hours fixed
  mexc: 28800,      // 8 hours fixed
  bybit: 28800,     // 8 hours default (but can be 4h, 1h, 2h, 4h, 8h)
  gate: 14400,      // varies: 1h, 4h, 8h, 24h per contract
};

// Funding intervals commonly seen
export const KNOWN_INTERVALS = {
  HOURLY: 3600,           // 1 hour
  FOUR_HOUR: 14400,       // 4 hours
  EIGHT_HOUR: 28800,      // 8 hours
  TWELVE_HOUR: 43200,     // 12 hours
  TWENTY_FOUR_HOUR: 86400, // 24 hours
} as const;

export interface ExchangeResult {
  exchange: string;
  contract: string;
  
  // Raw funding rate as reported by exchange
  currentFunding: number;
  
  // Funding interval detection
  funding_interval_seconds: number;   // detected interval in seconds
  funding_interval_hours: number;     // detected interval in hours
  funding_interval_source: 'api' | 'detected' | 'default'; // how we got the interval
  
  // Normalized rates (critical for fair comparison)
  funding_rate_per_hour: number;             // rate normalized to 1 hour
  funding_rate_per_day: number;              // rate normalized to 24 hours (3 settlements for 8h)
  annualized_rate: number;                   // annualized rate (APR)
  
  // Timing
  funding_next_apply: number;                // timestamp of next funding
  time_until_next_funding_seconds: number; // seconds until next funding
  
  // Market data
  mark_price: number;
  volume_24h_settle: number;
  
  // Legacy fields for backward compatibility
  med_seconds: number | null;
  med_hours: number | null;
}

export interface ScanResult {
  // Grouped by normalized hourly rate for fair comparison
  highYield: ExchangeResult[];      // > 0.01% per hour
  mediumYield: ExchangeResult[];    // 0.001% - 0.01% per hour
  lowYield: ExchangeResult[];       // < 0.001% per hour
  
  // Legacy fields (deprecated, use normalized groups)
  hourly: ExchangeResult[];
  twohour: ExchangeResult[];
  fallback: ExchangeResult[];
  
  scanned: number;
  metrics: {
    minFundingUsed: number;
    totalOpportunities: number;
    exchanges: string[];
    averageIntervalHours: number;  // average funding interval across all results
    intervalDistribution: Record<string, number>; // count by interval
  };
}

export interface ArbitrageOpportunity {
  pair: string;
  exchangeA: string;
  exchangeB: string;
  
  // Raw rates
  fundingA: number;
  fundingB: number;
  
  // Normalized rates for fair comparison
  fundingA_per_hour: number;
  fundingB_per_hour: number;
  fundingA_per_day: number;
  fundingB_per_day: number;
  
  // Interval info
  intervalA_hours: number;
  intervalB_hours: number;
  intervalMismatch: boolean;  // true if intervals differ significantly
  
  // Difference calculations (using normalized rates)
  difference: number;          // absolute difference in hourly rates
  difference_per_day: number;  // absolute difference in daily rates
  percentageDiff: number;      // relative percentage difference
  
  volumeA: number;
  volumeB: number;
  markPriceA?: number;
  markPriceB?: number;
  opportunity: string;
  
  profit: ProfitCalculation;
  risk: RiskAssessment;
  score: number;
  timestamp: number;
}

export interface ProfitCalculation {
  grossHourly: number;
  netHourly: number;
  grossDaily: number;
  netDaily: number;
  fees: number;
  slippage: number;
  hourlyReturn: number;
  dailyReturn: number;
  weeklyReturn: number;
  annualReturn: number;
  netWeekly: number;
  netAnnual: number;
}

export interface RiskAssessment {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
}

export interface ExchangeConfig {
  name: string;
  baseUrl: string;
  concurrency: number;
  timeout: number;
  defaultIntervalSeconds: number;
}

export interface Plan {
  price: number;
  name: string;
  features: string[];
}

export type PlanId = 'basic' | 'pro' | 'promax';

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}
