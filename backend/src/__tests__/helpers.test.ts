import { normalizeFundingRate, detectFundingInterval, getYieldCategory, getIntervalLabel } from '../utils/helpers.js';

describe('normalizeFundingRate', () => {
  it('should normalize 8h rate to hourly', () => {
    const result = normalizeFundingRate(0.01, 28800);
    expect(result.perHour).toBeCloseTo(0.00125, 6);
    expect(result.perDay).toBeCloseTo(0.03, 6);
    expect(result.annualized).toBeCloseTo(10.95, 4);
  });

  it('should normalize 1h rate to hourly (same)', () => {
    const result = normalizeFundingRate(0.01, 3600);
    expect(result.perHour).toBeCloseTo(0.01, 6);
  });

  it('should normalize 4h rate to hourly', () => {
    const result = normalizeFundingRate(0.01, 14400);
    expect(result.perHour).toBeCloseTo(0.0025, 6);
  });

  it('should handle zero interval (default to 8h)', () => {
    const result = normalizeFundingRate(0.01, 0);
    expect(result.perHour).toBeCloseTo(0.00125, 6);
  });

  it('should handle negative interval (default to 8h)', () => {
    const result = normalizeFundingRate(0.01, -100);
    expect(result.perHour).toBeCloseTo(0.00125, 6);
  });

  it('should handle zero rate', () => {
    const result = normalizeFundingRate(0, 28800);
    expect(result.perHour).toBe(0);
    expect(result.perDay).toBe(0);
    expect(result.annualized).toBe(0);
  });

  it('should handle negative rate', () => {
    const result = normalizeFundingRate(-0.01, 28800);
    expect(result.perHour).toBeCloseTo(-0.00125, 6);
  });
});

describe('detectFundingInterval', () => {
  it('should use API interval when provided', () => {
    const result = detectFundingInterval('bybit', undefined, 480);
    expect(result.seconds).toBe(28800);
    expect(result.hours).toBe(8);
    expect(result.source).toBe('api');
  });

  it('should detect from history timestamps', () => {
    const now = Date.now();
    const timestamps = [
      now - 28800000,
      now - 57600000,
      now - 86400000,
    ];
    const result = detectFundingInterval('gate', timestamps);
    expect(result.source).toBe('detected');
  });

  it('should fall back to exchange default', () => {
    const result = detectFundingInterval('binance');
    expect(result.seconds).toBe(28800);
    expect(result.source).toBe('default');
  });

  it('should use 8h as default for unknown exchange', () => {
    const result = detectFundingInterval('unknown_exchange');
    expect(result.seconds).toBe(28800);
    expect(result.source).toBe('default');
  });
});

describe('getYieldCategory', () => {
  it('should categorize high yield', () => {
    expect(getYieldCategory(0.0001)).toBe('high');
    expect(getYieldCategory(0.001)).toBe('high');
  });

  it('should categorize medium yield', () => {
    expect(getYieldCategory(0.00001)).toBe('medium');
    expect(getYieldCategory(0.00005)).toBe('medium');
  });

  it('should categorize low yield', () => {
    expect(getYieldCategory(0.000001)).toBe('low');
    expect(getYieldCategory(0)).toBe('low');
  });

  it('should handle negative rates', () => {
    expect(getYieldCategory(-0.0001)).toBe('high');
    expect(getYieldCategory(-0.00001)).toBe('medium');
    expect(getYieldCategory(-0.000001)).toBe('low');
  });
});

describe('getIntervalLabel', () => {
  it('should return correct labels', () => {
    expect(getIntervalLabel(3600)).toBe('часовой (1h)');
    expect(getIntervalLabel(14400)).toBe('4-часовой (4h)');
    expect(getIntervalLabel(28800)).toBe('8-часовой (8h)');
    expect(getIntervalLabel(43200)).toBe('12-часовой (12h)');
    expect(getIntervalLabel(86400)).toBe('суточный (24h)');
  });

  it('should return unknown for null', () => {
    expect(getIntervalLabel(null)).toBe('неизвестно');
  });

  it('should return custom label for non-standard interval', () => {
    const result = getIntervalLabel(7200);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
