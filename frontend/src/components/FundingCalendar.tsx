import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client';
import { FundingEvent } from '../types';
import { useT } from '../i18n';

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return 'сейчас';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}д ${h}ч ${m}м`;
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м ${s}с`;
  return `${s}с`;
}

export function FundingCalendar({ exchanges, refreshSignal }: { exchanges?: string[]; refreshSignal?: number }) {
  const [events, setEvents] = useState<FundingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const t = useT();

  const load = useCallback(async () => {
    try {
      const res: any = await apiClient.getFundingSchedule(exchanges, 12);
      if (res?.ok) setEvents(res.events || []);
    } catch {
      /* non-critical */
    } finally {
      setLoading(false);
    }
  }, [exchanges]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(id); clearInterval(tick); };
  }, [load]);

  // Refresh immediately after a manual scan (driven by MainPage's refreshSignal)
  // so the calendar fills without waiting for the 60s poll.
  useEffect(() => {
    if (refreshSignal) load();
  }, [refreshSignal, load]);

  if (loading) {
    return (
      <div className="card">
        <h2 className="text-lg font-semibold mb-3">{t('calendar.title')}</h2>
        <div className="text-sm text-muted">{t('calendar.loading')}</div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="card">
        <h2 className="text-lg font-semibold mb-3">{t('calendar.title')}</h2>
        <div className="text-sm text-muted">{t('calendar.noData')}</div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="text-lg font-semibold mb-3">{t('calendar.title')}</h2>
      <div className="space-y-2">
        {events.slice(0, 8).map((e) => {
          const remaining = Math.max(0, Math.floor((e.nextApply - now) / 1000));
          const positive = e.ratePerHour >= 0;
          return (
            <div key={`${e.exchange}:${e.pair}`} className="flex justify-between items-center border-b border-gray-100 pb-2">
              <div>
                <div className="text-sm font-medium">
                  {e.exchange.toUpperCase()}: {e.pair}
                </div>
                <div className="text-xs text-muted">
                  {positive ? t('calendar.receive') : t('calendar.pay')}
                  <span className={positive ? 'text-green-700' : 'text-red-700'}>
                    {(Math.abs(e.ratePerHour) * 100).toFixed(4)}%/ч
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold tabular-nums" style={{ color: 'var(--brand)' }}>
                  {formatRemaining(remaining)}
                </div>
                <div className="text-xs text-muted">{t('calendar.untilPayout')}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { formatRemaining };
