import { useEffect, useState } from 'react';
import { getNextFundingTime, formatCountdown } from '../utils/funding';
import { useT } from '../i18n';

interface CountdownTimerProps {
  intervalHours: number;
  className?: string;
  showLabel?: boolean;
  showProgress?: boolean;
}

// Live "time until next funding" badge. Re-renders every second so the user
// knows exactly when to close the position and collect the rate.
export function CountdownTimer({ intervalHours, className, showProgress = false }: CountdownTimerProps) {
  const [now, setNow] = useState(() => Date.now());
  const t = useT();

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!intervalHours || intervalHours <= 0) return null;

  const next = getNextFundingTime(intervalHours, now);
  const remaining = Math.max(0, next - now);
  const totalMs = intervalHours * 3600 * 1000;
  const elapsed = totalMs - remaining;
  const pct = Math.min(100, Math.max(0, (elapsed / totalMs) * 100));

  return (
    <span className={className} title={t('main.fundingIn', { time: formatCountdown(remaining) })}>
      <span className="font-mono tabular-nums">
        {formatCountdown(remaining)}
      </span>
      {showProgress && (
        <span className="inline-block ml-1.5 align-middle w-16 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
          <span
            className="block h-full rounded-full transition-all duration-1000 bg-[var(--cobalt)]"
            style={{ width: `${pct}%` }}
          />
        </span>
      )}
    </span>
  );
}
