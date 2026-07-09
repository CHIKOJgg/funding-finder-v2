export interface ExchangeResult {
  exchange: string;
  contract: string;

  // Raw funding rate as reported by exchange
  currentFunding: number;

  // Funding interval detection
  funding_interval_seconds: number;
  funding_interval_hours: number;
  funding_interval_source: 'api' | 'detected' | 'default';

  // Normalized rates (critical for fair comparison)
  funding_rate_per_hour: number;
  funding_rate_per_day: number;
  annualized_rate: number;

  // Timing
  funding_next_apply: number;
  time_until_next_funding_seconds: number;

  // Market data
  mark_price: number;
  volume_24h_settle: number;

  // Legacy fields
  med_seconds: number | null;
  med_hours: number | null;
}

export interface ScanResult {
  // Normalized categories
  highYield: ExchangeResult[];
  mediumYield: ExchangeResult[];
  lowYield: ExchangeResult[];

  // Legacy fields
  hourly: ExchangeResult[];
  twohour: ExchangeResult[];
  fallback: ExchangeResult[];

  scanned: number;
  metrics: {
    minFundingUsed: number;
    totalOpportunities: number;
    exchanges: string[];
    averageIntervalHours: number;
    intervalDistribution: Record<string, number>;
  };
}

export interface ArbitrageOpportunity {
  pair: string;
  exchangeA: string;
  exchangeB: string;

  // Raw rates
  fundingA: number;
  fundingB: number;

  // Normalized rates
  fundingA_per_hour: number;
  fundingB_per_hour: number;
  fundingA_per_day: number;
  fundingB_per_day: number;

  // Interval info
  intervalA_hours: number;
  intervalB_hours: number;
  intervalMismatch: boolean;

  // Difference calculations
  difference: number;
  difference_per_day: number;
  percentageDiff: number;

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

export interface GeneralAlert {
  id: string;
  pair: string;
  exchange: string;
  condition: string;
  threshold: number;
  isActive: boolean;
  cooldown: number;
  lastTriggered: string | null;
  triggerCount: number;
  createdAt: string;
}

export interface ArbitrageAlert {
  id: string;
  pair: string;
  exchangeA: string;
  exchangeB: string;
  condition: string;
  threshold: number;
  direction: string;
  isActive: boolean;
  cooldown: number;
  lastTriggered: string | null;
  triggerCount: number;
  createdAt: string;
}

export interface User {
  id: string;
  telegramId: string;
  username?: string;
  firstName?: string;
  subscription: string;
  balance: number;
  referralCode: string;
  referrals: string[];
  trialScans: number;
}

export interface PaymentHistory {
  id: string;
  orderId: string | null;
  plan: string;
  amount: number;
  currency: string;
  date: string;
}

export interface Withdrawal {
  id: string;
  amount: number;
  currency: string;
  address: string;
  network: string;
  status: string;
  transactionId: string | null;
  createdAt: string;
}

export type PlanId = 'basic' | 'pro' | 'promax';
