import { useEffect, useRef, useState, useCallback } from 'react';
import { hapticImpact } from '../utils/haptic';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  initialHeight?: number; // vh
  maxHeight?: number; // vh
}

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  initialHeight = 50,
  maxHeight = 90,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const startYRef = useRef<number | null>(null);
  const startHeightRef = useRef<number>(initialHeight);
  const draggingRef = useRef(false);
  const [height, setHeight] = useState<number>(initialHeight);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (open) {
      setHeight(initialHeight);
      hapticImpact('light');
    }
  }, [open, initialHeight]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!e.touches[0]) return;
    startYRef.current = e.touches[0].clientY;
    startHeightRef.current = height;
    draggingRef.current = true;
    setDragging(true);
  }, [height]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!draggingRef.current || startYRef.current == null || !e.touches[0]) return;
    const dy = startYRef.current - e.touches[0].clientY;
    const newH = Math.max(20, Math.min(maxHeight, startHeightRef.current + (dy / window.innerHeight) * 100));
    setHeight(newH);
  }, [maxHeight]);

  const onTouchEnd = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    if (height < 25) {
      onClose();
    } else {
      setHeight(initialHeight);
    }
  }, [height, initialHeight, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={sheetRef}
        className="absolute left-0 right-0 bottom-0 rounded-t-2xl shadow-2xl"
        style={{
          background: 'var(--surface)',
          color: 'var(--text)',
          height: `${height}vh`,
          transition: dragging ? 'none' : 'height 0.25s ease',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="w-full flex justify-center pt-2 pb-3 cursor-grab"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className="w-12 h-1.5 rounded-full" style={{ background: 'var(--surface-2)' }} />
        </div>
        {title && (
          <div className="px-4 pb-2 text-base font-bold border-b" style={{ borderColor: 'var(--line)' }}>
            {title}
          </div>
        )}
        <div className="overflow-y-auto p-4" style={{ height: 'calc(100% - 40px)' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
