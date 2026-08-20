import { clsx } from 'clsx';
import { useT } from '../i18n';

interface LiveIndicatorProps {
  latencyMs?: number | null;
  lastUpdated?: number | null;
  className?: string;
  paused?: boolean;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

export function LiveIndicator({
  latencyMs,
  lastUpdated,
  className,
  paused = false,
  size = 'md',
  showLabel = true,
}: LiveIndicatorProps) {
  const t = useT();

  const formatLatency = (ms?: number | null) => {
    if (ms == null || ms <= 0) return null;
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const latencyStr = formatLatency(latencyMs);

  const getQualityColor = (ms?: number | null) => {
    if (paused) return 'text-[var(--text3)]';
    if (ms == null || ms <= 0) return 'text-[var(--green)]';
    if (ms <= 200) return 'text-[var(--green)]';
    if (ms <= 600) return 'text-[#60A5FA]'; // blue-400
    if (ms <= 1500) return 'text-[var(--amber)]';
    return 'text-[var(--red)]';
  };

  const getDotColor = (ms?: number | null) => {
    if (paused) return 'bg-[var(--text3)]';
    if (ms == null || ms <= 0) return 'bg-[var(--green)]';
    if (ms <= 200) return 'bg-[var(--green)]';
    if (ms <= 600) return 'bg-[#60A5FA]';
    if (ms <= 1500) return 'bg-[var(--amber)]';
    return 'bg-[var(--red)]';
  };

  const tooltip = [
    paused ? (t('arb.paused') || 'Пауза') : (t('arb.live') || 'LIVE'),
    latencyStr ? `• Задержка: ${latencyStr}` : '',
    lastUpdated ? `• Обновлено: ${new Date(lastUpdated).toLocaleTimeString()}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={clsx(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-[var(--border)] bg-[var(--bg1)]/90 backdrop-blur-sm select-none transition-all shadow-sm',
        size === 'sm' ? 'text-[11px]' : 'text-xs',
        className
      )}
      title={tooltip}
    >
      <span className="relative flex h-2 w-2">
        {!paused && (
          <span
            className={clsx(
              'animate-ping absolute inline-flex h-full w-full rounded-full opacity-75',
              getDotColor(latencyMs)
            )}
          />
        )}
        <span
          className={clsx(
            'relative inline-flex rounded-full h-2 w-2',
            getDotColor(latencyMs)
          )}
        />
      </span>

      {showLabel && (
        <span
          className={clsx(
            'font-bold uppercase tracking-wider',
            getQualityColor(latencyMs)
          )}
        >
          {paused ? 'PAUSED' : 'LIVE'}
        </span>
      )}

      {latencyStr && !paused && (
        <>
          <span className="text-[var(--border-2)] text-[10px]">•</span>
          <span className="font-mono text-[11px] font-semibold text-[var(--text2)] tabular-nums">
            {latencyStr}
          </span>
        </>
      )}
    </div>
  );
}

export default LiveIndicator;
