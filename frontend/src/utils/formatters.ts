export function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return 'N/A';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(2) + 'K';
  // Use browser locale (respects ru/tr/vi) instead of hardcoded en-US
  if (Number.isInteger(num)) return num.toLocaleString(undefined);
  return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Exact price formatting: preserves full precision even for very cheap coins
// (e.g. 0.00001234 instead of "0.00"). Large prices get thousands separators;
// small prices get as many decimals as needed to show real significant digits.
export function formatPrice(num: number | null | undefined): string {
  if (num === null || num === undefined) return '—';
  if (!isFinite(num) || num <= 0) return '—';
  if (num >= 1) {
    return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  const decimals = Math.min(12, Math.max(2, Math.ceil(-Math.log10(num)) + 3));
  return num.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatFunding(funding: number | null | undefined): string {
  if (funding === null || funding === undefined) return 'N/A';
  return (funding * 100).toFixed(4) + '%';
}

export function formatDate(date: string | Date): string {
  // Exchange timestamps are UTC; force UTC so +3 user doesn't see +3h shift
  return new Date(date).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
}

export function getRiskColor(level: string): string {
  switch (level) {
    case 'HIGH': return 'text-[var(--red)] bg-[var(--red-soft)]';
    case 'MEDIUM': return 'text-[var(--amber)] bg-[var(--amber-soft)]';
    case 'LOW': return 'text-[var(--green)] bg-[var(--green-soft)]';
    default: return 'text-[var(--text2)] bg-[var(--bg1)]';
  }
}

export function getFundingColor(funding: number): string {
  return funding > 0 ? 'text-[var(--green)]' : funding < 0 ? 'text-[var(--red)]' : 'text-[var(--text2)]';
}
