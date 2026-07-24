import { useEffect, useRef, useState, useCallback } from 'react';
import { useT } from '../i18n';
import { hapticSuccess } from '../utils/haptic';

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void;
  children: React.ReactNode;
  threshold?: number;
  maxPull?: number;
}

export function PullToRefresh({
  onRefresh,
  children,
  threshold = 70,
  maxPull = 110,
}: PullToRefreshProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const lockedTopRef = useRef(true);

  const onTouchStart = useCallback((e: TouchEvent) => {
    const container = containerRef.current;
    if (!container || refreshing) return;
    const top = container.scrollTop <= 0;
    lockedTopRef.current = top;
    if (top && e.touches[0]) {
      startYRef.current = e.touches[0].clientY;
      draggingRef.current = true;
    }
  }, [refreshing]);

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (!draggingRef.current || refreshing) return;
    if (!lockedTopRef.current) return;
    const start = startYRef.current;
    if (start == null || !e.touches[0]) return;
    const dy = e.touches[0].clientY - start;
    if (dy <= 0) {
      setPullDistance(0);
      return;
    }
    const container = containerRef.current;
    if (!container || container.scrollTop > 0) {
      setPullDistance(0);
      draggingRef.current = false;
      return;
    }
    const damped = Math.min(maxPull, dy * 0.45);
    setPullDistance(damped);
    if (damped > 5 && e.cancelable) e.preventDefault();
  }, [refreshing, maxPull]);

  const triggerRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    hapticSuccess();
    try {
      await onRefresh();
    } finally {
      setTimeout(() => {
        setRefreshing(false);
        setPullDistance(0);
      }, 400);
    }
  }, [onRefresh, refreshing]);

  const onTouchEnd = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    startYRef.current = null;
    if (pullDistance >= threshold && !refreshing) {
      triggerRefresh();
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, threshold, refreshing, triggerRefresh]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd);
    container.addEventListener('touchcancel', onTouchEnd);
    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [onTouchStart, onTouchMove, onTouchEnd]);

  const progress = Math.min(1, pullDistance / threshold);
  const rotation = progress * 180;

  return (
    <div ref={containerRef} className="relative overflow-y-auto h-full">
      <div
        className="pointer-events-none absolute left-0 right-0 flex justify-center transition-opacity"
        style={{
          top: -50 + pullDistance,
          opacity: progress,
          zIndex: 5,
        }}
        aria-hidden="true"
      >
        <div
          className="rounded-full flex items-center justify-center"
          style={{
            width: 40,
            height: 40,
            background: 'var(--surface)',
            border: '1px solid var(--brand-soft)',
            boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
          }}
        >
          {refreshing ? (
            <span className="block w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: 'var(--brand)', borderTopColor: 'transparent' }} />
          ) : (
            <span style={{
              display: 'inline-block',
              transform: `rotate(${rotation}deg)`,
              color: progress >= 1 ? 'var(--brand)' : 'var(--text-muted)',
              fontSize: 18,
            }}>↓</span>
          )}
        </div>
      </div>
      <div className="text-center text-[10px] mb-1 transition-opacity" style={{
        color: 'var(--text-muted)',
        opacity: pullDistance > 20 ? 1 : 0,
        height: 14,
      }}>
        {refreshing
          ? (t('pullToRefresh.refreshing') || 'Refreshing…')
          : progress >= 1
            ? (t('pullToRelease.refresh') || 'Release to refresh')
            : (t('pullToRefresh.pull') || 'Pull to refresh')}
      </div>
      <div style={{ transform: `translateY(${pullDistance}px)`, transition: draggingRef.current ? 'none' : 'transform 0.25s ease' }}>
        {children}
      </div>
    </div>
  );
}
