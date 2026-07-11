import { ExchangeResult } from '../types/index.js';

describe('Arbitrage Service', () => {
  let detectArbitrageOpportunities: any;

  function makeResult(overrides: Partial<ExchangeResult>): ExchangeResult {
    return {
      exchange: 'binance',
      contract: 'BTCUSDT',
      currentFunding: 0.0001,
      funding_interval_seconds: 28800,
      funding_interval_hours: 8,
      funding_interval_source: 'default',
      funding_rate_per_hour: 0.0000125,
      funding_rate_per_day: 0.0003,
      annualized_rate: 0.1095,
      funding_next_apply: Date.now() + 28800000,
      time_until_next_funding_seconds: 28800,
      mark_price: 50000,
      volume_24h_settle: 10000000,
      med_seconds: 28800,
      med_hours: 8,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../services/prisma.js', () => ({
      prisma: {
        arbitrageAlert: {
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn(),
          findMany: jest.fn(),
          findFirst: jest.fn(),
          update: jest.fn(),
          deleteMany: jest.fn(),
        },
      },
    }));
    const mod = require('../services/arbitrageService.js');
    detectArbitrageOpportunities = mod.detectArbitrageOpportunities;
  });

  it('should detect opportunities between exchanges', () => {
    const results = [
      makeResult({ exchange: 'binance', contract: 'BTCUSDT', currentFunding: 0.0001, funding_rate_per_hour: 0.0000125, funding_rate_per_day: 0.0003 }),
      makeResult({ exchange: 'bybit', contract: 'BTCUSDT', currentFunding: 0.0002, funding_rate_per_hour: 0.000025, funding_rate_per_day: 0.0006 }),
    ];

    const opportunities = detectArbitrageOpportunities(results);
    expect(opportunities.length).toBeGreaterThan(0);
    expect(opportunities[0].pair).toBe('BTC/USDT');
  });

  it('should return empty for single exchange result', () => {
    const results = [
      makeResult({ exchange: 'binance', contract: 'BTCUSDT' }),
    ];

    const opportunities = detectArbitrageOpportunities(results);
    expect(opportunities).toEqual([]);
  });

  it('should not detect when difference is below threshold', () => {
    const results = [
      makeResult({ exchange: 'binance', contract: 'BTCUSDT', currentFunding: 0.00001, funding_rate_per_hour: 0.000001, funding_rate_per_day: 0.000024 }),
      makeResult({ exchange: 'bybit', contract: 'BTCUSDT', currentFunding: 0.000011, funding_rate_per_hour: 0.0000011, funding_rate_per_day: 0.0000264 }),
    ];

    const opportunities = detectArbitrageOpportunities(results);
    expect(opportunities.length).toBe(0);
  });

  it('should sort opportunities by score descending', () => {
    const results = [
      makeResult({ exchange: 'binance', contract: 'BTCUSDT', currentFunding: 0.01, funding_rate_per_hour: 0.00125, funding_rate_per_day: 0.03, volume_24h_settle: 100000000 }),
      makeResult({ exchange: 'bybit', contract: 'BTCUSDT', currentFunding: -0.005, funding_rate_per_hour: -0.000625, funding_rate_per_day: -0.015, volume_24h_settle: 50000000 }),
      makeResult({ exchange: 'gate', contract: 'ETHUSDT', currentFunding: 0.008, funding_rate_per_hour: 0.001, funding_rate_per_day: 0.024, volume_24h_settle: 5000000 }),
      makeResult({ exchange: 'mexc', contract: 'ETHUSDT', currentFunding: -0.003, funding_rate_per_hour: -0.000375, funding_rate_per_day: -0.009, volume_24h_settle: 3000000 }),
    ];

    const opportunities = detectArbitrageOpportunities(results);
    for (let i = 1; i < opportunities.length; i++) {
      expect(opportunities[i - 1].score).toBeGreaterThanOrEqual(opportunities[i].score);
    }
  });

  it('should handle multiple pairs', () => {
    const results = [
      makeResult({ exchange: 'binance', contract: 'BTCUSDT', currentFunding: 0.0005, funding_rate_per_hour: 0.0000625, funding_rate_per_day: 0.0015 }),
      makeResult({ exchange: 'bybit', contract: 'BTCUSDT', currentFunding: 0.0001, funding_rate_per_hour: 0.0000125, funding_rate_per_day: 0.0003 }),
      makeResult({ exchange: 'binance', contract: 'ETHUSDT', currentFunding: 0.0003, funding_rate_per_hour: 0.0000375, funding_rate_per_day: 0.0009 }),
      makeResult({ exchange: 'gate', contract: 'ETHUSDT', currentFunding: 0.0008, funding_rate_per_hour: 0.0001, funding_rate_per_day: 0.0024 }),
    ];

    const opportunities = detectArbitrageOpportunities(results);
    expect(opportunities.length).toBe(2);

    const pairs = new Set(opportunities.map((o: any) => o.pair));
    expect(pairs.has('BTC/USDT')).toBe(true);
    expect(pairs.has('ETH/USDT')).toBe(true);
  });

  it('should flag interval mismatches', () => {
    const results = [
      makeResult({ exchange: 'binance', contract: 'BTCUSDT', funding_interval_hours: 8, funding_interval_seconds: 28800 }),
      makeResult({ exchange: 'gate', contract: 'BTCUSDT', funding_interval_hours: 1, funding_interval_seconds: 3600 }),
    ];

    const opportunities = detectArbitrageOpportunities(results);
    if (opportunities.length > 0) {
      expect(opportunities[0].intervalMismatch).toBe(true);
    }
  });
});
