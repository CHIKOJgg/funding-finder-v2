import { config } from '../config/index.js';
import { logger } from './logger.js';

interface FeatureFlag {
  name: string;
  enabled: boolean;
  description: string;
  minTier?: string; // minimum subscription tier required
}

const defaultFlags: Record<string, FeatureFlag> = {
  websocket: {
    name: 'websocket',
    enabled: true,
    description: 'Real-time WebSocket updates',
  },
  daily_summary: {
    name: 'daily_summary',
    enabled: true,
    description: 'Daily Telegram summary notifications',
    minTier: 'basic',
  },
  csv_export: {
    name: 'csv_export',
    enabled: true,
    description: 'CSV export of funding history',
    minTier: 'basic',
  },
  advanced_analytics: {
    name: 'advanced_analytics',
    enabled: true,
    description: 'Advanced analytics and trends',
    minTier: 'pro',
  },
  batch_alerts: {
    name: 'batch_alerts',
    enabled: true,
    description: 'Batch alert operations',
  },
  ai_analysis: {
    name: 'ai_analysis',
    enabled: true,
    description: 'AI-powered market analysis',
    minTier: 'pro',
  },
  arbitrage_detection: {
    name: 'arbitrage_detection',
    enabled: true,
    description: 'Cross-exchange arbitrage detection',
  },
  alert_evaluator: {
    name: 'alert_evaluator',
    enabled: true,
    description: 'Background alert evaluation',
  },
  api_docs: {
    name: 'api_docs',
    enabled: config.nodeEnv !== 'production',
    description: 'API documentation (Swagger UI)',
  },
};

class FeatureFlags {
  private flags: Map<string, FeatureFlag>;
  private overrides: Map<string, boolean> = new Map();

  constructor() {
    this.flags = new Map(Object.entries(defaultFlags));
    logger.info(`Feature flags initialized: ${this.flags.size} flags`);
  }

  isEnabled(flagName: string): boolean {
    const override = this.overrides.get(flagName);
    if (override !== undefined) return override;

    const flag = this.flags.get(flagName);
    return flag?.enabled ?? false;
  }

  setOverride(flagName: string, enabled: boolean): void {
    this.overrides.set(flagName, enabled);
    logger.info(`Feature flag override: ${flagName} = ${enabled}`);
  }

  clearOverride(flagName: string): void {
    this.overrides.delete(flagName);
  }

  getAllFlags(): Array<FeatureFlag & { overridden?: boolean }> {
    return Array.from(this.flags.values()).map((flag) => ({
      ...flag,
      overridden: this.overrides.has(flag.name),
    }));
  }

  getFlag(flagName: string): FeatureFlag | undefined {
    return this.flags.get(flagName);
  }

  // Check if user has access to a feature based on their tier
  hasAccess(flagName: string, userTier: string): boolean {
    if (!this.isEnabled(flagName)) return false;

    const flag = this.flags.get(flagName);
    if (!flag?.minTier) return true;

    const tierOrder = ['free', 'basic', 'pro', 'promax'];
    const userTierIndex = tierOrder.indexOf(userTier);
    const requiredTierIndex = tierOrder.indexOf(flag.minTier);

    return userTierIndex >= requiredTierIndex;
  }
}

export const featureFlags = new FeatureFlags();
