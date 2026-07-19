import {
  toExchangeResult,
  median,
  sleep,
  detectFundingInterval,
  normalizeFundingRate,
  getIntervalLabel,
  getYieldCategory,
  recommendSizePct,
  liquidityLabel,
  volatilityProxyLabel,
  formatNumber,
  formatFunding,
  formatInterval,
  generateReferralLink,
  generateRecommendations,
} from '../utils/helpers.js';

describe('helpers — toExchangeResult', () => {
  it('builds a full ExchangeResult from minimal input', () => {
    const r = toExchangeResult({
      exchange: 'binance',
      contract: 'BTCUSDT',
      currentFunding: 0.0001,
      fundingIntervalSeconds: 28800,
      fundingIntervalSource: 'api',
      fundingNextApply: Date.now() + 3600_000,
      markPrice: 60000,
      volume24hSettle: 5_000_000,
    });
    expect(r.exchange).toBe('binance');
    expect(r.funding_rate_per_hour).toBeCloseTo(0.0001 / 8);
    expect(r.funding_rate_per_day).toBeCloseTo(0.0001 * 3);
    expect(r.annualized_rate).toBeCloseTo(0.0001 * 3 * 365);
    expect(r.funding_interval_hours).toBe(8);
    expect(r.time_until_next_funding_seconds).toBeGreaterThan(0);
    expect(r.volume_24h_settle).toBe(5_000_000);
  });

  it('falls back to 8h when interval is 0/negative and clamps time_until_next to 0', () => {
    const r = toExchangeResult({
      exchange: 'okx',
      contract: 'ETH-USDT-SWAP',
      currentFunding: -0.0002,
      fundingIntervalSeconds: 0,
      fundingNextApply: Date.now() - 5000,
      markPrice: 3000,
      volume24hSettle: 1_000_000,
    });
    expect(r.funding_interval_seconds).toBe(28800);
    expect(r.funding_interval_source).toBe('default');
    expect(r.time_until_next_funding_seconds).toBe(0);
  });

  it('honours fundingIntervalSource override', () => {
    const r = toExchangeResult({
      exchange: 'gate',
      contract: 'BTC_USDT',
      currentFunding: 0.0003,
      fundingIntervalSeconds: 14400,
      fundingIntervalSource: 'detected',
      fundingNextApply: 0,
      markPrice: 1,
      volume24hSettle: 0,
    });
    expect(r.funding_interval_source).toBe('detected');
  });
});

describe('helpers — median', () => {
  it('returns null for empty / null input', () => {
    expect(median([])).toBeNull();
    expect(median(null as any)).toBeNull();
  });

  it('returns middle element for odd-length', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages two middle elements for even-length', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('helpers — sleep', () => {
  it('resolves after the given delay', async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });
});

