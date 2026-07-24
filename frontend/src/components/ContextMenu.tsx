import { useEffect, useRef, useState, useCallback } from 'react';
import { useT } from '../i18n';
import { hapticImpact, hapticSelection } from '../utils/haptic';
import { ExchangeResult } from '../types';
import { openExchange } from '../utils/exchanges';
import { useApp } from '../App';

interface ContextMenuProps {
  item: ExchangeResult;
  onAlert: (exchange: string, contract: string) => void;
  onHistory: (exchange: string, contract: string) => void;
  isWatchlisted: boolean;
  onToggleWatchlist: (item: ExchangeResult) => void;
}

interface MenuItem {
  key: string;
  icon: string;
  label: string;
  action: () => void;
  destructive?: boolean;
}

export function ContextMenu({
  item,
  onAlert,
  onHistory,
  isWatchlisted,
  onToggleWatchlist,
}: ContextMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const t = useT();
  const { user } = useApp();

  const close = useCallback(() => {
    setOpen(false);
    setPos(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open, close]);

  const handleOpen = (clientX: number, clientY: number) => {
    hapticImpact('medium');
    const w = window.innerWidth;
    const menuW = 220;
    const x = Math.min(clientX, w - menuW - 8);
    setPos({ x, y: clientY });
    setOpen(true);
  };

  const items: MenuItem[] = [
    {
      key: 'open',
      icon: '↗',
      label: t('contextMenu.open') || 'Open',
      action: () => {
        hapticSelection();
        openExchange(item.exchange, item.contract);
        close();
      },
    },
    {
      key: 'alert',
      icon: '🔔',
      label: t('contextMenu.alert') || 'Set alert',
      action: () => {
        hapticSelection();
        onAlert(item.exchange, item.contract);
        close();
      },
    },
    {
      key: 'history',
      icon: '📈',
      label: t('contextMenu.history') || 'History',
      action: () => {
        hapticSelection();
        onHistory(item.exchange, item.contract);
        close();
      },
    },
    {
      key: 'watch',
      icon: isWatchlisted ? '⭐' : '☆',
      label: isWatchlisted
        ? (t('contextMenu.unwatch') || 'Remove from watchlist')
        : (t('contextMenu.watch') || 'Add to watchlist'),
      action: () => {
        hapticSelection();
        onToggleWatchlist(item);
        close();
      },
    },
    {
      key: 'share',
      icon: '🔗',
      label: t('contextMenu.share') || 'Share',
      action: () => {
        hapticSelection();
        const text = `${item.exchange.toUpperCase()} ${item.contract}: ${(item.rate * 100).toFixed(3)}% APR`;
        if (navigator.share) {
          navigator.share({ title: 'Funding rate', text }).catch(() => undefined);
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(text).catch(() => undefined);
        }
        close();
      },
    },
  ];

  if (!user) return null;

  return (
    <>
      <button
        type="button"
        onContextMenu={(e) => {
          e.preventDefault();
          handleOpen(e.clientX, e.clientY);
        }}
        onTouchStart={(e) => {
          const touch = e.touches[0];
          if (!touch) return;
          const startX = touch.clientX;
          const startY = touch.clientY;
          let cancelled = false;
          const id = setTimeout(() => {
            if (!cancelled) handleOpen(startX, startY);
          }, 550);
          const cancel = () => {
            cancelled = true;
            clearTimeout(id);
            cleanup();
          };
          const onMove = () => cancel();
          const onEnd = () => cancel();
          const cleanup = () => {
            e.target?.removeEventListener?.('touchmove', onMove);
            e.target?.removeEventListener?.('touchend', onEnd);
            e.target?.removeEventListener?.('touchcancel', onEnd);
          };
          e.target?.addEventListener?.('touchmove', onMove, { passive: true });
          e.target?.addEventListener?.('touchend', onEnd, { passive: true });
          e.target?.addEventListener?.('touchcancel', onEnd, { passive: true });
        }}
        onClick={(e) => {
          hapticSelection();
          openExchange(item.exchange, item.contract);
          e.stopPropagation();
        }}
        className="absolute inset-0 z-0"
        style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer' }}
        aria-label={`${item.exchange} ${item.contract} context menu`}
      />
      {open && pos && (
        <div
          ref={ref}
          role="menu"
          className="fixed z-50 rounded-xl shadow-2xl py-1"
          style={{
            top: pos.y,
            left: pos.x,
            width: 220,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            color: 'var(--text)',
          }}
        >
          {items.map((it) => (
            <button
              key={it.key}
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                it.action();
              }}
              className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-[var(--surface-2)] transition-colors"
              style={{ color: it.destructive ? '#ef4444' : 'var(--text)' }}
            >
              <span className="w-5 text-center" aria-hidden="true">{it.icon}</span>
              <span>{it.label}</span>
            </button>
          ))}
          <div className="px-3 py-1 text-[10px] border-t" style={{ color: 'var(--text-muted)', borderColor: 'var(--line)' }}>
            {t('contextMenu.hint') || 'Long-press to open menu'}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleOpen(e.currentTarget.getBoundingClientRect().left, e.currentTarget.getBoundingClientRect().bottom);
        }}
        className="absolute right-1 top-1/2 -translate-y-1/2 text-xs px-1.5 py-0.5 rounded z-10"
        style={{ color: 'var(--text-muted)' }}
        aria-label="More actions"
      >
        ⋯
      </button>
    </>
  );
}
