import { describe, it, expect } from 'vitest';
import { formatNumber, formatPrice, formatFunding, formatDate, getRiskColor, getFundingColor } from '../utils/formatters';

describe('formatNumber', () => {
  it('formats millions', () => {
    expect(formatNumber(1_234_567)).toBe('1.23M');
  });

  it('formats thousands', () => {
    expect(formatNumber(1_234)).toBe('1.23K');
  });

  it('formats small numbers', () => {
    expect(formatNumber(123.45)).toBe('123.45');
  });

  it('returns N/A for null', () => {
    expect(formatNumber(null)).toBe('N/A');
  });

  it('returns N/A for undefined', () => {
    expect(formatNumber(undefined)).toBe('N/A');
  });
});

describe('formatPrice', () => {
  it('keeps full precision for very cheap coins', () => {
    expect(formatPrice(0.00001234)).toBe('0.00001234');
  });

  it('shows enough decimals for small sub-cent prices', () => {
    expect(formatPrice(0.00123)).toBe('0.00123');
  });

  it('trims trailing zeros on small prices', () => {
    expect(formatPrice(0.5)).toBe('0.5');
  });

  it('formats large prices with thousands separators', () => {
    expect(formatPrice(65000.5)).toBe('65,000.5');
  });

  it('does not abbreviate large prices', () => {
    expect(formatPrice(1_234_567)).toBe('1,234,567');
  });

  it('returns dash for null', () => {
    expect(formatPrice(null)).toBe('—');
  });

  it('returns dash for zero/negative', () => {
    expect(formatPrice(0)).toBe('—');
    expect(formatPrice(-1)).toBe('—');
  });
});

describe('formatFunding', () => {
  it('formats as percentage', () => {
    expect(formatFunding(0.0012)).toBe('0.1200%');
  });

  it('handles zero', () => {
    expect(formatFunding(0)).toBe('0.0000%');
  });

  it('returns N/A for null', () => {
    expect(formatFunding(null)).toBe('N/A');
  });
});

describe('formatDate', () => {
  it('formats a date string', () => {
    const result = formatDate('2026-07-10T14:30:00Z');
    expect(result).toContain('2026');
    expect(result).toContain('июл');
  });
});

describe('getRiskColor', () => {
  it('returns red for HIGH', () => {
    expect(getRiskColor('HIGH')).toContain('red');
  });

  it('returns yellow for MEDIUM', () => {
    expect(getRiskColor('MEDIUM')).toContain('yellow');
  });

  it('returns green for LOW', () => {
    expect(getRiskColor('LOW')).toContain('green');
  });

  it('returns gray for unknown', () => {
    expect(getRiskColor('UNKNOWN')).toContain('gray');
  });
});

describe('getFundingColor', () => {
  it('returns green for positive', () => {
    expect(getFundingColor(0.01)).toContain('green');
  });

  it('returns red for negative', () => {
    expect(getFundingColor(-0.01)).toContain('red');
  });

  it('returns gray for zero', () => {
    expect(getFundingColor(0)).toContain('gray');
  });
});
