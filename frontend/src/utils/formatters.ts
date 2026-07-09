export function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return 'N/A';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(2) + 'K';
  return num.toFixed(2);
}

export function formatFunding(funding: number | null | undefined): string {
  if (funding === null || funding === undefined) return 'N/A';
  return (funding * 100).toFixed(4) + '%';
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('ru-RU', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getRiskColor(level: string): string {
  switch (level) {
    case 'HIGH': return 'text-red-500 bg-red-100';
    case 'MEDIUM': return 'text-yellow-600 bg-yellow-100';
    case 'LOW': return 'text-green-500 bg-green-100';
    default: return 'text-gray-500 bg-gray-100';
  }
}

export function getFundingColor(funding: number): string {
  return funding > 0 ? 'text-green-500' : funding < 0 ? 'text-red-500' : 'text-gray-500';
}