describe('helpers — detectFundingInterval', () => {
  it('uses api interval when provided', () => {
    const r = detectFundingInterval('binance', undefined, 120);
    expect(r.seconds).toBe(7200);
    expect(r.source).toBe('api');
  });

  it('detects from history timestamps (exact known interval)', () => {
    const now = Date.now();
    const ts = [now - 3 * 28800_000, now - 2 * 28800_000, now - 28800_000, now];
    const r = detectFundingInterval('gate', ts);
    expect(r.seconds).toBe(28800);
    expect(r.source).toBe('detected');
  });

  it('rounds delta within 20% to a known interval', () => {
    const now = Date.now();
    // ~4h deltas
    const ts = [now - 2 * 14400_000, now - 14400_000, now];
    const r = detectFundingInterval('gate', ts);
    expect(r.seconds).toBe(14400);
  });

  it('falls back to coarse buckets when delta is far from known intervals', () => {
    // delta ~2h (7200) -> <=5400? no; <=21600 -> FOUR_HOUR
    const now = Date.now();
    const ts = [now - 2 * 7200_000, now - 7200_000, now];
    expect(detectFundingInterval('gate', ts).seconds).toBe(14400);
    // delta ~10h -> <=36000 -> EIGHT_HOUR
    const ts2 = [now - 2 * 36000_000, now - 36000_000, now];
    expect(detectFundingInterval('gate', ts2).seconds).toBe(28800);
    // delta ~18h -> <=64800 -> TWELVE_HOUR
    const ts3 = [now - 2 * 64800_000, now - 64800_000, now];
    expect(detectFundingInterval('gate', ts3).seconds).toBe(43200);
    // delta ~30h -> 24h
    const ts4 = [now - 2 * 108000_000, now - 108000_000, now];
    expect(detectFundingInterval('gate', ts4).seconds).toBe(86400);
    // delta ~2000s -> <=5400 -> HOURLY
    const ts5 = [now - 2 * 2000_000, now - 2000_000, now];
    expect(detectFundingInterval('gate', ts5).seconds).toBe(3600);
  });

  it('falls back to exchange default when no signal available', () => {
    expect(detectFundingInterval('hyperliquid').seconds).toBe(3600);
    expect(detectFundingInterval('unknown-exchange').seconds).toBe(28800);
  });

  it('handles history with zero/negative median delta gracefully', () => {
    // all identical timestamps -> delta 0 -> falls through to default
    const now = Date.now();
    const r = detectFundingInterval('binance', [now, now, now]);
    expect(r.source).toBe('default');
  });
});

describe('helpers — normalizeFundingRate', () => {
  it('normalizes per-hour/day/annualized for 8h interval', () => {
    const n = normalizeFundingRate(0.0001, 28800);
    expect(n.perHour).toBeCloseTo(0.0001 / 8);
    expect(n.perDay).toBeCloseTo(0.0001 * 3);
    expect(n.annualized).toBeCloseTo(0.0001 * 3 * 365);
  });

  it('handles 1h, 4h, 24h intervals', () => {
    expect(normalizeFundingRate(0.001, 3600).perDay).toBeCloseTo(0.024);
    expect(normalizeFundingRate(0.001, 14400).perDay).toBeCloseTo(0.006);
    expect(normalizeFundingRate(0.001, 86400).perDay).toBeCloseTo(0.001);
  });

  it('falls back to 8h for non-positive / non-finite interval', () => {
    const zero = normalizeFundingRate(0.0001, 0);
    expect(zero.perHour).toBeCloseTo(0.0001 / 8);
    const neg = normalizeFundingRate(0.0001, -100);
    expect(neg.perDay).toBeCloseTo(0.0001 * 3);
    const inf = normalizeFundingRate(0.0001, Infinity);
    expect(inf.annualized).toBeCloseTo(0.0001 * 3 * 365);
  });
});

describe('helpers — getIntervalLabel', () => {
  it('labels known intervals and edge cases', () => {
    expect(getIntervalLabel(null)).toBe('неизвестно');
    expect(getIntervalLabel(0)).toBe('неизвестно');
    expect(getIntervalLabel(3600)).toBe('часовой (1h)');
    expect(getIntervalLabel(14400)).toBe('4-часовой (4h)');
    expect(getIntervalLabel(28800)).toBe('8-часовой (8h)');
    expect(getIntervalLabel(43200)).toBe('12-часовой (12h)');
    expect(getIntervalLabel(86400)).toBe('суточный (24h)');
    expect(getIntervalLabel(100000)).toBe('27.77777777777778ч');
  });
});

describe('helpers — getYieldCategory', () => {
  it('classifies by hourly rate magnitude', () => {
    expect(getYieldCategory(0.0002)).toBe('high');
    expect(getYieldCategory(-0.0002)).toBe('high');
    expect(getYieldCategory(0.00005)).toBe('medium');
    expect(getYieldCategory(-0.00005)).toBe('medium');
    expect(getYieldCategory(0.000005)).toBe('low');
    expect(getYieldCategory(0)).toBe('low');
  });
});

