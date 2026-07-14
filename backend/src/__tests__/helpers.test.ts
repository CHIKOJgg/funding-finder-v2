/**
 * Unit tests for src/utils/helpers.ts
 */
import {
  sleep,
  normalizeFundingRate,
  median,
  detectFundingInterval,
  toExchangeResult,
  getYieldCategory,
  recommendSizePct,
} from '../utils/helpers.js';
import { KNOWN_INTERVALS } from '../types/index.js';

describe('sleep', () => {
  test('resolves after the given delay (fake timers)', () => {
    jest.useFakeTimers();
    try {
      const p = sleep(100);
      let resolved = false;
      p.then(() => {
        resolved = true;
      });
      expect(resolved).toBe(false);
      jest.advanceTimersByTime(100);
      // microtasks flush synchronously after timer advance in fake-timer run
      return p.then(() => {
        expect(true).toBe(true);
      });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('normalizeFundingRate', () => {
  const EIGHT_H = KNOWN_INTERVALS.EIGHT_HOUR; // 28800
  const ONE_H = KNOWN_INTERVALS.HOURLY; // 3600

  test('8h interval: hourly/day/annualized math', () => {
    const r = normalizeFundingRate(0.0001, EIGHT_H);
    // perHour = 0.0001 / (28800/3600) = 0.0001 / 8
    expect(r.perHour).toBeCloseTo(0.0000125, 12);
    expect(r.perDay).toBeCloseTo(0.0001 * 3, 12); // 3 settlements / day
    expect(r.annualized).toBeCloseTo(0.0001 * 3 * 365, 12); // 0.1095
  });

  test('1h interval: hourly/day/annualized math', () => {
    const r = normalizeFundingRate(0.0001, ONE_H);
    expect(r.perHour).toBeCloseTo(0.0001, 12);
    expect(r.perDay).toBeCloseTo(0.0001 * 24, 12); // 0.0024
    expect(r.annualized).toBeCloseTo(0.0001 * 24 * 365, 12); // 0.876
  });

  test('zero rate yields all zeros', () => {
    const r = normalizeFundingRate(0, EIGHT_H);
    expect(r.perHour).toBe(0);
    expect(r.perDay).toBe(0);
    expect(r.annualized).toBe(0);
  });

  test('negative rate preserved with sign', () => {
    const r = normalizeFundingRate(-0.0001, EIGHT_H);
    expect(r.perHour).toBeCloseTo(-0.0000125, 12);
    expect(r.perDay).toBeCloseTo(-0.0003, 12);
    expect(r.annualized).toBeCloseTo(-0.1095, 12);
  });

  test('non-positive interval falls back to 8h default', () => {
    const r = normalizeFundingRate(0.0001, -1);
    expect(r.perHour).toBeCloseTo(0.0000125, 12);
    const r2 = normalizeFundingRate(0.0001, 0);
    expect(r2.perHour).toBeCloseTo(0.0000125, 12);
    const r3 = normalizeFundingRate(0.0001, NaN);
    expect(r3.perHour).toBeCloseTo(0.0000125, 12);
  });
});

describe('median', () => {
  test('returns null for empty', () => {
    expect(median([])).toBeNull();
  });
  test('odd length', () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  test('even length averages the two middle', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('detectFundingInterval', () => {
  test('uses API interval when provided', () => {
    expect(detectFundingInterval('binance', undefined, 60).seconds).toBe(3600);
  });
  test('detects from history timestamps', () => {
    const ts = [0, 28800, 57600, 86400];
    const res = detectFundingInterval('unknown', ts);
    expect(res.source).toBe('detected');
    expect(res.seconds).toBe(KNOWN_INTERVALS.EIGHT_HOUR);
  });
  test('falls back to exchange default', () => {
    const res = detectFundingInterval('binance');
    expect(res.source).toBe('default');
    expect(res.seconds).toBe(KNOWN_INTERVALS.EIGHT_HOUR);
  });
  test('falls back to 8h for unknown exchange with no data', () => {
    const res = detectFundingInterval('mystery');
    expect(res.seconds).toBe(KNOWN_INTERVALS.EIGHT_HOUR);
  });
});

describe('toExchangeResult', () => {
  test('normalizes and populates all fields', () => {
    const now = Date.now();
    const res = toExchangeResult({
      exchange: 'binance',
      contract: 'BTCUSDT',
      currentFunding: 0.0001,
      fundingIntervalSeconds: KNOWN_INTERVALS.EIGHT_HOUR,
      fundingNextApply: now + 3600_000,
      markPrice: 50000,
      volume24hSettle: 1_000_000,
    });
    expect(res.exchange).toBe('binance');
    expect(res.funding_rate_per_hour).toBeCloseTo(0.0000125, 12);
    expect(res.funding_rate_per_day).toBeCloseTo(0.0003, 12);
    expect(res.annualized_rate).toBeCloseTo(0.1095, 12);
    expect(res.time_until_next_funding_seconds).toBeGreaterThan(3500);
  });
});

describe('getYieldCategory', () => {
  test('categorizes by absolute hourly rate', () => {
    expect(getYieldCategory(0.0002)).toBe('high');
    expect(getYieldCategory(-0.0002)).toBe('high');
    expect(getYieldCategory(0.00005)).toBe('medium');
    expect(getYieldCategory(0.000001)).toBe('low');
  });
});

describe('recommendSizePct', () => {
  test('larger size for higher hourly rate', () => {
    expect(recommendSizePct(0.0002, 1_000_000)).toBe(3.0); // high rate
    expect(recommendSizePct(0.000001, 6_000_000)).toBe(1.0); // low rate, high volume
    expect(recommendSizePct(0.000001, 1_000)).toBe(0.7); // low rate, low volume
  });
});
