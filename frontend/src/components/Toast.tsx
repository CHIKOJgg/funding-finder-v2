import { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'spread';
}

interface ToastContextType {
  showToast: (message: string, type?: Toast['type']) => void;
}

const ToastContext = createContext<ToastContextType>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const TOAST_STYLES: Record<Toast['type'], { bg: string; fg: string; border: string }> = {
  success: { bg: 'var(--green-soft)', fg: 'var(--green)', border: 'var(--border)' },
  error: { bg: 'var(--red-soft)', fg: 'var(--red)', border: 'var(--border)' },
  spread: { bg: 'var(--cobalt-soft)', fg: 'var(--cobalt-text)', border: 'var(--border)' },
  info: { bg: 'var(--bg1)', fg: 'var(--text2)', border: 'var(--border)' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    const timeout = timeoutsRef.current.get(id);
    if (timeout) {
      clearTimeout(timeout);
      timeoutsRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, message, type }]);
    // Important notifications (errors, new spreads) linger a bit longer so
    // they're actually read; transient success/info toasts disappear quickly.
    const duration = type === 'spread' || type === 'error' ? 5000 : 3000;
    const timeout = setTimeout(() => {
      removeToast(id);
    }, duration);
    timeoutsRef.current.set(id, timeout);
  }, [removeToast]);

  // Cleanup all timeouts on unmount
  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      timeoutsRef.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-[calc(var(--safe-top)_+_16px)] right-4 z-50 space-y-2 max-w-[min(92vw,420px)]">
        {toasts.map((toast) => {
          const s = TOAST_STYLES[toast.type];
          return (
            <div
              key={toast.id}
              role={toast.type === 'error' ? 'alert' : 'status'}
              aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
              className="px-4 py-3 rounded-lg border text-sm animate-slide-in"
              style={{ background: s.bg, color: s.fg, borderColor: s.border }}
            >
              {toast.message}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
