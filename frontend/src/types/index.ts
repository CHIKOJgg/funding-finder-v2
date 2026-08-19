export interface TelegramWebApp {
  initData?: string;
  initDataUnsafe?: {
    user?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
    start_param?: string;
  };
  expand?: () => void;
  enableClosingConfirmation?: () => void;
  openLink?: (url: string) => void;
  close?: () => void;
  ready?: () => void;
  setBackgroundColor?: (color: string) => void;
  setHeaderColor?: (color: string | { color: string }) => void;
  version?: string;
  viewportStableHeight?: number;
  safeAreaInset?: { top: number; bottom: number; left: number; right: number };
  contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number };
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (callback: () => void) => void;
    offClick?: (callback: () => void) => void;
  };
  MainButton?: {
    setText: (text: string) => void;
    setParams?: (params: {
      color?: string;
      text_color?: string;
      text?: string;
      is_active?: boolean;
      is_visible?: boolean;
      is_progress_visible?: boolean;
    }) => void;
    show: () => void;
    hide: () => void;
    onClick: (callback: () => void) => void;
    offClick: (callback: () => void) => void;
  };
  SecondaryButton?: {
    setParams?: (params: {
      color?: string;
      text_color?: string;
      text?: string;
      is_visible?: boolean;
      is_active?: boolean;
    }) => void;
    show?: () => void;
    hide?: () => void;
    onClick?: (callback: () => void) => void;
    offClick?: (callback: () => void) => void;
  };
  colorScheme?: string;
  themeParams?: {
    bg_color?: string;
    text_color?: string;
    hint_color?: string;
    link_color?: string;
    button_color?: string;
    button_text_color?: string;
  };
  CloudStorage?: {
    setItem: (key: string, value: string, callback?: (error: Error | null, result?: boolean) => void) => void;
    getItem: (key: string, callback: (error: Error | null, result?: string) => void) => void;
    removeItem: (key: string, callback?: (error: Error | null, result?: boolean) => void) => void;
  };
  onEvent?: (eventType: string, callback: (payload?: any) => void) => void;
  offEvent?: (eventType: string, callback: (payload?: any) => void) => void;
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged: () => void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
    ethereum?: any;
    google?: any;
  }
}

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

  // Open Interest
  openInterest?: number;
  openInterestUsd?: number;

  // Long/Short Ratio
  longShortRatio?: number;
  longAccountRatio?: number;
  shortAccountRatio?: number;

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
  persistenceGrade?: string;

  // Settlement Timing & Synchronization
  nextApplyA?: number;             // Epoch ms of next funding payout on exchange A
  nextApplyB?: number;             // Epoch ms of next funding payout on exchange B
  sameSettlementTime?: boolean;    // True if both exchanges settle at the exact same time
  settlementDeltaMinutes?: number; // Time difference between settlement cycles in minutes
  sameInterval?: boolean;          // True if intervalA_hours === intervalB_hours

  // New metrics v2
  netApr?: number;
  paybackDays?: number;
  stabilityGrade?: string;
  aliveHours?: number;
  winRate30d?: number;
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
  email?: string;
  walletAddress?: string;
  authProvider?: string;
  subscription: string;
  role?: string;
  balance: number;
  referralCode: string;
  referrals: string[];
  trialScans: number;
  trialUsed?: boolean;
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

export type PlanId = 'pro' | 'proplus';

export interface TrialStatus {
  active: boolean;
  used: boolean;
  endsAt: string | null;
  daysLeft: number;
  hoursLeft: number;
}

export interface WatchlistItem {
  id: string;
  userId: string;
  exchange: string;
  pair: string;
  createdAt: string;
}

export interface PortfolioPosition {
  id: string;
  userId: string;
  exchange: string;
  pair: string;
  side: 'long' | 'short';
  sizeUsd: number;
  leverage: number;
  openedAt: string;
  closedAt: string | null;
  ratePerHour?: number;
  pnl?: {
    hoursHeld: number;
    fundingIncome: number;
    annualizedPct: number;
    projectedYearly: number;
  };
}

export interface FundingEvent {
  exchange: string;
  pair: string;
  ratePerHour: number;
  ratePerDay: number;
  annualized: number;
  nextApply: number;
  secondsUntil: number;
}

export interface AprResult {
  exchange: string;
  contract: string;
  periodDays: number;
  avgRate: number;
  apr: number;
  intervalHours: number;
  settlementsPerYear: number;
  dataPoints: number;
  series: { timestamp: string; funding: number }[] | null;
}
