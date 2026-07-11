// Estimates the next funding settlement time for a perpetual pair.
//
// Most exchanges settle funding on fixed UTC boundaries that are whole
// multiples of the interval since the Unix epoch (e.g. 8h -> 00:00/08:00/16:00
// UTC, 4h -> every 4h). We align to those boundaries. This is exact for
// Binance/OKX/MEXC 8h contracts and a close approximation for exchanges whose
// intervals can vary (Bybit) — good enough to tell the user "close before X".
export function getNextFundingTime(intervalHours: number, now: number = Date.now()): number {
  if (!intervalHours || intervalHours <= 0) return 0;
  const stepMs = intervalHours * 3600 * 1000;
  const epoch = Date.UTC(1970, 0, 1);
  const next = Math.ceil((now - epoch) / stepMs) * stepMs + epoch;
  return next;
}

export function getPrevFundingTime(intervalHours: number, now: number = Date.now()): number {
  if (!intervalHours || intervalHours <= 0) return 0;
  const stepMs = intervalHours * 3600 * 1000;
  const epoch = Date.UTC(1970, 0, 1);
  const prev = Math.floor((now - epoch) / stepMs) * stepMs + epoch;
  return prev;
}

export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return '00:00:00';
  const totalSec = Math.floor(msRemaining / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