describe('helpers — recommendSizePct', () => {
  it('scales with funding rate and liquidity', () => {
    expect(recommendSizePct(0.0002, 10_000_000)).toBe(3.0);
    expect(recommendSizePct(0.00005, 10_000_000)).toBe(2.0);
    expect(recommendSizePct(0.00002, 10_000_000)).toBe(1.5);
    expect(recommendSizePct(0.000005, 10_000_000)).toBe(1.0);
    expect(recommendSizePct(0.000005, 1000)).toBe(0.7);
  });
});

describe('helpers — liquidityLabel', () => {
  it('labels by 24h volume', () => {
    expect(liquidityLabel(100_000_000)).toBe('очень высокая');
    expect(liquidityLabel(20_000_000)).toBe('высокая');
    expect(liquidityLabel(5_000_000)).toBe('средняя');
    expect(liquidityLabel(1_000_000)).toBe('низкая');
  });
});

describe('helpers — volatilityProxyLabel', () => {
  it('labels by median hours', () => {
    expect(volatilityProxyLabel(null)).toBe('неизвестно');
    expect(volatilityProxyLabel(1)).toBe('высокая (hourly cycles)');
    expect(volatilityProxyLabel(2)).toBe('умеренная (2h)');
    expect(volatilityProxyLabel(8)).toBe('ниже среднего');
  });
});

describe('helpers — formatters', () => {
  it('formatNumber handles null/undefined and magnitudes', () => {
    expect(formatNumber(null)).toBe('N/A');
    expect(formatNumber(undefined)).toBe('N/A');
    expect(formatNumber(500)).toBe('500.00');
    expect(formatNumber(1_500)).toBe('1.50K');
    expect(formatNumber(2_500_000)).toBe('2.50M');
  });

  it('formatFunding handles null/undefined and percent', () => {
    expect(formatFunding(null)).toBe('N/A');
    expect(formatFunding(undefined)).toBe('N/A');
    expect(formatFunding(0.0001)).toBe('0.0100%');
  });

  it('formatInterval handles zero and known values', () => {
    expect(formatInterval(0)).toBe('N/A');
    expect(formatInterval(3600)).toBe('1h');
    expect(formatInterval(14400)).toBe('4h');
    expect(formatInterval(28800)).toBe('8h');
    expect(formatInterval(43200)).toBe('12h');
    expect(formatInterval(86400)).toBe('24h');
    expect(formatInterval(50000)).toBe('13.88888888888889h');
  });
});

describe('helpers — generateReferralLink', () => {
  it('builds a telegram ref link', () => {
    expect(generateReferralLink('mybot', 'CODE123')).toBe('https://t.me/mybot?start=ref_CODE123');
  });
});

describe('helpers — generateRecommendations', () => {
  it('returns a message when input is empty/non-array', () => {
    expect(generateRecommendations([])).toBe('Нет кандидатов для рекомендаций.');
    expect((generateRecommendations as any)(null)).toBe('Нет кандидатов для рекомендаций.');
  });

  it('sorts by absolute hourly rate and emits full detail for top 5', () => {
    const list = [
      {
        exchange: 'binance', contract: 'BTCUSDT', currentFunding: 0.0001,
        funding_rate_per_hour: 0.0002, funding_rate_per_day: 0.0006, annualized_rate: 0.2,
        volume_24h_settle: 10_000_000, mark_price: 60000, funding_interval_seconds: 28800,
        funding_interval_source: 'api' as const,
      },
      {
        exchange: 'okx', contract: 'ETH-USDT-SWAP', currentFunding: -0.0002,
        funding_rate_per_hour: -0.0003, funding_rate_per_day: -0.0009, annualized_rate: -0.3,
        volume_24h_settle: 3_000_000, mark_price: 3000, funding_interval_seconds: 28800,
        funding_interval_source: 'default' as const,
      },
    ] as any;
    const out = generateRecommendations(list, 5000);
    expect(out).toContain('OKX');
    expect(out).toContain('SHORT perp + LONG spot');
    expect(out).toContain('⚠️');
  });
});
