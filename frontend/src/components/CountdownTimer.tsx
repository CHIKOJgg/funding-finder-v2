import { useEffect, useState } from 'react';
import { getNextFundingTime, formatCountdown } from '../utils/funding';

interface CountdownTimerProps {
  intervalHours: number;
  className?: string;
  showLabel?: boolean;
}

// Live "time until next funding" badge. Re-renders every second so the user
// knows exactly when to close the position and collect the rate.
export function CountdownTimer({ intervalHours, className, showLabel = true }: CountdownTimerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!intervalHours || intervalHours <= 0) return null;

  const next = getNextFundingTime(intervalHours, now);
  const remaining = Math.max(0, next - now);

  return (
    <span className={className} title={`Следующий фандинг через ${formatCountdown(remaining)}`}>
      {showLabel && <span aria-hidden="true">⏱ </span>}
      {formatCountdown(remaining)}
    </span>
  );
}
