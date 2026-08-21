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
    // Locale-aware: ru→123,45 vs en→123.45 — accept either but must contain 123 and 45
    const out = formatNumber(123.45);
    expect(out.replace(/[\s\u00A0]/g, '')).toMatch(/123[.,]45/);
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
    const out = formatPrice(65000.5);
    // Accept en-US 65,000.5 or ru 65 000,5 — strip separators and check numeric value
    const normalized = out.replace(/[\s\u00A0,]/g, '').replace(',', '.');
    // 65000.5 → digits check
    expect(normalized).toContain('65000');
    expect(out).toMatch(/65/);
  });

  it('does not abbreviate large prices', () => {
    const out = formatPrice(1_234_567);
    // Should contain 1234567 digits with separators, not abbreviated M/K
    expect(out.replace(/[\s\u00A0,]/g, '')).toContain('1234567');
    expect(out).not.toContain('M');
    expect(out).not.toContain('K');
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

  it('returns amber for MEDIUM', () => {
    expect(getRiskColor('MEDIUM')).toContain('amber');
  });

  it('returns green for LOW', () => {
    expect(getRiskColor('LOW')).toContain('green');
  });

  it('returns neutral for unknown', () => {
    expect(getRiskColor('UNKNOWN')).toContain('text2');
  });
});

describe('getFundingColor', () => {
  it('returns green for positive', () => {
    expect(getFundingColor(0.01)).toContain('green');
  });

  it('returns red for negative', () => {
    expect(getFundingColor(-0.01)).toContain('red');
  });

  it('returns neutral for zero', () => {
    expect(getFundingColor(0)).toContain('text2');
  });
});
